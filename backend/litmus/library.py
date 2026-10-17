"""The judgment-weighted library: Papiers intake + conditions behind each claim, cached to disk.

If Papiers is unreachable the last cached library is served, so a demo never stalls on the network.
"""

import asyncio
import logging

from pydantic import BaseModel

from litmus import papiers_client
from litmus.llm import LLMError, structured
from litmus.models import Claim, Document

log = logging.getLogger(__name__)


class Conditions(BaseModel):
    conditions: str
    testbed_match: str


class Summary(BaseModel):
    id: str
    summary: str


class Summaries(BaseModel):
    summaries: list[Summary]


_memory: tuple[list[Document], list[Claim]] | None = None


async def _conditions_for(claim: Claim) -> str | None:
    if claim.page is None or claim.provenance[0].kind != "highlight":
        return None
    try:
        page = await papiers_client.page_text(claim.doc_id, claim.page)
        result = await structured("extract_conditions", Conditions, claim=claim.text,
                                  annotation=claim.annotation or "(none)", doc_title=claim.doc_title, page_text=page)
    except (papiers_client.PapiersError, LLMError) as error:
        log.warning("conditions for %s failed: %s", claim.id, error)
        return None
    return f"{result.conditions} {result.testbed_match}"


async def _summaries_for(claims: list[Claim]) -> dict[str, str]:
    """One LLM call titles every claim; ids the model invents are dropped."""
    if not claims:
        return {}
    items = [{"id": c.id, "passage": c.text, "note": c.annotation or "", "paper": c.doc_title} for c in claims]
    try:
        result = await structured("summarize_claims", Summaries, items=items)
    except LLMError as error:
        log.warning("claim summaries failed: %s", error)
        return {}
    wanted = {c.id for c in claims}
    return {s.id: s.summary.strip() for s in result.summaries if s.id in wanted and s.summary.strip()}


def _summary_still_fits(claim: Claim, previous: dict[str, Claim]) -> str | None:
    """A cached summary is reused only while the highlight and the note it was written from are unchanged."""
    old = previous.get(claim.id)
    return old.summary if old and old.text == claim.text and old.annotation == claim.annotation else None


async def get_library(refresh: bool = False,
                      progress: papiers_client.Progress = papiers_client._quiet) -> tuple[list[Document], list[Claim]]:
    """Ranked library. Conditions and summaries are written once per claim and reused from the cache afterwards."""
    global _memory
    if _memory and not refresh:
        return _memory
    try:
        documents, claims = await papiers_client.fetch_library(progress)
    except papiers_client.PapiersError as error:
        log.warning("Papiers unavailable, serving cached library: %s", error)
        _memory = papiers_client.load_cache()
        return _memory
    try:
        previous = {c.id: c for c in papiers_client.load_cache()[1]}
    except papiers_client.PapiersError:
        previous = {}
    await progress("summaries")
    for claim in claims:
        claim.conditions = previous[claim.id].conditions if claim.id in previous else None
        claim.summary = _summary_still_fits(claim, previous)
    needs_conditions = [c for c in claims if not c.conditions]
    needs_summary = [c for c in claims if not c.summary and c.provenance[0].kind != "document"]
    extracted, summaries = await asyncio.gather(asyncio.gather(*(_conditions_for(c) for c in needs_conditions)),
                                                _summaries_for(needs_summary))
    for claim, text in zip(needs_conditions, extracted):
        claim.conditions = text
    for claim in needs_summary:
        claim.summary = summaries.get(claim.id)
    papiers_client.save_cache(documents, claims)
    _memory = (documents, claims)
    return _memory
