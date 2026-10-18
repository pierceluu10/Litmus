import '@fontsource-variable/geist'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { FPS } from './Overlays'

// Small cards over the finished cut (960×624): a definition for each technical term as it is said, and a chip for each
// part of the demo. Top centre, under the browser bar, clear of the burned-in captions and the face bubble.
export type TermCue = { from: number; to: number; term: string; def?: string }
const FONT = '"Geist Variable", Inter, system-ui, sans-serif'

export const Terms = ({ cues }: { cues: TermCue[] }) => {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      {cues.map((c, i) => {
        const o = interpolate(f, [c.from * FPS, c.from * FPS + 8, c.to * FPS - 8, c.to * FPS], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        if (o <= 0) return null
        const lift = (1 - o) * 8
        return (
          <div key={i} style={{ position: 'absolute', top: 106, left: '50%', transform: `translate(-50%, ${-lift}px)`, opacity: o }}>
            {c.def
              ? (
                <div style={{ width: 360, background: 'rgba(21,24,28,.9)', color: '#fff', borderRadius: 12, padding: '9px 14px 10px', boxShadow: '0 6px 20px rgba(0,0,0,.25)' }}>
                  <div style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-.01em' }}>{c.term}</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.35, opacity: 0.82, marginTop: 2 }}>{c.def}</div>
                </div>)
              : <div style={{ background: '#fff', color: '#15181c', border: '1px solid #d6dbe2', borderRadius: 999, padding: '6px 14px', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(43,58,82,.18)' }}>{c.term}</div>}
          </div>)
      })}
    </AbsoluteFill>
  )
}
