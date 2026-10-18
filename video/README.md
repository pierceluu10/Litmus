# Demo video tooling

Overlays (name titles, feature callouts, credits) are Remotion compositions in `src/`; edit the `cues` list in
`src/Root.tsx` (times in seconds). FFmpeg then composites them over the screen recording, face video and voiceover.

```bash
cd video && npm install
# Preview: npm run studio
# Render a transparent overlay track (headless-shell path is this container's; elsewhere drop the flag):
npx remotion render src/index.ts Overlays out/overlays.mov --codec=prores --prores-profile=4444 \
  --pixel-format=yuva444p10le --browser-executable=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
# Composite over footage:
ffmpeg -i screen.mp4 -i out/overlays.mov -filter_complex "[0][1]overlay" -c:a copy out/final.mp4
```

Needs: FFmpeg, Node 22. Captions: OpenAI Whisper API (`api.openai.com`), local Whisper models are not downloadable in the cloud container.
