"""arXiv search for Litmus's autoresearch: papers the human has not read yet, via the public export API (no key)."""

import asyncio
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from pydantic import BaseModel

API = "http://export.arxiv.org/api/query"
TIMEOUT_SECONDS = 15
ATOM = "{http://www.w3.org/2005/Atom}"
ABSTRACT_CHARS = 600


class ArxivError(RuntimeError):
    """arXiv was unreachable or returned something unparseable."""


class Paper(BaseModel):
    id: str  # arXiv id, e.g. 1710.09412v2
    title: str
    authors: list[str]
    year: int | None
    url: str
    abstract: str


def parse(feed: str) -> list[Paper]:
    try:
        root = ET.fromstring(feed)
    except ET.ParseError as error:
        raise ArxivError(f"arXiv returned invalid XML: {error}") from error
    papers = []
    for entry in root.findall(f"{ATOM}entry"):
        url = (entry.findtext(f"{ATOM}id") or "").strip()
        if "/abs/" not in url:
            continue  # the API reports errors as an entry without an abstract page
        published = entry.findtext(f"{ATOM}published") or ""
        papers.append(Paper(
            id=url.rsplit("/abs/", 1)[1], url=url.replace("http://", "https://"),
            title=" ".join((entry.findtext(f"{ATOM}title") or "").split()),
            authors=[(a.findtext(f"{ATOM}name") or "").strip() for a in entry.findall(f"{ATOM}author")],
            year=int(published[:4]) if published[:4].isdigit() else None,
            abstract=" ".join((entry.findtext(f"{ATOM}summary") or "").split())[:ABSTRACT_CHARS],
        ))
    return papers


def _fetch(query: str, limit: int) -> str:
    params = urllib.parse.urlencode({"search_query": f"all:{query}", "start": 0, "max_results": limit, "sortBy": "relevance"})
    try:
        with urllib.request.urlopen(f"{API}?{params}", timeout=TIMEOUT_SECONDS) as response:
            return response.read().decode()
    except OSError as error:  # URLError, timeouts, connection resets
        raise ArxivError(f"arXiv search failed: {error}") from error


async def search(query: str, limit: int = 8) -> list[Paper]:
    return parse(await asyncio.to_thread(_fetch, query, limit))
