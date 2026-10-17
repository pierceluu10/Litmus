import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Billboard, CameraControls, Html, Line, useGLTF } from '@react-three/drei'
import { Box3, MathUtils, Vector3, type Mesh } from 'three'
import type { Line2 } from 'three-stdlib'
import { useStore } from '../store'
import { FIRST_STEP, layoutStars, type Pos } from '../lib/layout'
import { agentDetail, agentName, pts, progressFraction, provMatches, starTone, type Tone } from '../lib/format'
import type { Star } from '../types'

const STATUE_URL = '/litmus-statue.glb'
const STATUE_COLOR = '#e3e8ef' // cool marble, close to the ground so the statue reads as a relief in the same material
const BLOB_COLOR = '#2b2f34'
const NODE_FACE_COLOR = '#3b4048' // a touch lighter than the fingertip, so each flat facet catches the light
const NODE_DETAIL = 1 // icosahedron subdivisions: 80 flat faces, a low-poly sphere
const SPIN_IDLE = 0.25, SPIN_TRAINING = 1.6 // radians per second
const BLOB_RADIUS = 4.2
const ROOT_RADIUS = 5.6
const EDGE_SEGMENTS = 24
const EASE = 4 // per second; how quickly stars glide to new positions
// Verdict colours are read from the CSS tokens so the scene and the panels never disagree.
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const toneColor = (t: Tone) => css(`--color-${t}`)
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// Camera framing: a fixed offset from the focused star, slightly from the right so sibling depth reads,
// aimed left of and below the star so the statue stays in frame and the star clears the proposal dock.
// A locked view of the tree: the user can zoom within limits but never rotate or pan. The default is swung a little
// toward the nodes' side, so the tree is met more head-on.
const VIEW = new Vector3(-48, 30, 345)
const MIN_DISTANCE = 170
const MAX_DISTANCE = 760
const FOV_HALF_TAN = Math.tan(MathUtils.degToRad(15)) // the canvas's fov is 30
const USABLE_HEIGHT = 0.62 // share of the canvas free of the top buttons and the bottom dock
const AIM = new Vector3(-14, -18, 0)
// Opening shot: from just behind the statue's head and ear, looking over its shoulder toward the arm.
// The head is near (-69, 16, -5) in scene units. The camera then glides to the default view, once per session.
const EAR_CAM = new Vector3(-70, 24, -70)
const EAR_AIM = new Vector3(-50, 12, 40)
const INTRO_HOLD_MS = 900
const INTRO_SMOOTH = 1.5
const PORTRAIT_ASPECT = 0.9
const PORTRAIT_PULLBACK = 1.7

function Statue() {
  const { scene } = useGLTF(STATUE_URL)
  const geometry = useMemo(() => {
    let g: Mesh['geometry'] | undefined
    scene.traverse((o) => { if ((o as Mesh).isMesh) g = (o as Mesh).geometry })
    return g!
  }, [scene])
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={STATUE_COLOR} roughness={0.82} metalness={0.04} flatShading />
    </mesh>
  )
}

// Where every star currently is (eased), shared by blobs and the lines between them.
type Live = Map<string, Vector3>

function StarBlob({ star, target, live, dim, selected }: { star: Star; target: Pos; live: Live; dim: boolean; selected: boolean }) {
  const select = useStore((s) => s.select)
  const group = useRef<import('three').Group>(null)
  const body = useRef<Mesh>(null)
  const [hover, setHover] = useState(false)
  const tone = starTone(star)
  const r = star.parent_id ? BLOB_RADIUS : ROOT_RADIUS
  const running = star.status === 'running' || star.status === 'queued'
  const progress = running ? Math.max(0.04, progressFraction(star)) : 1
  const shadow = star.chosen_by === 'shadow'
  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    if (!live.has(star.id)) {
      // new stars are born at their parent and glide out
      const from = star.parent_id ? live.get(star.parent_id) : undefined
      live.set(star.id, from ? from.clone() : new Vector3(0, 0, 0))
    }
    const p = live.get(star.id)!
    const k = reducedMotion() ? 1 : 1 - Math.exp(-EASE * dt)
    p.lerp(new Vector3(target.x, target.y, target.z), k)
    g.position.copy(p)
    const s = MathUtils.lerp(g.scale.x, selected ? 1.3 : hover ? 1.14 : 1, k)
    g.scale.setScalar(s)
    // the node turns slowly, and faster while its experiment trains, so the facets glint
    if (body.current && !reducedMotion()) { body.current.rotation.y += dt * (running ? SPIN_TRAINING : SPIN_IDLE); body.current.rotation.x += dt * 0.4 * (running ? SPIN_TRAINING : SPIN_IDLE) }
  })
  const g = star.grade
  const value = !g ? (running ? 'training' : star.status === 'waiting' ? 'needs you' : star.status === 'failed' ? 'stopped' : '')
    : g.verdict === 'baseline' ? `${(g.mean_child * 100).toFixed(2)}%` : `${pts(g.delta)}`
  return (
    <group ref={group}>
      <mesh
        ref={body}
        onClick={(e) => { e.stopPropagation(); select(star.id) }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = '' }}
      >
        <icosahedronGeometry args={[r, NODE_DETAIL]} />
        <meshStandardMaterial color={NODE_FACE_COLOR} roughness={0.5} metalness={0.15} flatShading transparent opacity={dim ? 0.18 : shadow ? 0.55 : 1} />
      </mesh>
      <Billboard>
        <mesh>
          <torusGeometry args={[r + 2.1, star.status === 'waiting' ? 0.55 : 0.36, 10, 64, Math.PI * 2 * progress]} />
          <meshBasicMaterial color={toneColor(tone)} transparent opacity={dim ? 0.15 : 1} />
        </mesh>
      </Billboard>
      <Html center position={[0, -r - 5.5, 0]} zIndexRange={[20, 0]} style={{ opacity: dim ? 0.25 : 1, transition: 'opacity 200ms' }}>
        <button type="button" className="star-label" data-selected={selected || undefined} onClick={() => select(star.id)} aria-label={`${agentName(star)}, ${star.title}`}>
          <span className="star-label-name">{agentName(star)}{shadow && <span className="text-muted"> · alone</span>}</span>
          <span className="star-label-value" style={{ color: toneColor(tone) }}>{[star.parent_id && agentDetail(star), value].filter(Boolean).join('  ')}</span>
        </button>
      </Html>
    </group>
  )
}

function Edge({ star, live, dim, onPath }: { star: Star; live: Live; dim: boolean; onPath: boolean }) {
  const line = useRef<Line2>(null)
  const origin = useMemo(() => new Vector3(0, 0, 0), [])
  const points = useMemo(() => Array.from({ length: EDGE_SEGMENTS + 1 }, () => new Vector3()), [])
  const running = star.status === 'running' || star.status === 'queued'
  const shadow = star.chosen_by === 'shadow'
  useFrame((_, dt) => {
    const a = star.parent_id ? live.get(star.parent_id) : origin, b = live.get(star.id)
    if (!a || !b || !line.current) return
    // a soft arc: leave the parent horizontally, then bend toward the child's slot in its column
    for (let i = 0; i <= EDGE_SEGMENTS; i++) {
      const t = i / EDGE_SEGMENTS, e = t * t * (3 - 2 * t)
      points[i].set(MathUtils.lerp(a.x, b.x, t), MathUtils.lerp(a.y, b.y, e), MathUtils.lerp(a.z, b.z, e))
    }
    line.current.geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]))
    if (running && !reducedMotion()) line.current.material.dashOffset -= dt * 6
  })
  const color = shadow ? '#9aa2ac' : onPath ? '#16191d' : '#4a5058'
  return <Line ref={line} points={points} color={color} lineWidth={onPath ? 2.6 : 1.5} dashed={running || shadow} dashSize={running ? 2.2 : 3} gapSize={running ? 1.6 : 2.4} transparent opacity={dim ? 0.15 : 1} />
}

function Fingertip() {
  const ref = useRef<Mesh>(null)
  useFrame(({ clock }) => { if (ref.current && !reducedMotion()) ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 2.4) * 0.25) })
  return <mesh ref={ref}><sphereGeometry args={[1.1, 16, 16]} /><meshBasicMaterial color={BLOB_COLOR} /></mesh>
}

function CameraRig({ positions, parents }: { positions: Map<string, Pos>; parents: Map<string, string | null> }) {
  // held in state (not a plain ref) so the effects below run again once the controls exist
  const [ctl, setCtl] = useState<CameraControls | null>(null)
  const { focusId, fitAll } = useStore()
  // frame the whole column the focused star belongs to (its generation), at the midpoint between it and its parent
  const star = focusId ? positions.get(focusId) : undefined
  const from = focusId ? positions.get(parents.get(focusId) ?? '') ?? star : undefined
  const column = star ? [...positions.values()].filter((p) => Math.abs(p.x - star.x) < 1).map((p) => p.y) : []
  const half = column.length ? (Math.max(...column) - Math.min(...column)) / 2 : 0 // half the column's height
  const focus = star && from ? { x: (star.x + from.x) / 2, y: column.length ? (Math.max(...column) + Math.min(...column)) / 2 : star.y, z: (star.z + from.z) / 2 } : { x: FIRST_STEP, y: 0, z: 0 }
  const portrait = useThree((s) => s.size.width / s.size.height) < PORTRAIT_ASPECT // narrow screens see less width: pull back
  const introDone = useRef(false)
  const wasFit = useRef(false)
  // the default view; later moves keep whatever zoom the user chose, only the target moves
  const toDefault = (animated: boolean, keepZoom: boolean) => {
    const c = ctl
    if (!c) return
    const t = new Vector3(focus.x, focus.y, focus.z).add(AIM)
    // far enough that the whole column fits; a taller column zooms out, and a zoom the user chose is kept if it is wider
    const fits = (half + 18) / (FOV_HALF_TAN * USABLE_HEIGHT)
    const dist = Math.max(VIEW.length() * (portrait ? PORTRAIT_PULLBACK : 1), fits, keepZoom && c.distance ? c.distance : 0)
    const view = VIEW.clone().setLength(Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, dist)))
    c.setLookAt(t.x + view.x, t.y + view.y, t.z + view.z, t.x, t.y, t.z, animated)
  }
  useEffect(() => {
    const c = ctl
    if (!c || fitAll) return
    if (!introDone.current && !reducedMotion()) {
      c.minDistance = 40 // the opening shot is closer than the zoom limit allows
      c.setLookAt(EAR_CAM.x, EAR_CAM.y, EAR_CAM.z, EAR_AIM.x, EAR_AIM.y, EAR_AIM.z, false)
      c.smoothTime = INTRO_SMOOTH
      const go = window.setTimeout(() => {
        introDone.current = true
        c.minDistance = MIN_DISTANCE
        toDefault(true, false)
        window.setTimeout(() => { c.smoothTime = 0.6 }, 2800)
      }, INTRO_HOLD_MS)
      return () => window.clearTimeout(go)
    }
    toDefault(!reducedMotion(), true)
  }, [ctl, focus.x, focus.y, focus.z, half, portrait]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const c = ctl
    if (!c) return
    if (fitAll) {
      const box = new Box3().setFromPoints([new Vector3(-40, -30, 0), ...[...positions.values()].map((p) => new Vector3(p.x, p.y, p.z))])
      box.expandByScalar(16)
      c.minDistance = 40
      c.fitToBox(box, !reducedMotion(), { paddingLeft: 10, paddingRight: 40, paddingTop: 30, paddingBottom: 30 })
    } else if (wasFit.current) { c.minDistance = MIN_DISTANCE; toDefault(!reducedMotion(), false) }
    wasFit.current = fitAll
  }, [ctl, fitAll, positions.size]) // eslint-disable-line react-hooks/exhaustive-deps
  return <CameraControls ref={setCtl} makeDefault minDistance={MIN_DISTANCE} maxDistance={MAX_DISTANCE} smoothTime={0.6} azimuthRotateSpeed={0} polarRotateSpeed={0} truckSpeed={0} />
}

function Stars({ stars }: { stars: Star[] }) {
  const { selectedId, hoveredClaim } = useStore()
  const positions = useMemo(() => layoutStars(stars), [stars])
  const parents = useMemo(() => new Map(stars.map((s) => [s.id, s.parent_id])), [stars])
  const [live] = useState<Live>(() => new Map())
  const byId = new Map(stars.map((s) => [s.id, s]))
  const path = new Set<string>()
  for (let s = selectedId ? byId.get(selectedId) : undefined; s; s = s.parent_id ? byId.get(s.parent_id) : undefined) path.add(s.id)
  const dim = (s: Star) => !!hoveredClaim && !s.provenance.some((p) => provMatches(p, hoveredClaim))
  return (
    <>
      {stars.map((s) => <Edge key={`e${s.id}`} star={s} live={live} dim={dim(s)} onPath={path.has(s.id)} />)}
      {stars.map((s) => <StarBlob key={s.id} star={s} target={positions.get(s.id)!} live={live} dim={dim(s)} selected={s.id === selectedId} />)}
      <CameraRig positions={positions} parents={parents} />
    </>
  )
}

function Background() {
  const { gl } = useThree()
  useEffect(() => { gl.setClearColor(0x000000, 0) }, [gl])
  return null
}

export function Scene() {
  const stars = useStore((s) => s.app.session?.stars ?? NO_STARS)
  return (
    <Canvas className="!absolute inset-0" camera={{ fov: 30, near: 1, far: 3000, position: [12, -4, 300] }} dpr={[1, 2]}
      aria-label="Research tree: each node is an experiment, each column a generation">
      <Background />
      <hemisphereLight args={['#ffffff', '#a6b4c8', 0.9]} />
      <directionalLight position={[-140, 160, 140]} intensity={2.1} />
      <directionalLight position={[180, 30, -60]} intensity={0.45} />
      <Suspense fallback={null}><Statue /></Suspense>
      <Fingertip />
      <Stars stars={stars} />
    </Canvas>
  )
}

const NO_STARS: Star[] = []
useGLTF.preload(STATUE_URL)
