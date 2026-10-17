"""`uv run litmus <command>` — entry points for the human."""

import argparse
import asyncio
import time

import litmus.config  # noqa: F401  (loads .env)


async def _smoke(seeds: list[int]) -> None:
    from litmus.experiments.knobs import BASELINE_KNOBS
    from litmus.experiments.runner import stream_runs

    started = time.perf_counter()
    async for event in stream_runs(BASELINE_KNOBS, seeds):
        elapsed = time.perf_counter() - started
        if event["type"] == "progress":
            print(f"[{elapsed:6.1f}s] seed {event['seed']} epoch {event['epoch']:>2}  "
                  f"train_acc {event['train_acc']:.4f}  val_acc {event['val_acc']:.4f}")
        else:
            print(f"[{elapsed:6.1f}s] seed {event['seed']} DONE  val_acc {event['val_acc']:.4f}  "
                  f"tta_val_acc {event['tta_val_acc']:.4f}  gpu {event['time_seconds']:.2f}s")


async def _warmup() -> None:
    from litmus.experiments.runner import ping

    started = time.perf_counter()
    result = await ping()
    print(f"warm: {result} in {time.perf_counter() - started:.1f}s")


async def _library(refresh: bool) -> None:
    from litmus.library import get_library

    documents, claims = await get_library(refresh=refresh)
    print(f"{len(documents)} documents, {len(claims)} claims (judgment-weighted)\n")
    for claim in claims:
        print(f"#{claim.rank:<2} w={claim.weight:<4} [{claim.id}] {claim.doc_title[:50]}")
        print(f"     claim: {claim.text[:160]}")
        if claim.annotation:
            print(f"     NOTE:  {claim.annotation}")
        if claim.conditions:
            print(f"     cond:  {claim.conditions[:300]}")
        print()


def print_tree(session_id: str) -> None:
    from litmus import store

    state = store.get(session_id)
    children: dict = {}
    for s in state.stars:
        children.setdefault(s.parent_id, []).append(s)

    def walk(s, depth):
        g = s.grade
        result = (f"{g.mean_child * 100:.2f}%  delta {g.delta * 100:+.2f} [{g.ci_low * 100:+.2f}, {g.ci_high * 100:+.2f}] {g.verdict}"
                  if g and g.verdict != "baseline" else f"{g.mean_child * 100:.2f}% baseline" if g else s.status)
        print(f"{'  ' * depth}{s.id} [{s.chosen_by}] {s.title} {s.knob_changes or ''} -> {result}")
        for child in children.get(s.id, []):
            walk(child, depth + 1)

    for root in children.get(None, []):
        walk(root, 0)
    if state.abstract:
        print("\nABSTRACT\n" + state.abstract.text)


async def _run(auto: bool, waves: int, goal: str | None) -> None:
    from litmus import store
    from litmus.config import budget_gpu_seconds
    from litmus.engine import driver

    await driver.startup()
    state = driver.create_session(goal, budget_gpu_seconds(), auto_mode=auto, auto_timeout_seconds=None, max_waves=waves)
    print(f"session {state.id}")
    queue = store.subscribe(state.id)
    for event in store.events_after(state.id, 0):
        queue.put_nowait(event)
    quiet = {"experiment.progress", "budget.updated", "star.updated", "library.loaded"}
    while True:
        event = await queue.get()
        if event.type not in quiet:
            text = event.payload.get("text") or event.payload.get("message") or event.payload.get("change") or ""
            print(f"[{event.seq:>4}] {event.type:<22} {text[:160]}")
        if event.type == "session.status" and event.payload["status"] == "done":
            break
        if event.type == "error" and event.payload["message"].startswith("Engine error"):
            break
        if not auto and event.type in ("proposals.ready", "question.asked"):
            print("(waiting for a human: use the API, or run with --auto)")
            break
    print()
    print_tree(state.id)
    await driver.shutdown()


def main() -> None:
    parser = argparse.ArgumentParser(prog="litmus")
    commands = parser.add_subparsers(dest="command", required=True)
    smoke = commands.add_parser("smoke", help="train the baseline on Modal and stream epochs")
    smoke.add_argument("--seeds", type=int, nargs="+", default=[0])
    commands.add_parser("warmup", help="start a warm Modal container (run ~2 min before judging)")
    library = commands.add_parser("library", help="print the ranked claims from your Papiers library")
    library.add_argument("--refresh", action="store_true", help="re-read Papiers (otherwise use the cache)")
    serve = commands.add_parser("serve", help="start the API on http://localhost:8000")
    serve.add_argument("--port", type=int, default=8000)
    record = commands.add_parser("record-demo", help="save a finished session to shared/demo-session.json")
    record.add_argument("session_id")
    run = commands.add_parser("run", help="headless end-to-end session; prints the tree")
    run.add_argument("--auto", action="store_true", help="the agent makes every choice itself")
    run.add_argument("--waves", type=int, default=3)
    run.add_argument("--goal")
    args = parser.parse_args()

    if args.command == "serve":
        import logging

        import uvicorn

        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
        uvicorn.run("litmus.api:app", host="0.0.0.0", port=args.port, log_level="info")
    elif args.command == "smoke":
        asyncio.run(_smoke(args.seeds))
    elif args.command == "warmup":
        asyncio.run(_warmup())
    elif args.command == "run":
        asyncio.run(_run(args.auto, args.waves, args.goal))
    elif args.command == "record-demo":
        from litmus import replay

        print(replay.record(args.session_id))
    elif args.command == "library":
        asyncio.run(_library(args.refresh))
