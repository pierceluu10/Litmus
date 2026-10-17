# Litmus

Turn the claims you highlighted in research papers into real experiments, run them with parallel AI agents, and steer the research at every branch.

Built for the Papiers Human-Centred Autoresearch Challenge at Hack the Valley 11.

## What it does

Litmus reads your Papiers library and ranks the claims you engaged with most, notes first, since your notes are your doubts. It turns them into experiments on a small image classifier (airbench on CIFAR-10), runs each one with several random seeds on a cloud GPU, and grades the result with a confidence interval.

The research is drawn as a constellation:

- A **star** is one configuration that was actually run and graded: confirmed, refuted, inconclusive, or baseline.
- A **line** is one change, labelled with the highlight, note or decision it came from.
- **Agents** travel along lines to new stars. At each star you pick which directions to dispatch, up to four in parallel.

## How a session works

1. The agent measures a baseline (about 94%).
2. It proposes 2 to 4 directions, each tied to something you read. You choose.
3. Agents run in parallel. A running star shows live seed and epoch progress.
4. When a result surprises it, the agent searches your library. If the evidence conflicts, it asks you a question with both sides attached, and only that branch waits.
5. An abstract agent writes up the findings with citations. Findings go back to Papiers.

Your decisions are recorded next to what the agent would have done alone, and the agent's own pick keeps running as a ghost line so you can see what your judgment changed.

## How Papiers is used

- Claims are ranked by your engagement, with your notes emphasised.
- Every proposal, line, star, question and abstract sentence carries provenance chips you can open.
- Library searches are shown with their hits.
- Conflicts become questions with evidence from two papers.
- "Explain this" gives a plain-language reading of a finding, with citations.
- The abstract exports back to Papiers.

## Run it locally

Frontend, with the simulated backend (no setup needed):

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Frontend against the real backend: copy `frontend/.env.example` to `frontend/.env`, set `VITE_MOCK=0`, and start the backend (`cd backend && uv run litmus serve`). Mock mode shows a "Mock data" badge so it is never mistaken for real results.

## Architecture

React + TypeScript frontend (one pure event reducer, a REST + WebSocket client, an in-browser mock of the same API). FastAPI backend orchestrating agents with LangGraph, OpenAI for reasoning, Modal A100s for training, the Papiers CLI for your library, and a locked statistics grader. The API and event stream are defined in `shared/contract.md`.

## Backend details

See [AGENTS.md](AGENTS.md).

## The demo library

Jordan, *94% on CIFAR-10 in 3.29 Seconds on a Single GPU*; Szegedy et al., *Rethinking the Inception Architecture*; Müller, Kornblith and Hinton, *When Does Label Smoothing Help?*; Zhang et al., *mixup*; He et al., *Bag of Tricks for Image Classification*.

## Credits

airbench by Keller Jordan, the papers above, and Papiers.
