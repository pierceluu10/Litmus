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


async def get_library(refresh: bool = False) -> tuple[list[Document], list[Claim]]:
    """Ranked library. Conditions are extracted once per claim and reused from the cache afterwards."""
    global _memory
    if _memory and not refresh:
        return _memory
    try:
        documents, claims = await papiers_client.fetch_library()
    except papiers_client.PapiersError as error:
        log.warning("Papiers unavailable, serving cached library: %s", error)
        _memory = papiers_client.load_cache()
        return _memory
    try:
        cached = {c.id: c.conditions for c in papiers_client.load_cache()[1] if c.conditions}
    except papiers_client.PapiersError:
        cached = {}
    missing = [c for c in claims if c.id not in cached]
    extracted = await asyncio.gather(*(_conditions_for(c) for c in missing))
    cached.update({c.id: text for c, text in zip(missing, extracted) if text})
    for claim in claims:
        claim.conditions = cached.get(claim.id)
    papiers_client.save_cache(documents, claims)
    _memory = (documents, claims)
    return _memory
