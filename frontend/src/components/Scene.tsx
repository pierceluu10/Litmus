import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Billboard, CameraControls, Html, Line, useGLTF } from '@react-three/drei'
import { Box3, MathUtils, Vector3, type Group, type Mesh } from 'three'
import type { Line2 } from 'three-stdlib'
import { useStarting, useStore } from '../store'
import { FIRST_STEP, layoutStars, UNITS_PER_POINT, type Pos } from '../lib/layout'
import { agentName, progressFraction, provMatches, starTone, type Tone } from '../lib/format'
import type { Star } from '../types'
import { NodeCard, PlacedCard } from './NodeBubble'
import { statueAnchor, type Point } from '../lib/statueAnchor'

const STATUE_URL = '/litmus-statue.glb'
const STATUE_COLOR = '#e3e8ef' // cool marble, close to the ground so the statue reads as a relief in the same material
const BLOB_COLOR = '#2b2f34'
const RING_OUTSET = 2.6 // scene units from a node's surface to the outside of its verdict ring
const LEVEL_COLOR = '#c5cfdc'
const LEVEL_BASE_COLOR = '#93a3b8'
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
const MAX_DISTANCE = 520 // the farthest you can zoom out: past this the labels and cards stop matching the scene's scale
const FOV_HALF_TAN = Math.tan(MathUtils.degToRad(15)) // the canvas's fov is 30
const USABLE_HEIGHT = 0.62 // share of the canvas free of the top buttons and the bottom dock
// Where the focused agent sits on screen: centred in the room the results card leaves, and a little below the middle so
// its card (which opens above it) has space. Pixels; the results card covers PANEL_PX of the right edge on wide screens.
const PANEL_PX = 384
const WIDE_PX = 1024
const ABOVE_MIDDLE = 0.1 // share of the canvas height the focused group sits above its centre: room for a card above, clear of the bottom card
// Opening shot: from just behind the statue's head and ear, looking over its shoulder toward the arm.
// The head is near (-69, 16, -5) in scene units. The camera then glides to the default view, once per session.
const EAR_CAM = new Vector3(-70, 24, -70)
const EAR_AIM = new Vector3(-50, 12, 40)
const INTRO_HOLD_MS = 250
const INTRO_SMOOTH = 1.5
const PORTRAIT_ASPECT = 0.9
const PORTRAIT_PULLBACK = 1.7

// The statue's head in scene units (see EAR_CAM), and a point above it for the Thinking label.
const HEAD = new Vector3(-69, 16, -5)
const CROWN = new Vector3(-69, 31, -5)
// While a question is with Litmus the camera turns to the statue: its head left of centre, the arm leading right.
const CONSULT_AIM = new Vector3(HEAD.x + 38, HEAD.y - 14, HEAD.z)

function HeadTracker() {
  const v = useMemo(() => new Vector3(), [])
  useFrame(({ camera, gl }) => {
    const r = gl.domElement.getBoundingClientRect()
    const put = (p: Vector3, out: Point) => {
      v.copy(p).project(camera)
      out.x = r.left + ((v.x + 1) / 2) * r.width
      out.y = r.top + ((1 - v.y) / 2) * r.height
      return v.z < 1
    }
    const front = put(HEAD, statueAnchor.head)
    put(CROWN, statueAnchor.crown)
    const { x, y } = statueAnchor.head
    statueAnchor.visible = front && x >= r.left && x <= r.right && y >= Math.max(r.top, 0) && y <= Math.min(r.bottom, innerHeight)
  })
  return null
}


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

// Low-poly eyes that sit on the front of a node (a billboard, so they always face you): flat-shaded white gems with dark
// pupils. They blink every few seconds, look around while the experiment trains and glance up when the node needs you.
function Eye({ r, side, running, waiting }: { r: number; side: number; running: boolean; waiting: boolean }) {
  const pupil = useRef<Group>(null)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime, g = pupil.current
    if (!g) return
    g.position.x = MathUtils.lerp(g.position.x, running ? Math.sin(t * 2 + side) * r * 0.06 : 0, 0.15)
    g.position.y = MathUtils.lerp(g.position.y, waiting ? r * 0.06 : 0, 0.15)
  })
  return (
    <group position={[side * r * 0.4, 0, 0]}>
      <mesh scale={[1, 1.2, 0.55]}><icosahedronGeometry args={[r * 0.28, 0]} /><meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.45} flatShading /></mesh>
      <group ref={pupil} position={[0, 0, r * 0.1]}>
        <mesh scale={[1, 1.15, 0.5]}><icosahedronGeometry args={[r * 0.15, 0]} /><meshStandardMaterial color="#15181c" flatShading /></mesh>
        <mesh position={[r * 0.035, r * 0.05, r * 0.07]}><icosahedronGeometry args={[r * 0.04, 0]} /><meshBasicMaterial color="#ffffff" /></mesh>
      </group>
    </group>
  )
}

function Eyes({ r, running, waiting }: { r: number; running: boolean; waiting: boolean }) {
  const lids = useRef<Group>(null)
  useFrame(({ clock }) => {
    const g = lids.current
    if (g) g.scale.y = MathUtils.lerp(g.scale.y, clock.elapsedTime % 4.3 < 0.14 && !reducedMotion() ? 0.1 : 1, 0.5)
  })
  return (
    <Billboard>
      <group ref={lids} position={[0, r * 0.1, r * 0.98]}>
        <Eye r={r} side={-1} running={running} waiting={waiting} />
        <Eye r={r} side={1} running={running} waiting={waiting} />
      </group>
    </Billboard>
  )
}

// A low-poly light bulb at a finished node's top right: the agent has options for you. Click the node or the bulb.
function Bulb({ r, onClick }: { r: number; onClick: () => void }) {
  const bulb = useRef<Group>(null)
  const glow = useRef<Mesh>(null)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (bulb.current && !reducedMotion()) bulb.current.position.y = r * 1.4 + Math.sin(t * 2.2) * r * 0.06
    if (glow.current) glow.current.scale.setScalar(1.05 + Math.sin(t * 3) * 0.1)
  })
  return (
    <Billboard>
      <group ref={bulb} position={[r * 1.45, r * 1.4, 0]} rotation={[0, 0, -0.25]}
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = '' }}>
        <mesh ref={glow}><icosahedronGeometry args={[r * 0.9, 1]} /><meshBasicMaterial color="#f7d36b" transparent opacity={0.22} depthWrite={false} /></mesh>
        <mesh scale={[1, 1.15, 1]}><icosahedronGeometry args={[r * 0.52, 1]} /><meshStandardMaterial color="#f9d76a" emissive="#f6b73c" emissiveIntensity={0.9} flatShading /></mesh>
        <mesh position={[0, -r * 0.64, 0]}><cylinderGeometry args={[r * 0.23, r * 0.3, r * 0.27, 6]} /><meshStandardMaterial color="#d3d7de" metalness={0.3} roughness={0.5} flatShading /></mesh>
        <mesh position={[0, -r * 0.85, 0]}><cylinderGeometry args={[r * 0.24, r * 0.18, r * 0.18, 6]} /><meshStandardMaterial color="#8d95a3" metalness={0.3} roughness={0.5} flatShading /></mesh>
      </group>
    </Billboard>
  )
}

// Where every star currently is (eased), shared by blobs and the lines between them.
type Live = Map<string, Vector3>

function StarBlob({ star, target, live, dim, selected }: { star: Star; target: Pos; live: Live; dim: boolean; selected: boolean }) {
  const select = useStore((s) => s.select)
  const cardFor = useStore((s) => s.cardFor)
  // while a question flies to Litmus (and back) the camera swings to the statue: the card steps aside until it is over
  const consulting = useStore((s) => !!s.thought)
  const fitAll = useStore((s) => s.fitAll)
  const proposals = useStore((s) => s.app.session?.proposals) // the store's own array: filtering inside the selector would return a new one every render
  const options = useMemo(() => (proposals ?? []).filter((p) => p.star_id === star.id && p.status === 'open'), [proposals, star.id])
  const hasOptions = options.length > 0 && star.status === 'done'
  // graded, but its agent has not written its take and options yet (an LLM call on the real backend)
  const generating = useStore((st) => !!star.parent_id && star.status === 'done' && !!star.grade && !star.suggestion
    && st.app.session?.status !== 'done' && !(proposals ?? []).some((p) => p.star_id === star.id))
  const group = useRef<import('three').Group>(null)
  const body = useRef<Mesh>(null)
  const [hover, setHover] = useState(false)
  const tone = starTone(star)
  const r = star.parent_id ? BLOB_RADIUS : ROOT_RADIUS
  const running = star.status === 'running' || star.status === 'queued'
  const progress = running ? Math.max(0.04, progressFraction(star)) : 1
  const shadow = star.chosen_by === 'shadow'
  const ringPx = useRef(0) // the ring's on-screen radius, for placing this node's card
  useFrame(({ camera, size }, dt) => {
    const g = group.current
    if (!g) return
    ringPx.current = ((r + RING_OUTSET) * g.scale.x * size.height) / (2 * camera.position.distanceTo(g.position) * FOV_HALF_TAN)
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
  // clicking a node opens its card over it (about the agent, and where it should proceed); clicking again closes it
  const openNode = () => (cardFor === star.id ? useStore.setState({ cardFor: null }) : select(star.id))
  const g = star.grade
  const value = g ? `${(g.mean_child * 100).toFixed(2)}%` : running ? 'training' : star.status === 'waiting' ? 'needs you' : star.status === 'failed' ? 'stopped' : ''
  return (
    <group ref={group}>
      <mesh
        ref={body}
        onClick={(e) => { e.stopPropagation(); openNode() }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = '' }}
      >
        <icosahedronGeometry args={[r, NODE_DETAIL]} />
        <meshStandardMaterial color={NODE_FACE_COLOR} roughness={0.5} metalness={0.15} flatShading transparent opacity={dim ? 0.18 : shadow ? 0.55 : 1} />
      </mesh>
      <Eyes r={r} running={running} waiting={star.status === 'waiting'} />
      {hasOptions && <Bulb r={r} onClick={openNode} />}
      {cardFor === star.id && !fitAll && !consulting && (
        // the wrapper keeps the card's untransformed box at the node: it must not take clicks, only the card itself
        <Html position={[0, 0, 0]} zIndexRange={[60, 40]} style={{ pointerEvents: 'none' }}>
          <PlacedCard ringPx={ringPx}>{(side) => <NodeCard star={star} items={hasOptions ? options : []} generating={generating} side={side} />}</PlacedCard>
        </Html>
      )}
      <Billboard>
        <mesh>
          <torusGeometry args={[r + 2.1, star.status === 'waiting' ? 0.55 : 0.36, 10, 64, Math.PI * 2 * progress]} />
          <meshBasicMaterial color={toneColor(tone)} transparent opacity={dim ? 0.15 : 1} />
        </mesh>
      </Billboard>
      {/* anchored by its top edge, just under the ring, so the name never sits over the sphere */}
      <Html position={[0, -r - 4, 0]} zIndexRange={[20, 0]} style={{ opacity: dim ? 0.25 : 1, transition: 'opacity 200ms' }}>
        <div style={{ transform: 'translateX(-50%)', marginTop: 3 }}>
        <button type="button" className="star-label" data-selected={selected || undefined} onClick={openNode} aria-label={`${agentName(star)}, ${value}`}>
          <span className="star-label-name">{agentName(star)}</span>
          <span className="star-label-value" style={{ color: toneColor(tone) }}>{value}</span>
        </button>
        </div>
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
  const consulting = useStore((s) => !!s.thought && !s.thought.landed && !s.thought.oneWay) // the first claim flies in while the intro glides on
  // behind Litmus while you choose where to start, and until the claim you chose has flown into its head
  const choosing = useStarting(), claimFlying = useStore((s) => !!s.thought?.oneWay)
  const starting = choosing || claimFlying
  // the focused agent, its direct children and its whole column (the agents running beside it) share the middle of the
  // free part of the screen, so every one of them stays on screen and clickable; their spread decides how far out we need to be
  const star = focusId ? positions.get(focusId) : undefined
  const column = star ? [...positions.values()].filter((p) => Math.abs(p.x - star.x) < 1) : []
  const kids = star ? [...parents].filter(([, parent]) => parent === focusId).map(([id]) => positions.get(id)!).filter(Boolean) : []
  const xs = [star, ...kids].filter(Boolean).map((p) => p!.x), ys = [...column, ...kids].map((p) => p.y)
  const half = star ? (Math.max(...ys) - Math.min(...ys)) / 2 : 0
  const focus = star ? { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2, z: star.z } : { x: FIRST_STEP, y: 0, z: 0 }
  const size = useThree((s) => s.size)
  const portrait = size.width / size.height < PORTRAIT_ASPECT // narrow screens see less width: pull back
  const panel = innerWidth >= WIDE_PX ? PANEL_PX : 0 // the results card is always open on wide screens
  const introDone = useRef(false)
  const wasFit = useRef(false)
  // the default view; later moves keep whatever zoom the user chose, only the target moves
  const toDefault = (animated: boolean, keepZoom: boolean) => {
    const c = ctl
    if (!c) return
    // far enough that the whole column fits; a taller column zooms out, and a zoom the user chose is kept if it is wider.
    // Agents running side by side always fit, even past the zoom cap (which then only limits your own zooming)
    const fits = (half + 18) / (FOV_HALF_TAN * USABLE_HEIGHT)
    const dist = Math.max(fits, Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, VIEW.length() * (portrait ? PORTRAIT_PULLBACK : 1), keepZoom && c.distance ? c.distance : 0)))
    c.maxDistance = Math.max(MAX_DISTANCE, dist)
    // aim off the agent by the pixel offset it should sit at, converted to scene units at this distance
    const unitsPerPx = (2 * dist * FOV_HALF_TAN) / size.height
    const t = new Vector3(focus.x + (panel / 2) * unitsPerPx, focus.y - ABOVE_MIDDLE * size.height * unitsPerPx, focus.z)
    const view = VIEW.clone().setLength(dist)
    c.setLookAt(t.x + view.x, t.y + view.y, t.z + view.z, t.x, t.y, t.z, animated)
  }
  useEffect(() => {
    const c = ctl
    if (!c || fitAll) return
    if (!introDone.current && !reducedMotion()) {
      c.minDistance = 40 // the opening shot is closer than the zoom limit allows
      c.setLookAt(EAR_CAM.x, EAR_CAM.y, EAR_CAM.z, EAR_AIM.x, EAR_AIM.y, EAR_AIM.z, false)
      c.smoothTime = INTRO_SMOOTH
      if (starting) return // the glide to the graph follows your choice
      const go = window.setTimeout(() => {
        introDone.current = true
        c.minDistance = MIN_DISTANCE
        toDefault(true, false)
        window.setTimeout(() => { c.smoothTime = 0.6 }, 2800)
      }, INTRO_HOLD_MS)
      return () => window.clearTimeout(go)
    }
    toDefault(!reducedMotion(), true)
  }, [ctl, focus.x, focus.y, focus.z, half, portrait, panel, size.width, size.height, starting]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const c = ctl
    if (!c || !introDone.current) return
    if (consulting) {
      const view = VIEW.clone().setLength(Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, c.distance)))
      c.setLookAt(CONSULT_AIM.x + view.x, CONSULT_AIM.y + view.y, CONSULT_AIM.z + view.z, CONSULT_AIM.x, CONSULT_AIM.y, CONSULT_AIM.z, !reducedMotion())
    } else if (!fitAll) toDefault(!reducedMotion(), true)
  }, [ctl, consulting]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const c = ctl
    if (!c) return
    if (fitAll) {
      const box = new Box3().setFromPoints([new Vector3(-40, -30, 0), ...[...positions.values()].map((p) => new Vector3(p.x, p.y, p.z))])
      box.expandByScalar(16)
      c.minDistance = 40
      // keep every node out from under the results card: pad the right by the share of the width it covers
      const width = box.max.x - box.min.x, covered = panel / size.width
      c.fitToBox(box, !reducedMotion(), { paddingLeft: 10, paddingRight: 40 + (width * covered) / (1 - covered), paddingTop: 30, paddingBottom: 30 })
    } else if (wasFit.current) { c.minDistance = MIN_DISTANCE; toDefault(!reducedMotion(), false) }
    wasFit.current = fitAll
  }, [ctl, fitAll, positions.size, panel]) // eslint-disable-line react-hooks/exhaustive-deps
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
      <AccuracyLines positions={positions} base={stars[0]?.grade?.mean_child} />
      <CameraRig positions={positions} parents={parents} />
    </>
  )
}

// Five accuracy levels behind the graph, one point apart: the middle one runs through Litmus's fingertip, the baseline.
const ACCURACY_LEVELS = [2, 1, 0, -1, -2] // points relative to the baseline
const LEVELS_FROM = -26 // just behind the fingertip, so the baseline line reads as the arm's continuation
const LEVELS_PAST = 70 // how far the lines run beyond the last column

function AccuracyLines({ positions, base }: { positions: Map<string, Pos>; base?: number }) {
  const right = Math.max(FIRST_STEP, ...[...positions.values()].map((p) => p.x)) + LEVELS_PAST
  return (
    <>
      {ACCURACY_LEVELS.map((k) => {
        const y = k * UNITS_PER_POINT
        const label = k === 0 ? `baseline${base !== undefined ? ` ${(base * 100).toFixed(2)}%` : ''}`
          : `${k > 0 ? '+' : '−'}${Math.abs(k)} pt${base !== undefined ? ` · ${((base + k / 100) * 100).toFixed(2)}%` : ''}`
        return (
          <group key={k}>
            <Line points={[[LEVELS_FROM, y, -4], [right, y, -4]]} color={k === 0 ? LEVEL_BASE_COLOR : LEVEL_COLOR} lineWidth={1} dashed={k !== 0} dashSize={3} gapSize={3} transparent opacity={0.9} />
            <Html position={[right, y, -4]} zIndexRange={[5, 0]}><span className="level-label">{label}</span></Html>
          </group>
        )
      })}
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
      aria-label="Research tree: each node is an experiment, each column a generation"
      // only a click on the scene itself lets go: clicks inside a node's card bubble up here too and must not close it
      onPointerMissed={(e) => { const st = useStore.getState(); if ((e.target as Element).tagName === 'CANVAS' && (st.selectedId || st.cardFor)) st.select(null) }}>
      <Background />
      <hemisphereLight args={['#ffffff', '#a6b4c8', 0.9]} />
      <directionalLight position={[-140, 160, 140]} intensity={2.1} />
      <directionalLight position={[180, 30, -60]} intensity={0.45} />
      <Suspense fallback={null}><Statue /></Suspense>
      <Fingertip />
      <HeadTracker />
      <Stars stars={stars} />
    </Canvas>
  )
}

const NO_STARS: Star[] = []
useGLTF.preload(STATUE_URL)
