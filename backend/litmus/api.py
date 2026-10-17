"""FastAPI server: REST for snapshots and human actions, WebSocket for the event stream (contract: shared/contract.md)."""

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Literal

import modal.exception
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel

from litmus import llm, papiers_client, replay, store, writeback
from litmus.config import budget_gpu_seconds
from litmus.engine import driver
from litmus.experiments import runner
from litmus.library import get_library
from litmus.models import ChatTurn, SessionState

log = logging.getLogger(__name__)

FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
HEALTH_CACHE_SECONDS = 60


@asynccontextmanager
async def lifespan(_: FastAPI):
    await driver.startup()
    yield
    await driver.shutdown()


app = FastAPI(title="Litmus", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=FRONTEND_ORIGINS, allow_methods=["*"], allow_headers=["*"])


class CreateSession(BaseModel):
    goal: str | None = None
    budget_gpu_seconds: float | None = None
    auto_mode: bool = False
    auto_timeout_seconds: float | None = None
    max_waves: int | None = None
    fresh: bool = False  # offset seeds so nothing comes from the result cache (live training for demos)


class Selection(BaseModel):
    proposal_id: str
    knob_overrides: dict | None = None


class Dispatch(BaseModel):
    star_id: str
    selections: list[Selection]
    instruction: str | None = None


class AnswerBody(BaseModel):
    question_id: str
    option_id: str
    comment: str | None = None


class FeedbackBody(BaseModel):
    star_id: str
    kind: Literal["challenge", "suggest", "prioritize"]
    text: str


class ExplainBody(BaseModel):
    star_id: str
    question: str | None = None
    history: list[ChatTurn] = []  # earlier turns of this star's chat, oldest first


class StartBody(BaseModel):
    claim_ids: list[str]


class ClaimRef(BaseModel):
    claim_id: str


class StarRef(BaseModel):
    star_id: str


def _session(session_id: str) -> SessionState:
    try:
        return store.get(session_id)
    except KeyError:
        raise HTTPException(404, f"unknown session {session_id}") from None


def _act(fn, *args):
    try:
        fn(*args)
    except KeyError as error:
        raise HTTPException(404, f"unknown id {error}") from None
    except driver.ActionError as error:
        raise HTTPException(409, str(error)) from None
    return {"ok": True}


# ---------------------------------------------------------------- health + library

_health: dict = {"at": 0.0}


@app.get("/api/health")
async def health():
    if time.monotonic() - _health["at"] > HEALTH_CACHE_SECONDS:
        papiers_ok, openai_ok = await asyncio.gather(papiers_client.doctor(), llm.ok())
        _health.update(at=time.monotonic(), papiers_ok=papiers_ok, openai_ok=openai_ok)
    return {"ok": True, "modal_warm": runner.is_warm(), "papiers_ok": _health["papiers_ok"],
            "openai_ok": _health["openai_ok"]}


@app.post("/api/warmup")
async def warmup():
    try:
        result = await runner.ping()
    except (modal.exception.Error, ConnectionError, TimeoutError) as error:
        raise HTTPException(503, f"Modal warmup failed: {error}") from error
    return {"ok": True, **result}


@app.get("/api/library")
async def library(refresh: bool = False):
    try:
        documents, claims = await get_library(refresh=refresh)
    except papiers_client.PapiersError as error:
        raise HTTPException(503, str(error)) from error
    return {"documents": [d.model_dump() for d in documents], "claims": [c.model_dump() for c in claims]}


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@app.get("/api/library/stream")
async def library_stream():
    """Server-sent events: each stage as Papiers is read live ({stage}), then {stage: "done", documents, claims}."""
    stages: asyncio.Queue[str] = asyncio.Queue()
    load = asyncio.create_task(get_library(refresh=True, progress=stages.put))

    async def events():
        try:
            while not load.done() or not stages.empty():
                waiter = asyncio.ensure_future(stages.get())
                await asyncio.wait({waiter, load}, return_when=asyncio.FIRST_COMPLETED)
                if waiter.done():
                    yield _sse({"stage": waiter.result()})
                else:
                    waiter.cancel()
            documents, claims = load.result()
        except papiers_client.PapiersError as error:
            yield _sse({"stage": "error", "message": str(error)})
            return
        finally:
            load.cancel()  # the browser left mid-load
        yield _sse({"stage": "done", "documents": [d.model_dump() for d in documents],
                    "claims": [c.model_dump() for c in claims]})

    return StreamingResponse(events(), media_type="text/event-stream")


# ---------------------------------------------------------------- sessions

@app.post("/api/sessions")
async def create_session(body: CreateSession):
    state = driver.create_session(body.goal, body.budget_gpu_seconds or budget_gpu_seconds(), body.auto_mode,
                                  body.auto_timeout_seconds, body.max_waves or driver.graph.MAX_WAVES, body.fresh)
    return {"session_id": state.id}


@app.get("/api/sessions")
async def list_sessions():
    return {"sessions": store.list_sessions()}


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    state = _session(session_id)
    if state.replay:
        return state.model_dump()  # replay snapshots set their own last_seq as events are re-emitted
    return state.model_copy(update={"last_seq": store.last_seq(session_id)}).model_dump()


@app.post("/api/sessions/{session_id}/dispatch")
async def dispatch(session_id: str, body: Dispatch):
    _session(session_id)
    return _act(driver.dispatch, session_id, body.star_id, [s.model_dump() for s in body.selections], body.instruction)


@app.post("/api/sessions/{session_id}/start")
async def start(session_id: str, body: StartBody):
    _session(session_id)
    _, claims = await get_library()
    return _act(driver.start, session_id, body.claim_ids, {c.id for c in claims})


@app.post("/api/sessions/{session_id}/pivot")
async def pivot(session_id: str, body: ClaimRef):
    _session(session_id)
    _, claims = await get_library()
    claim = next((c for c in claims if c.id == body.claim_id), None)
    if claim is None:
        raise HTTPException(409, f"unknown claim {body.claim_id}")
    return _act(driver.pivot, session_id, claim)


@app.post("/api/sessions/{session_id}/answer")
async def answer(session_id: str, body: AnswerBody):
    _session(session_id)
    return _act(driver.answer, session_id, body.question_id, body.option_id, body.comment)


@app.post("/api/sessions/{session_id}/feedback")
async def feedback(session_id: str, body: FeedbackBody):
    _session(session_id)
    return _act(driver.feedback, session_id, body.star_id, body.kind, body.text)


@app.post("/api/sessions/{session_id}/explain")
async def explain(session_id: str, body: ExplainBody):
    _session(session_id)
    try:
        answer_text, provenance = await driver.explain(session_id, body.star_id, body.question, body.history)
    except KeyError as error:
        raise HTTPException(404, f"unknown id {error}") from None
    except llm.LLMError as error:
        raise HTTPException(503, str(error)) from error
    return {"answer": answer_text, "provenance": [p.model_dump() for p in provenance]}


@app.post("/api/sessions/{session_id}/pause")
async def pause(session_id: str):
    _session(session_id)
    return _act(driver.pause, session_id)


@app.post("/api/sessions/{session_id}/resume")
async def resume(session_id: str):
    _session(session_id)
    return _act(driver.resume, session_id)


@app.post("/api/sessions/{session_id}/stop_branch")
async def stop_branch(session_id: str, body: StarRef):
    _session(session_id)
    return _act(driver.stop_branch, session_id, body.star_id)


@app.post("/api/sessions/{session_id}/abstract")
async def abstract(session_id: str):
    _session(session_id)
    try:
        state = await driver.finish(session_id)
    except driver.ActionError as error:
        raise HTTPException(409, str(error)) from None
    return {"abstract": state.abstract.text, "findings": state.abstract.findings}


@app.get("/api/sessions/{session_id}/export", response_class=PlainTextResponse)
async def export(session_id: str):
    return PlainTextResponse(writeback.findings_markdown(_session(session_id)), media_type="text/markdown")


@app.get("/api/replay/demo")
async def replay_demo(speed: float = 1.0):
    try:
        return {"session_id": replay.start(speed)}
    except replay.ReplayError as error:
        raise HTTPException(404, str(error)) from None


# ---------------------------------------------------------------- event stream

@app.websocket("/ws/sessions/{session_id}")
async def events(websocket: WebSocket, session_id: str, from_seq: int = 0):
    try:
        store.get(session_id)
    except KeyError:
        await websocket.close(code=4404, reason="unknown session")
        return
    await websocket.accept()
    queue = store.subscribe(session_id)  # subscribe before reading the backlog so nothing falls in the gap
    sent = from_seq
    try:
        for event in store.events_after(session_id, from_seq):
            await websocket.send_text(event.model_dump_json())
            sent = event.seq
        while True:
            event = await queue.get()
            if event.seq > sent:
                await websocket.send_text(event.model_dump_json())
                sent = event.seq
    except WebSocketDisconnect:
        pass
    finally:
        store.unsubscribe(session_id, queue)
