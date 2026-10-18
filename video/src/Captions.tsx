import '@fontsource-variable/geist'
import type { CalculateMetadataFunction } from 'remotion'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { FPS } from './Overlays'

// Burned-in captions for the edited demo: one short line at a time, bottom centre, sized to the video they go over.
// Cues come from the transcript (word timestamps mapped onto the edited timeline), passed as props.
export type Caption = { from: number; to: number; text: string }
export type CaptionProps = { cues: Caption[]; duration: number; width: number; height: number }

const FONT = '"Geist Variable", Inter, system-ui, sans-serif'
const FADE_FRAMES = 3
const MAX_WIDTH = 1100 // px: long lines stay clear of the face cam in either bottom corner

export const captionsMetadata: CalculateMetadataFunction<CaptionProps> = ({ props }) => ({
  durationInFrames: Math.ceil(props.duration * FPS), width: props.width, height: props.height,
})

export const Captions = ({ cues }: CaptionProps) => {
  const f = useCurrentFrame()
  const cue = cues.find((c) => f >= c.from * FPS && f < c.to * FPS)
  if (!cue) return null
  const opacity = interpolate(f, [cue.from * FPS, cue.from * FPS + FADE_FRAMES, cue.to * FPS - FADE_FRAMES, cue.to * FPS], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ fontFamily: FONT, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 46 }}>
      <div style={{ opacity, maxWidth: MAX_WIDTH, background: 'rgba(14,16,22,.82)', color: '#fff', padding: '10px 24px', borderRadius: 14,
        fontSize: 42, fontWeight: 560, lineHeight: 1.25, letterSpacing: '-0.01em', textAlign: 'center' }}>
        {cue.text}
      </div>
    </AbsoluteFill>
  )
}
