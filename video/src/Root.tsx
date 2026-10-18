import { Composition } from 'remotion'
import { Overlays, type Cue, FPS, DURATION } from './Overlays'
import { Captions, captionsMetadata } from './Captions'
import { Terms, type TermCue } from './Terms'

const cues: Cue[] = [
  { kind: 'lower', from: 0.5, to: 4, title: 'Your Name', subtitle: 'Role' },
  { kind: 'callout', from: 5, to: 9, text: 'Highlights become experiments', x: 0.62, y: 0.3 },
  { kind: 'credits', from: 22, to: 29, lines: ['Litmus', 'Built at Hack the Valley 11', 'airbench by Keller Jordan'] },
]

// Times (seconds) are from the Whisper word timestamps of assets/Litmus_Demo_HTV.mp4; numbers are the ones shown on screen.
const terms: TermCue[] = [
  { from: 14.7, to: 18.7, term: 'Papiers', def: 'A research reader where you highlight and annotate papers. Litmus reads those highlights.' },
  { from: 29.9, to: 33.6, term: '1 · Connect your Papiers' },
  { from: 34.7, to: 38.7, term: 'API token', def: 'A private key that lets Litmus read your Papiers library. Masked on screen, never stored.' },
  { from: 48.3, to: 52.6, term: 'CIFAR-10', def: '60,000 tiny 32×32 photos in 10 classes (planes, cats, ships…). A standard test for image models.' },
  { from: 59.2, to: 62.8, term: '2 · Pick a claim to test' },
  { from: 65.5, to: 69.3, term: 'Knowledge distillation', def: 'Training a small model to copy the predictions of a larger one.' },
  { from: 69.4, to: 73.0, term: '3 · Agents run real experiments' },
  { from: 73.2, to: 77.0, term: 'Agent', def: 'An AI that plans one experiment, runs it, reads the result and suggests what to try next.' },
  { from: 77.2, to: 81.2, term: 'Mixup', def: 'Trains on blends of two images and their labels, e.g. 70% cat + 30% dog.' },
  { from: 90.9, to: 94.9, term: 'Baseline', def: 'The unchanged training setup every experiment is compared against.' },
  { from: 96.8, to: 101.3, term: 'Test-time augmentation (TTA)', def: 'Predicts on flipped and shifted copies of each test image and averages the answers.' },
  { from: 105.8, to: 109.8, term: '93.94% accuracy', def: 'The share of the 10,000 CIFAR-10 test images the baseline labels correctly.' },
  { from: 113.4, to: 117.4, term: 'Confirmed', def: 'The result went the way the paper predicted, and its 95% confidence interval rules out seed noise.' },
  { from: 118.5, to: 122.4, term: 'Parallel agents', def: 'Several experiments run at once, each on its own GPU.' },
  { from: 123.4, to: 127.0, term: 'Modal', def: 'A cloud platform that runs our training code on rented GPUs.' },
  { from: 127.1, to: 131.3, term: 'Cloud GPU', def: 'An NVIDIA A100. One airbench training run takes about 4 seconds of GPU time.' },
  { from: 133.1, to: 136.6, term: '4 · Ask Litmus about any result' },
  { from: 148.8, to: 152.4, term: 'Mixup α (alpha)', def: 'How strongly two images are blended. α = 1 mixes them heavily.' },
  { from: 152.5, to: 158.5, term: 'Litmus · Papiers’ best friend' },
]

export const Root = () => (
  <>
    <Composition id="Overlays" component={Overlays} width={1920} height={1080} fps={FPS} durationInFrames={DURATION}
      defaultProps={{ cues }} />
    {/* sized and timed by its props: render with --props=assets/captions.json (see README) */}
    <Composition id="Captions" component={Captions} calculateMetadata={captionsMetadata} width={1920} height={1080} fps={FPS}
      durationInFrames={FPS} defaultProps={{ cues: [], duration: 1, width: 1920, height: 1080 }} />
    <Composition id="Terms" component={Terms} width={960} height={624} fps={FPS} durationInFrames={Math.round(161.7 * FPS)}
      defaultProps={{ cues: terms }} />
  </>
)
