---
version: 1
slug: "frontend-src-app-tsx"
primary_target: "frontend/src/App.tsx"
related_targets: []
---

# Research workspace (frontend/src/App.tsx)

Scope: the whole frontend app, start state and live session. Mode: Operate.
Audience/job: a researcher (and hackathon judges) watching agents test highlighted claims, steering branches, reading results.

## Direction contract
seed: none (direction pinned by the user's brief)

THESIS: The research tree is a chart. A marble statue reaches out; experiments leave its fingertip as graphite blobs placed by measured accuracy (height = accuracy, depth = generations). Refuses the category default of a flat node graph with paper names on every edge and stacked cards.

OWN-WORLD: Pale cool marble ground (#eef1f4 to #f7f8f9), the flat-shaded Artemision Bronze in marble white, graphite blobs (#2b2f33) with thin verdict rings (moss confirmed, oxide refuted, stone inconclusive, amber waiting). Geist for UI, Geist Mono for numbers. Hairline borders, solid white panels, no glass, no gradients on text.

STORY: Read which claims held (left), see which paths climb (centre), open any agent for its numbers (right), branch from anything, including failures.

FIRST VIEWPORT: Start: the statue in profile at left, hand reaching into empty marble space, goal input at right. Session: claims rail left, 3D tree centre with a faint accuracy scale, results rail right, generate abstract top right.

SIGNATURE: Results rise or sink. A blob runs at its parent's height, then glides up or down to its measured accuracy when graded; the camera follows new branches and re-centres on any clicked agent.

RISK: 3D label overlap with many siblings; WebGL cost on weak laptops.
