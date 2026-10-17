import type { Abstract, ChatTurn, Claim, Document, LitmusEvent, Provenance, Selection } from '../types'

export type Health = { ok: boolean; modal_warm: boolean; papiers_ok: boolean; openai_ok: boolean }
export const DEFAULT_GOAL = 'Which of the training tricks I highlighted hold for a ~10-epoch CIFAR-10 run?'
export type ConnState = 'connecting' | 'live' | 'reconnecting' | 'closed'
// The order the backend reads Papiers in (GET /api/library/stream).
export const LIBRARY_STAGES = ['papers', 'highlights', 'notes', 'summaries'] as const
export type LibraryStage = (typeof LIBRARY_STAGES)[number]
export type Library = { documents: Document[]; claims: Claim[] }
export class LibraryUnavailable extends Error {}

// One interface, two implementations: mock.ts (in-browser script) and real.ts (REST + WebSocket).
export interface Api {
  readonly mock: boolean
  health(): Promise<Health>
  warmup(): Promise<void>
  library(onStage: (stage: LibraryStage) => void, signal: AbortSignal): Promise<Library>
  createSession(body: { goal?: string; budget_gpu_seconds?: number; auto_mode?: boolean; fresh?: boolean }): Promise<string>
  replayDemo(): Promise<string>
  subscribe(sessionId: string, fromSeq: number, onEvent: (e: LitmusEvent) => void, onConn: (c: ConnState) => void): () => void
  dispatch(sid: string, body: { star_id: string; selections: Selection[]; instruction?: string }): Promise<void>
  answer(sid: string, body: { question_id: string; option_id: string; comment?: string }): Promise<void>
  feedback(sid: string, body: { star_id: string; kind: 'challenge' | 'suggest' | 'prioritize'; text: string }): Promise<void>
  explain(sid: string, body: { star_id: string; question?: string; history?: ChatTurn[] }): Promise<{ answer: string; provenance: Provenance[] }>
  pause(sid: string): Promise<void>
  resume(sid: string): Promise<void>
  stopBranch(sid: string, star_id: string): Promise<void>
  abstract(sid: string): Promise<{ abstract: string | Abstract; findings: string[] }>
  exportMarkdown(sid: string): Promise<string>
}
