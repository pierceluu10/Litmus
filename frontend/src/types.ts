// Mirrors shared/contract.md. Snake_case on the wire, kept as-is here.
export type ProvKind = 'highlight' | 'note' | 'conversation' | 'passage' | 'document' | 'search' | 'human'
export type Provenance = { kind: ProvKind; id: string; doc_id?: string; doc_title?: string; text: string; papiers_url?: string }
export type Document = { id: string; title: string; authors: string[]; year?: number; url?: string; highlight_count: number; note_count: number; papiers_url?: string }
export type Claim = { id: string; text: string; doc_id: string; doc_title: string; annotation?: string; weight: number; rank: number; conditions?: string; page?: number; provenance: Provenance[] }

export type Knobs = { label_smoothing: number; epochs: number; tta_level: 0 | 1 | 2; flip: 'random' | 'alternating' | 'none'; mixup_alpha: number; cutout: number; lr_scale: number; whiten: boolean; dirac_init: boolean; translate: number }
export type Predicted = 'improves' | 'hurts' | 'no_effect'
export type Proposal = { id: string; star_id: string; title: string; hypothesis: string; predicted: Predicted; knob_changes: Partial<Knobs>; condition_notes: string; provenance: Provenance[]; agent_recommended: boolean; status?: 'open' | 'dispatched' | 'skipped' }
export type RunResult = { seed: number; val_acc: number; tta_val_acc?: number; time_seconds: number }
export type Verdict = 'confirmed' | 'refuted' | 'inconclusive' | 'baseline'
export type Grade = { metric: 'val_acc' | 'tta_val_acc'; mean_parent: number; mean_child: number; delta: number; sd_parent: number; sd_child: number; n: number; ci_low: number; ci_high: number; p_value: number; verdict: Verdict; practical: boolean; grader_version: string }
export type StarStatus = 'queued' | 'running' | 'done' | 'failed' | 'waiting'
export type ChosenBy = 'human' | 'agent' | 'auto' | 'shadow'
export type Progress = { seed: number; epoch: number; val_acc: number }
export type Star = {
  id: string; parent_id: string | null; depth: number; title: string; hypothesis: string
  knobs: Knobs; knob_changes: Partial<Knobs>; provenance: Provenance[]; chosen_by: ChosenBy
  status: StarStatus; predicted?: Predicted; proposal_id?: string; shadow_of?: string
  progress?: Progress[]; runs: RunResult[]; parent_runs: RunResult[]; grade?: Grade
  reflection?: string; error?: string; created_at: string; finished_at?: string
}
export type QuestionOption = { id: string; label: string; consequence: string }
export type Question = { id: string; star_id: string; text: string; evidence: Provenance[]; options: QuestionOption[]; agent_leaning?: string; status: 'open' | 'answered'; answer?: { option_id: string; comment?: string } }
export type Decision = { id: string; star_id: string; kind: 'dispatch' | 'answer' | 'feedback'; agent_recommendation: string; human_choice: string; agent_recommendation_ids?: string[]; human_choice_ids?: string[]; changed_trajectory: boolean; note: string; created_at: string }
export type Abstract = { text: string; findings: string[]; citations: Provenance[] }
export type SessionStatus = 'running' | 'paused' | 'waiting_human' | 'done'
export type SessionState = { id: string; goal: string; status: SessionStatus; stars: Star[]; proposals: Proposal[]; questions: Question[]; decisions: Decision[]; abstract?: Abstract; budget_used: number; budget_total: number; replay?: boolean; created_at?: string }
export type Selection = { proposal_id: string; knob_overrides?: Partial<Knobs> }

export type LitmusEvent = { seq: number; ts: string; session_id: string; type: string; payload: any }
