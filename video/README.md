# Demo video tooling

Overlays (name titles, feature callouts, credits) are Remotion compositions in `src/`; edit the `cues` list in
`src/Root.tsx` (times in seconds). FFmpeg then composites them over the screen recording, face video and voiceover.

```bash
cd video && npm install
# Preview: npm run studio
# Render a transparent overlay track to out/overlays.mov (Remotion downloads its own Chrome on first run):
npm run render
# Composite over footage:
ffmpeg -i screen.mp4 -i out/overlays.mov -filter_complex "[0][1]overlay" -c:a copy out/final.mp4
```

Needs: FFmpeg (`brew install ffmpeg`), Node 22+. `out/`, `assets/` and media files are gitignored. The video plan is in `SCRIPT.md`. Captions: OpenAI Whisper API (`api.openai.com`), local Whisper models are not downloadable in the cloud container.
