# Litmus demo video — 2:00 script

Read at a normal pace (about 150 words a minute). **O** = Otabek, **P** = Pierce. Each beat lists what you say,
what is on screen, and what I do in the edit. Times are targets; I re-time every cut to your real voiceover.

Record each of you on camera reading your own lines (face clips), plus one clean voiceover track of the whole
script. Keep your heads centred with some space around them: I crop you into a round bubble.

---

## 1. Hook — 0:00–0:10
**O:** "When you read a paper, you highlight the claims you doubt. Then you move on, and you never find out if
they hold."

- **Screen:** both faces, full screen, side by side.
- **Edit:** no app yet. Loudness-normalised voice. A soft fade-in from white.

## 2. Who we are + what Litmus is — 0:10–0:20
**P:** "We're Pierce and Otabek, and this is Litmus. It turns the claims you highlighted into real experiments,
and lets your judgment steer them."

- **Screen:** faces shrink into a round bubble in the bottom-right corner; the Litmus landing page (temple)
  fills the screen behind them.
- **Edit:** name lower-thirds as each of you is named ("Pierce Luu — Backend", "Otabek Alimov — Frontend").

## 3. Connect Papiers — 0:20–0:35
**O:** "It starts from your Papiers library. Paste your Papiers key, and Litmus reads your papers, your
highlights and your notes."

- **Screen:** sign-in page. You paste the key (dots only), press Connect, the loading stages run
  (papers → highlights → notes → summaries). A 1.5s cut to the arXiv page of the mixup paper.
- **Edit:** callout "Read live from your Papiers library". Face bubble stays. The token step is the clip you
  record yourself; I never type a key.

## 4. Pick a claim — 0:35–0:48
**O:** "Litmus asks where to start. We pick the claim we doubt: mixup beats plain training. Our note says the
paper trained for 200 epochs. Our testbed trains for ten."

- **Screen:** "Where should we start?" bubble, open the mixup claim card (your note visible), press Start; the
  claim flies into Litmus's head and the camera pans to the graph.
- **Edit:** zoom-in (1.3×) on the note while it's read. Face bubble hidden for this beat so the note is
  readable.

## 5. Agents run real experiments — 0:48–1:05
**P:** "Each claim gets its own agent. It trains on CIFAR-10 across five seeds, and a locked statistics module
grades it. Higher on the graph means higher accuracy."

- **Screen:** node graph: baseline, then the Mixup agent training (eyes, ring filling), then its grade.
  Accuracy lines on the right.
- **Edit:** sped up where it waits (a small "4×" tag in the corner while sped up). Callout
  "5 seeds · paired t-interval · locked grader". Face bubble back.

## 6. The human call (hero moment) — 1:05–1:25
**O:** "Mixup is refuted here. So the agent searches our library and asks us a question only we can answer.
We know the paper trained much longer, so we tell it to train longer. And now mixup holds."

- **Screen:** refuted ring, the library search bubble, the question card, our answer (longer training), the new
  node growing out of it and turning green.
- **Edit:** callout "Your call" on the answer. Slight slow-down (0.8×) on the moment it turns green. This is
  the beat to keep full length if we run long.

## 7. Where you steered + Ask Litmus — 1:25–1:38
**P:** "Litmus keeps track of every decision you made and what it led to. And you can ask it about any result."

- **Screen:** results card → "Where you steered", then the chat: ask "Is this result real or noise?" and the
  answer flying back.
- **Edit:** callout on the "Where you steered" section. Face bubble stays.

## 8. Abstract back to Papiers — 1:38–1:50
**O:** "At the end, Litmus writes an abstract where every sentence cites the run and the highlight behind it,
ready to go back into Papiers."

- **Screen:** Generate abstract → the abstract with its inline citations → hover one citation (the quote shows)
  → Download findings.
- **Edit:** zoom on the citations. Callout "Every sentence cited".

## 9. Close — 1:50–2:00
**P:** "Litmus. Your highlights, tested."

- **Screen:** faces full screen again for the line, then credits.
- **Edit:** credits card: Litmus · Built at Hack the Valley 11 · Papiers Human-Centred Autoresearch Challenge ·
  airbench by Keller Jordan · Pierce Luu, Otabek Alimov.

---

## What I do across the whole video
- **App footage:** recorded in Demo mode at 1920×1080 (fast, no GPU waits). The Papiers library and token step
  are real. Each beat above is its own clip, so I can drop it wherever you say it.
- **Captions:** from your voiceover via Whisper word timestamps, burned in at the bottom, two lines max.
- **Audio:** light denoise, loudness normalised to −16 LUFS; no music unless you send a track.
- **Overlays:** Remotion (`video/src`): lower-thirds, callouts, credits. Nothing on screen that isn't the real app.
- **Export:** `video/out/final.mp4`, 1080p, about 2:00.

## Honesty notes
- Demo mode simulates training, calibrated from our real recorded run. The script avoids quoting exact numbers
  so nothing said is wrong for the run on screen. If you want to say real numbers, use the recorded real run:
  mixup α=1 −1.44 refuted at ~10 epochs; mixup α=0.2 at 30 epochs +0.22 confirmed.
- The script says names in the order Pierce, Otabek. Fix spellings or roles here before you record.
