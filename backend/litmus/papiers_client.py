"""Papiers CLI wrapper: library intake with judgment weighting, page reads, and semantic search.

The installed CLI (v0.1.5) is read-only, so write-back is an export (see writeback.py).
Weighting follows the papiers-research skill: judgment signals (annotations, notes, conversations,
highlights) outrank curation signals (saved but never highlighted).
"""

import asyncio
import json
import os
import shutil
from pathlib import Path

from litmus.models import Claim, Document, Provenance

CLI_TIMEOUT_SECONDS = 30
LIST_LIMIT = 50
PAGE_CHARS = 6000
SEARCH_LIMIT = 6
CACHE_PATH = Path(__file__).resolve().parent.parent / "data" / "library_cache.json"

# Judgment weights: the human's doubts first, then their highlights, then what they merely saved.
WEIGHT_ANNOTATED_HIGHLIGHT = 3.0
WEIGHT_NOTE_OR_CONVERSATION = 2.5
WEIGHT_HIGHLIGHT = 2.0
WEIGHT_REFERENCED_BONUS = 0.25  # a highlight whose document a note/conversation also discusses
WEIGHT_UNREAD_DOCUMENT = 0.5


class PapiersError(RuntimeError):
    """The Papiers CLI failed, timed out, or returned something unparseable."""


async def run_cli(*args: str, stdin: str | None = None) -> dict:
    """Run `papiers <args> --json` and return parsed JSON. Raises PapiersError with the CLI's stderr."""
    binary = shutil.which("papiers")
    if not binary:
        raise PapiersError("papiers CLI not found on PATH (npm install -g papiers)")
    process = await asyncio.create_subprocess_exec(
        binary, *args, "--json",
        stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=os.environ.copy(),
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(stdin.encode() if stdin is not None else None), CLI_TIMEOUT_SECONDS)
    except TimeoutError:
        process.kill()
        await process.wait()
        raise PapiersError(f"papiers {args[0]} timed out after {CLI_TIMEOUT_SECONDS}s") from None
    if process.returncode != 0:
        raise PapiersError(f"papiers {' '.join(args[:2])} exited {process.returncode}: "
                           f"{stderr.decode().strip() or stdout.decode().strip()[:500]}")
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as error:
        raise PapiersError(f"papiers {args[0]} returned invalid JSON: {error}") from error


def parse_documents(listing: dict) -> list[Document]:
    documents = []
    for item in listing["items"]:
        meta = item.get("metadata") or {}
        url = (item.get("source") or {}).get("url")
        documents.append(Document(
            id=item["id"], title=item.get("title") or meta.get("title") or item["id"],
            authors=meta.get("authors") or [], year=meta.get("publishedYear"), url=url,
            highlight_count=meta.get("highlightCount") or 0, note_count=meta.get("annotationCount") or 0,
            papiers_url=url,
        ))
    return documents


def parse_highlights(read: dict, documents: dict[str, Document]) -> list[Claim]:
    """Highlights from `papiers read hl_... --json`; annotationText is the human's note on the highlight."""
    claims = []
    for item in read["items"]:
        if not item.get("ok", True):
            continue
        meta = item.get("metadata") or {}
        doc_id = meta.get("documentId", "")
        doc = documents.get(doc_id)
        doc_title = meta.get("documentTitle") or (doc.title if doc else "")
        url = doc.url if doc else None
        text = item["content"].strip()
        annotation = (meta.get("annotationText") or "").strip() or None
        provenance = [Provenance(kind="highlight", id=item["id"], doc_id=doc_id, doc_title=doc_title,
                                 text=text, papiers_url=url)]
        if annotation:
            provenance.append(Provenance(kind="note", id=f"{item['id']}#annotation", doc_id=doc_id,
                                         doc_title=doc_title, text=annotation, papiers_url=url))
        claims.append(Claim(
            id=item["id"], text=text, doc_id=doc_id, doc_title=doc_title, annotation=annotation,
            weight=WEIGHT_ANNOTATED_HIGHLIGHT if annotation else WEIGHT_HIGHLIGHT,
            page=meta.get("pageNumber"), provenance=provenance,
        ))
    return claims


def parse_notes_or_conversations(read: dict, kind: str, documents: dict[str, Document]) -> list[Claim]:
    """Standalone notes (nte_) and Ask Papiers conversations (cnv_): the human's own thinking."""
    claims = []
    for item in read.get("items", []):
        if not item.get("ok", True) or not (item.get("content") or "").strip():
            continue
        meta = item.get("metadata") or {}
        doc_id = meta.get("documentId") or ""
        doc_title = meta.get("documentTitle") or meta.get("title") or (documents[doc_id].title if doc_id in documents else kind)
        text = item["content"].strip()
        claims.append(Claim(
            id=item["id"], text=text, doc_id=doc_id, doc_title=doc_title, weight=WEIGHT_NOTE_OR_CONVERSATION,
            provenance=[Provenance(kind=kind, id=item["id"], doc_id=doc_id or None, doc_title=doc_title, text=text[:600])],
        ))
    return claims


def rank_claims(claims: list[Claim], documents: list[Document]) -> list[Claim]:
    """Apply the referenced bonus, add unread documents, sort by weight, and number the ranks."""
    discussed_docs = {c.doc_id for c in claims if c.provenance[0].kind in ("note", "conversation") and c.doc_id}
    for claim in claims:
        if claim.provenance[0].kind == "highlight" and claim.doc_id in discussed_docs:
            claim.weight += WEIGHT_REFERENCED_BONUS
    highlighted = {c.doc_id for c in claims}
    for doc in documents:
        if doc.id not in highlighted:
            claims.append(Claim(id=doc.id, text=doc.title, doc_id=doc.id, doc_title=doc.title,
                                weight=WEIGHT_UNREAD_DOCUMENT,
                                provenance=[Provenance(kind="document", id=doc.id, doc_id=doc.id,
                                                       doc_title=doc.title, text=doc.title, papiers_url=doc.url)]))
    ranked = sorted(claims, key=lambda c: -c.weight)  # stable: CLI order (most recent first) breaks ties
    for i, claim in enumerate(ranked, 1):
        claim.rank = i
    return ranked


async def _read_all(listing: dict) -> dict:
    ids = [item["id"] for item in listing["items"]]
    if not ids:
        return {"items": []}
    return await run_cli("read", "@-", stdin="\n".join(ids))


async def fetch_library() -> tuple[list[Document], list[Claim]]:
    """Load documents, highlights, notes, and conversations live from Papiers and rank the claims."""
    doc_list, hl_list, note_list, cnv_list = await asyncio.gather(
        run_cli("list", "--kind", "document", "--limit", str(LIST_LIMIT)),
        run_cli("list", "--kind", "highlight", "--limit", str(LIST_LIMIT)),
        run_cli("list", "--kind", "note", "--limit", str(LIST_LIMIT)),
        run_cli("list", "--kind", "conversation", "--limit", str(LIST_LIMIT)),
    )
    documents = parse_documents(doc_list)
    by_id = {d.id: d for d in documents}
    hl_read, note_read, cnv_read = await asyncio.gather(_read_all(hl_list), _read_all(note_list), _read_all(cnv_list))
    claims = (parse_highlights(hl_read, by_id)
              + parse_notes_or_conversations(note_read, "note", by_id)
              + parse_notes_or_conversations(cnv_read, "conversation", by_id))
    return documents, rank_claims(claims, documents)


def save_cache(documents: list[Document], claims: list[Claim]) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps({"documents": [d.model_dump() for d in documents],
                                      "claims": [c.model_dump() for c in claims]}, indent=1))


def load_cache() -> tuple[list[Document], list[Claim]]:
    if not CACHE_PATH.exists():
        raise PapiersError("Papiers is unreachable and there is no cached library yet")
    data = json.loads(CACHE_PATH.read_text())
    return [Document(**d) for d in data["documents"]], [Claim(**c) for c in data["claims"]]


async def page_text(doc_id: str, page: int, max_chars: int = PAGE_CHARS) -> str:
    """Plain text of one page of a document, for extracting the conditions behind a claim."""
    result = await run_cli("read", doc_id, "--pages", str(page), "--format", "plain",
                           "--max-chars-per-item", str(max_chars))
    item = result["items"][0]
    if not item.get("ok", True):
        raise PapiersError(f"could not read {doc_id} page {page}")
    return item.get("content", "")


def parse_search(result: dict) -> list[Provenance]:
    """Flatten search results to evidence-level provenance (highlights, passages, notes), best first."""
    hits = []
    for doc in result.get("results", []):
        doc_kind = doc.get("kind")
        url = (doc.get("source") or {}).get("url")
        doc_id = doc["id"] if doc_kind == "document" else (doc.get("metadata") or {}).get("documentId")
        title = doc.get("title")
        evidence = doc.get("evidence") or []
        if not evidence:
            hits.append(Provenance(kind="document" if doc_kind == "document" else "search", id=doc["id"],
                                   doc_id=doc_id, doc_title=title, text=doc.get("snippet") or title or doc["id"],
                                   papiers_url=url))
        for ev in evidence:
            kind = ev.get("kind") if ev.get("kind") in ("highlight", "note", "conversation", "passage") else "search"
            hits.append(Provenance(kind=kind, id=ev["id"], doc_id=doc_id, doc_title=title,
                                   text=ev.get("snippet", ""), papiers_url=url))
    return hits


async def search(query: str, limit: int = SEARCH_LIMIT) -> list[Provenance]:
    return parse_search(await run_cli("search", query, "--limit", str(limit)))


async def doctor() -> bool:
    try:
        result = await run_cli("doctor")
    except PapiersError:
        return False
    return all(check.get("ok") for check in result.get("checks", []))


WRITE_COMMANDS = ("write", "create", "add", "import", "upload", "note")


def write_commands_in_help(help_text: str) -> list[str]:
    """Command names under the help's COMMANDS section that could write to the library."""
    section = help_text.split("COMMANDS", 1)[-1].split("\n\n", 1)[0]
    names = [line.split()[0] for line in section.splitlines() if line.strip()]
    return [name for name in names if name in WRITE_COMMANDS]


async def supports_write() -> bool:
    """True if the installed CLI has a write command. v0.1.5 does not, so findings are exported."""
    binary = shutil.which("papiers")
    if not binary:
        return False
    process = await asyncio.create_subprocess_exec(binary, "help", "--all", stdout=asyncio.subprocess.PIPE,
                                                   stderr=asyncio.subprocess.DEVNULL)
    stdout, _ = await asyncio.wait_for(process.communicate(), CLI_TIMEOUT_SECONDS)
    return bool(write_commands_in_help(stdout.decode()))
