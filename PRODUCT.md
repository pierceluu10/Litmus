# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
A researcher who has read and highlighted papers in Papiers and wants to know which of those claims hold in their own setting. Primary scene: a live hackathon demo in front of judges (Hack the Valley 11, Papiers Human-Centred Autoresearch Challenge), on a laptop or projector, then the researcher's own desk.

## Product Purpose
Litmus turns the claims a human highlighted into real training experiments (airbench on CIFAR-10, Modal A100s), runs them as parallel agent branches, grades each with a locked statistics module, and lets the human steer at every branch point. Success: the human can see at a glance which claims held, which paths gave the best accuracy, and where their own judgment changed the outcome.

## Positioning
Every result traces back to a highlight or note the human made, and every branch point is a human decision with the agent's alternative run alongside it (shadow branches). The grader is locked, so verdicts are statistics, not LLM opinion.

## Operating Context
Papiers library (documents, highlights, notes) → LangGraph engine → Modal GPUs → grader → findings exported back to Papiers as Markdown. Sessions take minutes; results stream in per epoch and per seed.

## Capabilities and Constraints
- Real backend implements `shared/contract.md` (REST + WebSocket events). The frontend also has an in-browser demo backend (`frontend/src/mock/`), which is the default for now (user decision, 2026-10-17); the UI must not label it as demo or mock.
- Humans can dispatch agents from any star, including refuted ones: a bad result can still lead somewhere.
- Abstract generation is available on demand.
- Claim summaries are hand-written for the demo library only; live sessions fall back to the claim text.

## Brand Commitments
- Name: Litmus. The agent is personified as a classical bronze-era Greek statue reaching out (the Artemision Bronze, public domain scan by SMK); experiments leave from its fingertips.
- Light marble world. Experiments are dark graphite blobs. Typeface: Geist and Geist Mono (user choice).
- No AI-slop copy: short, technical, high-level.

## Evidence on Hand
- Recorded real session `shared/demo-session.json` (11 stars, real Modal results). The demo backend's effect model is calibrated from it.
- Demo Papiers library: 5 papers, 6 annotated highlights (`frontend/src/mock/library.ts`).

## Product Principles
1. Every visual encodes something the researcher needs; nothing is clickable decoration.
2. Provenance over prose: show the claim, the number, and the interval, not paragraphs.
3. The human steers; the agent's alternative stays visible.
4. Bad results are still branches worth exploring.
