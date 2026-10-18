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

Captions: transcribe the voiceover with word timestamps (Whisper), map them onto the edited timeline into
`assets/captions.json` (`{cues: [{from, to, text}], duration, width, height}`), then `npm run render:captions` renders a
transparent caption track to `out/captions.mov` sized to the cut; overlay it the same way as the overlays. The brew ffmpeg
has no `subtitles`/`drawtext` filter, which is why captions go through Remotion.

Needs: FFmpeg (`brew install ffmpeg`), Node 22+. `out/`, `assets/` and media files are gitignored. The video plan is in `SCRIPT.md`. Captions: OpenAI Whisper API (`api.openai.com`), local Whisper models are not downloadable in the cloud container.
