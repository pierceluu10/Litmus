"""Parsing and ranking against real recorded Papiers CLI output (tests/fixtures/papiers)."""

import json
from pathlib import Path

from litmus.papiers_client import (WEIGHT_ANNOTATED_HIGHLIGHT, parse_documents, parse_highlights,
                                   parse_notes_or_conversations, parse_search, rank_claims)

FIXTURES = Path(__file__).parent / "fixtures" / "papiers"


def load(name):
    return json.loads((FIXTURES / name).read_text())


def library():
    documents = parse_documents(load("list_documents.json"))
    claims = parse_highlights(load("read_highlights.json"), {d.id: d for d in documents})
    return documents, claims


def test_documents_parse_with_metadata():
    documents, _ = library()
    by_title = {d.title: d for d in documents}
    assert len(documents) == 5
    mixup = by_title["mixup: Beyond Empirical Risk Minimization"]
    assert mixup.url == "https://arxiv.org/abs/1710.09412" and mixup.year == 2018 and mixup.highlight_count == 3
    assert "Hongyi Zhang" in mixup.authors


def test_highlights_carry_annotation_and_provenance():
    _, claims = library()
    assert len(claims) == 12
    flip = next(c for c in claims if "alternating flip" in c.text)
    assert flip.annotation == "Effect is about 0.1 points. Is it real or noise?"
    assert flip.weight == WEIGHT_ANNOTATED_HIGHLIGHT and flip.page == 7
    assert flip.doc_title == "94% on CIFAR-10 in 3.29 Seconds on a Single GPU"
    kinds = [p.kind for p in flip.provenance]
    assert kinds == ["highlight", "note"] and flip.provenance[1].text == flip.annotation
    assert flip.text.startswith("Switching from random flip")  # content, not the "note — text" preview


def test_ranking_puts_human_doubts_first_then_highlights_then_unread():
    documents, claims = library()
    ranked = rank_claims(claims, documents)
    annotated = [c for c in ranked if c.annotation]
    assert len(annotated) == 6
    assert all(c.annotation for c in ranked[:6]) and not any(c.annotation for c in ranked[6:])
    assert [c.rank for c in ranked] == list(range(1, len(ranked) + 1))


def test_notes_and_conversations_outrank_plain_highlights_and_boost_their_document():
    documents, claims = library()
    mixup_doc = next(d for d in documents if d.title.startswith("mixup"))
    note = parse_notes_or_conversations({"items": [{"id": "nte_x", "ok": True, "content": "Try mixup at 20 epochs.",
                                                    "metadata": {"documentId": mixup_doc.id}}]}, "note", {mixup_doc.id: mixup_doc})
    ranked = rank_claims(claims + note, documents)
    plain_mixup = next(c for c in ranked if c.doc_id == mixup_doc.id and not c.annotation and c.provenance[0].kind == "highlight")
    plain_other = next(c for c in ranked if c.doc_id != mixup_doc.id and not c.annotation and c.provenance[0].kind == "highlight")
    assert plain_mixup.weight > plain_other.weight
    note_claim = next(c for c in ranked if c.id == "nte_x")
    assert note_claim.rank < plain_mixup.rank


def test_unread_documents_rank_last():
    documents, claims = library()
    unread_doc = documents[0].model_copy(update={"id": "doc_unread", "title": "Saved, never read"})
    ranked = rank_claims(claims, documents + [unread_doc])
    assert ranked[-1].id == "doc_unread" and ranked[-1].provenance[0].kind == "document"


def test_search_flattens_evidence_best_first():
    hits = parse_search(load("search_mixup.json"))
    print([(h.kind, h.id, h.doc_title) for h in hits])
    assert hits[0].id == "hl_07db8d8d60e86170dda2cc24919b3c35" and hits[0].kind == "highlight"
    assert hits[0].doc_title.startswith("Bag of Tricks") and "120 to 200" in hits[0].text
    assert len(hits) == 3

