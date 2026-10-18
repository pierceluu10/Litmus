import { Composition } from 'remotion'
import { Overlays, type Cue, FPS, DURATION } from './Overlays'

const cues: Cue[] = [
  { kind: 'lower', from: 0.5, to: 4, title: 'Your Name', subtitle: 'Role' },
  { kind: 'callout', from: 5, to: 9, text: 'Highlights become experiments', x: 0.62, y: 0.3 },
  { kind: 'credits', from: 22, to: 29, lines: ['Litmus', 'Built at Hack the Valley 11', 'airbench by Keller Jordan'] },
]

export const Root = () => (
  <Composition id="Overlays" component={Overlays} width={1920} height={1080} fps={FPS} durationInFrames={DURATION}
    defaultProps={{ cues }} />
)
