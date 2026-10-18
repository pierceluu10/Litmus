import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'

export const FPS = 30
export const DURATION = 30 * FPS
export type Cue =
  | { kind: 'lower'; from: number; to: number; title: string; subtitle?: string }
  | { kind: 'callout'; from: number; to: number; text: string; x: number; y: number }
  | { kind: 'credits'; from: number; to: number; lines: string[] }

const FONT = 'Geist, Inter, system-ui, sans-serif'
// opacity ramps in and out over 0.3s so cues never pop
const fade = (f: number, a: number, b: number) =>
  interpolate(f, [a * FPS, a * FPS + 9, b * FPS - 9, b * FPS], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

export const Overlays = ({ cues }: { cues: Cue[] }) => {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      {cues.map((c, i) => {
        const o = fade(f, c.from, c.to)
        if (o <= 0) return null
        if (c.kind === 'lower') return (
          <div key={i} style={{ position: 'absolute', left: 80, bottom: 90, opacity: o, background: 'rgba(20,22,28,.88)', color: '#fff', padding: '16px 28px', borderRadius: 14, borderLeft: '6px solid #4f7cff' }}>
            <div style={{ fontSize: 40, fontWeight: 650 }}>{c.title}</div>
            {c.subtitle && <div style={{ fontSize: 26, opacity: .75 }}>{c.subtitle}</div>}
          </div>)
        if (c.kind === 'callout') return (
          <div key={i} style={{ position: 'absolute', left: `${c.x * 100}%`, top: `${c.y * 100}%`, opacity: o, transform: `translateY(${(1 - o) * 14}px)`, background: '#4f7cff', color: '#fff', padding: '14px 24px', borderRadius: 999, fontSize: 34, fontWeight: 600, boxShadow: '0 8px 30px rgba(0,0,0,.3)' }}>
            {c.text}
          </div>)
        return (
          <AbsoluteFill key={i} style={{ opacity: o, background: 'rgba(10,12,18,.92)', color: '#fff', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
            {c.lines.map((l, j) => <div key={j} style={{ fontSize: j ? 38 : 84, fontWeight: j ? 400 : 700, margin: '10px 0', opacity: j ? .8 : 1 }}>{l}</div>)}
          </AbsoluteFill>)
      })}
    </AbsoluteFill>
  )
}
