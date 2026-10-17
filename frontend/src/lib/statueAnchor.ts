// Where the statue's head is on screen, in client pixels. The 3D scene writes it every frame; DOM overlays read it.
export type Point = { x: number; y: number }
export const statueAnchor: { head: Point; crown: Point; visible: boolean } = { head: { x: 0, y: 0 }, crown: { x: 0, y: 0 }, visible: false }
