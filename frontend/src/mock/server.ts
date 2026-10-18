import { applyEvent, initialState, type AppState } from '../reducer'
import type { Decision, Grade, Knobs, LitmusEvent, Predicted, Proposal, Provenance, Question, Selection, Star } from '../types'
import { agentName, knobText, pts } from '../lib/format'
import { BASELINE_KNOBS, baselineGrade, grade, progressAccuracy, simulateRun } from './sim'
import { P } from './library'

// In-browser stand-in for the backend: same events as shared/contract.md, numbers from the calibrated simulator.
// Same shape as the real engine: the human picks where to start, each agent offers its own next steps when its verdict
// lands ("Where should I proceed?"), and Litmus plans from the best star only when no agent has an open option.

const BUDGET_GPU_SECONDS = 1800
const SEEDS = [0, 1, 2, 3, 4]
const EXTRA_SEEDS = [5, 6, 7, 8, 9]
const MAX_STARS = 16
const MAX_PROPOSALS = 3
const SUGGEST_MS = 2400 // how long an agent takes to write its card, like the real backend's LLM call
const EPOCH_TICKS = 6
const TICK_MS = 380
const PREDICTION: Record<Predicted, string> = { improves: 'a gain', hurts: 'a loss', no_effect: 'no change' }

type Move = { key: string; title: (k: Knobs) => string; hypothesis: string; predicted: Predicted; changes: (k: Knobs) => Partial<Knobs> | null; prov: Provenance[]; note: string }

// What an agent can propose from any star, in priority order. Each move is tied to a highlight in the library.
const MOVES: Move[] = [
  { key: 'mixup', title: () => 'Mixup at the paper’s α = 1', hypothesis: 'Mixup improves accuracy even in a short run.', predicted: 'improves',
    changes: (k) => (k.mixup_alpha ? null : { mixup_alpha: 1 }), prov: [P.mix, P.mixNote], note: 'Paper: 200 epochs. Here: the parent’s budget.' },
  { key: 'gentle', title: () => 'Mixup at Bag of Tricks α = 0.2', hypothesis: 'A gentler mixup keeps the regularisation without the short-run penalty.', predicted: 'improves',
    changes: (k) => (k.mixup_alpha === 0.2 ? null : { mixup_alpha: 0.2 }), prov: [P.bot, P.mix], note: 'Bag of Tricks used α = 0.2.' },
  { key: 'tta', title: () => 'Turn off test-time augmentation', hypothesis: 'A real share of the accuracy comes from multi-crop TTA.', predicted: 'hurts',
    changes: (k) => (k.tta_level === 0 ? null : { tta_level: 0 }), prov: [P.tta, P.ttaNote], note: 'Measures evaluation-time gain, not training.' },
  { key: 'flip', title: () => 'Random flips instead of alternating', hypothesis: 'Alternating flips beat random flips by a small real margin.', predicted: 'hurts',
    changes: (k) => (k.flip === 'alternating' ? { flip: 'random' } : null), prov: [P.flip, P.flipNote], note: 'Paper reports ~0.1 pts; needs seeds.' },
  { key: 'smoothing', title: () => 'Remove label smoothing', hypothesis: 'Label smoothing still helps on a 10-epoch CIFAR run.', predicted: 'hurts',
    changes: (k) => (k.label_smoothing ? { label_smoothing: 0 } : null), prov: [P.ls, P.lsNote], note: 'Paper: ImageNet, ~0.2%.' },
  { key: 'whiten', title: () => 'Remove patch whitening', hypothesis: 'Patch whitening is a large part of airbench’s speed.', predicted: 'hurts',
    changes: (k) => (k.whiten ? { whiten: false } : null), prov: [P.whiten], note: 'First conv becomes trainable.' },
  { key: 'dirac', title: () => 'Remove identity init', hypothesis: 'Identity initialisation helps the deeper convolutions.', predicted: 'hurts',
    changes: (k) => (k.dirac_init ? { dirac_init: false } : null), prov: [P.dirac], note: 'Default PyTorch init instead.' },
]

const uid = (() => { let n = 0; return (p: string) => `${p}_${++n}` })()
const sameChanges = (a: Partial<Knobs>, b: Partial<Knobs>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

export class MockServer {
  sid = uid('ses')
  state: AppState = initialState
  log: LitmusEvent[] = []
  listeners = new Set<(e: LitmusEvent) => void>()
  paused = false
  pending: (() => void)[] = []
  stopped = new Set<string>()
  nextStar = 0
  asked = false
  asking = false // between deciding to ask and the question arriving, no new wave may be proposed
  early: string[] | null = null // chosen before session.started
  opening: string | null = null // chosen before the baseline was graded
  writing = 0 // agents still writing their cards: Litmus waits for them before planning on its own
  goal: string
  replay: boolean

  constructor(goal: string, replay: boolean) {
    this.goal = goal
    this.replay = replay
    this.later(() => this.start(), 300)
  }

  private later(fn: () => void, ms: number) {
    setTimeout(() => (this.paused ? this.pending.push(fn) : fn()), ms)
  }
  private emit(type: string, payload: object) {
    const ev: LitmusEvent = { seq: this.log.length + 1, ts: new Date().toISOString(), session_id: this.sid, type, payload }
    this.log.push(ev)
    this.state = applyEvent(this.state, ev)
    this.listeners.forEach((l) => l(ev))
  }
  private get session() { return this.state.session! }
  private get stars() { return this.state.session?.stars ?? [] }
  private star(id: string) { return this.stars.find((s) => s.id === id)! }
  private think(text: string, star_id?: string) { this.emit('agent.thinking', { star_id, text }) }
  private spend(seconds: number) { this.emit('budget.updated', { used: Math.round(this.session.budget_used + seconds), total: BUDGET_GPU_SECONDS }) }

  subscribe(fromSeq: number, l: (e: LitmusEvent) => void) {
    this.log.filter((e) => e.seq > fromSeq).forEach(l)
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  // ---- session flow ----
  private start() {
    this.emit('session.started', { goal: this.goal, replay: this.replay })
    this.emit('budget.updated', { used: 0, total: BUDGET_GPU_SECONDS })
    this.later(() => {
      const base = this.newStar(null, 'Baseline', 'The reference configuration, about 94% accuracy.', {}, [], 'agent')
      this.run(base.id, SEEDS, () => {
        if (this.opening) { this.openClaim(this.opening); this.opening = null }
        else if (!this.session.start_claim_ids) this.emit('session.status', { status: 'waiting_human' })
      })
    }, 700)
    if (this.early) this.begin(this.early)
  }

  // "Where should we start?": one agent per chosen claim, each running the move tied to that highlight.
  // A claim chosen on the Connect page arrives before the session has started or its baseline is graded: it waits for both.
  begin(claim_ids: string[]) {
    if (!this.state.session) { this.early = claim_ids; return }
    if (this.session.start_claim_ids) return
    this.emit('start.chosen', { claim_ids })
    // one agent per claim: the first move whose leading provenance is that claim
    this.think('Starting where you chose: drafting its first test.')
    this.emit('session.status', { status: 'running' })
    if (this.stars[0]?.grade) this.openClaim(claim_ids[0])
    else this.opening = claim_ids[0]
  }

  // A claim no agent has tested yet becomes a new agent from the baseline.
  pivot(claim_id: string) {
    if (this.stars.some((s) => s.provenance.some((p) => p.id === claim_id))) throw new Error('That claim is already being tested')
    this.think('Pivoting to that claim, as you asked: drafting its test from the baseline.')
    this.openClaim(claim_id)
  }

  // The move whose leading provenance is the claim (any untried one if the demo has no move for it).
  private openClaim(claim_id: string) {
    const base = this.star('S0')
    const taken = this.stars.filter((s) => s.parent_id === 'S0').map((s) => s.knob_changes)
    const fresh = (m: Move) => { const c = m.changes(base.knobs); return c && !taken.some((t) => sameChanges(t, c)) }
    const m = MOVES.find((x) => x.prov[0].id === claim_id && fresh(x)) ?? MOVES.find(fresh)
    if (!m) { this.think('Every test the demo knows from the baseline has already run.'); return }
    this.later(() => {
      const st = this.newStar('S0', m.title(base.knobs), m.hypothesis, m.changes(base.knobs)!, m.prov, 'human', m.predicted)
      this.later(() => this.run(st.id, SEEDS), 500)
    }, 400)
  }

  private newStar(parent: string | null, title: string, hypothesis: string, changes: Partial<Knobs>, prov: Provenance[], by: Star['chosen_by'], predicted?: Predicted, extra: Partial<Star> = {}): Star {
    const p = parent ? this.star(parent) : undefined
    const star: Star = {
      id: `S${this.nextStar++}`, parent_id: parent, depth: p ? p.depth + 1 : 0, title, hypothesis,
      knobs: { ...(p?.knobs ?? BASELINE_KNOBS), ...changes }, knob_changes: changes, provenance: prov, chosen_by: by,
      status: 'queued', predicted, runs: [], parent_runs: [], created_at: new Date().toISOString(), ...extra,
    }
    this.emit(by === 'shadow' ? 'shadow.created' : 'star.created', { star })
    return star
  }

  private propose(starId: string, moves: Move[], because?: string): Proposal[] {
    const s = this.star(starId)
    const taken = this.stars.filter((c) => c.parent_id === starId).map((c) => c.knob_changes)
    const options = moves.flatMap((m) => { const changes = m.changes(s.knobs); return changes && !taken.some((t) => sameChanges(t, changes)) ? [{ m, changes }] : [] })
    if (!options.length) { this.think(`Nothing left to test from ${s.title} with the claims in your library.`, starId); return [] }
    // a mixup agent's first follow-up is a gentler strength of its own idea (training length is fixed for every test)
    if (s.parent_id) options.sort((a, b) => Number(b.m.key === 'gentle') - Number(a.m.key === 'gentle'))
    const proposals: Proposal[] = options.slice(0, MAX_PROPOSALS).map(({ m, changes }) => ({
      id: uid('prop'), star_id: starId, title: m.title(s.knobs), hypothesis: m.hypothesis, predicted: m.predicted, knob_changes: changes,
      condition_notes: m.note, provenance: because ? [...m.prov, { kind: 'human', id: uid('hum'), text: because }] : m.prov, agent_recommended: false, status: 'open',
    }))
    this.think(because ? `Planning from ${s.title}, as you asked.` : `${agentName(s)}: ${proposals.length} ways to go on.`, starId)
    this.emit('proposals.ready', { star_id: starId, proposals })
    if (!this.stars.some((x) => x.status === 'running' || x.status === 'queued')) this.emit('session.status', { status: 'waiting_human' })
    return proposals
  }

  // The agent's own card, written in its voice and aware of its siblings' verdicts.
  private suggest(id: string) {
    const s = this.star(id), g = s.grade!
    const first = this.propose(id, MOVES)[0]
    const sibling = this.stars.find((x) => x.id !== id && x.depth === s.depth && x.grade?.verdict === 'confirmed')
    const lead = g.verdict === 'confirmed' ? 'This held up here' : g.verdict === 'refuted' ? 'This went against the paper here' : 'This stayed inside the noise'
    const also = sibling ? `, and the ${agentName(sibling)} confirmed its claim` : ''
    const suggestion = first ? `${lead}${also}. Next I'd run “${first.title}”.` : `${lead}${also}. I have nothing left to test from here.`
    this.emit('star.updated', { star: { ...this.star(id), suggestion } })
  }

  dispatch(star_id: string, selections: Selection[], instruction?: string) {
    const open = this.session.proposals.filter((p) => p.star_id === star_id && p.status === 'open')
    if (!open.length) throw new Error('No open proposals for this star')
    const chosen = selections.map((s) => open.find((p) => p.id === s.proposal_id)).filter((p): p is Proposal => !!p)
    const decision: Decision = {
      id: uid('dec'), star_id, kind: 'dispatch', agent_recommendation: '',
      human_choice: chosen.map((p) => p.title).join(' + ') + (instruction ? ` (“${instruction}”)` : ''),
      agent_recommendation_ids: [], human_choice_ids: chosen.map((p) => p.id), changed_trajectory: false, note: '',
      created_at: new Date().toISOString(),
    }
    this.emit('human.dispatched', { star_id, selections, decision })
    this.emit('session.status', { status: 'running' })
    chosen.forEach((p, i) => this.later(() => {
      const st = this.newStar(star_id, p.title, p.hypothesis, p.knob_changes, p.provenance, 'human', p.predicted, { proposal_id: p.id })
      this.later(() => this.run(st.id, SEEDS), 500)
    }, i * 350))
  }

  answer(question_id: string, option_id: string, comment?: string) {
    const q = this.session.questions.find((x) => x.id === question_id)
    if (!q || q.status === 'answered') return
    const chosen = q.options.find((o) => o.id === option_id)!, lean = q.options.find((o) => o.id === q.agent_leaning)!
    const changed = option_id !== q.agent_leaning
    const decision: Decision = {
      id: uid('dec'), star_id: q.star_id, kind: 'answer', agent_recommendation: lean.label, human_choice: chosen.label + (comment ? ` (“${comment}”)` : ''),
      changed_trajectory: changed, note: changed ? `The ${agentName(this.star(q.star_id))} would have chosen “${lean.label}”.` : `You agreed with the ${agentName(this.star(q.star_id))}.`, created_at: new Date().toISOString(),
    }
    this.emit('question.answered', { question_id, option_id, decision })
    this.emit('session.status', { status: 'running' })
    if (option_id !== 'O1') { this.later(() => this.settle(), 600); return }
    const human: Provenance = { kind: 'human', id: decision.id, text: comment || chosen.label }
    this.later(() => {
      const st = this.newStar('S0', 'Mixup at Bag of Tricks α = 0.2', 'A gentler mixup keeps the regularisation without the short-run penalty.', { mixup_alpha: 0.2 }, [P.bot, P.botNote, human], 'human', 'improves')
      this.later(() => this.run(st.id, SEEDS), 500)
    }, 500)
  }

  feedback(star_id: string, kind: 'challenge' | 'suggest' | 'prioritize', text: string) {
    this.emit('feedback.received', { star_id, kind, text })
    this.later(() => {
      const s = this.star(star_id)
      if (kind === 'suggest') {
        this.emit('agent.replanned', { star_id, because: text, change: `New branches from ${s.title}` })
        this.propose(star_id, MOVES, text)
      } else {
        this.emit('agent.replanned', { star_id, because: text, change: `${s.title} moves to the front of the queue` })
      }
    }, 500)
  }

  // ---- experiments ----
  private comparisonKnobs(s: Star): Knobs | null {
    if (!s.parent_id) return null
    return this.star(s.parent_id).knobs // training length is fixed, so the parent re-runs exactly as it was
  }

  private run(id: string, seeds: number[], done?: () => void) {
    if (this.stopped.has(id)) return
    const s = this.star(id)
    const results = seeds.map((seed) => simulateRun(s.knobs, seed))
    const tick = TICK_MS
    this.emit('experiment.started', { star_id: id, seeds })
    let k = 0
    const step = () => {
      if (this.stopped.has(id)) return
      k++
      results.forEach((r) => this.emit('experiment.progress', { star_id: id, seed: r.seed, epoch: Math.round((s.knobs.epochs * k) / EPOCH_TICKS), val_acc: progressAccuracy(r.tta_val_acc!, k / EPOCH_TICKS) }))
      if (k < EPOCH_TICKS) { this.later(step, tick); return }
      results.forEach((run) => this.emit('experiment.run_done', { star_id: id, run }))
      this.later(() => this.finishRun(id, seeds, done), 400)
    }
    this.later(step, tick)
  }

  private finishRun(id: string, seeds: number[], done?: () => void) {
    if (this.stopped.has(id)) return
    const s = this.star(id)
    const compare = this.comparisonKnobs(s)
    const parentRuns = compare ? [...s.parent_runs, ...seeds.map((seed) => simulateRun(compare, seed))] : []
    const child = s.runs.map((r) => r.tta_val_acc!)
    const g = compare ? grade(parentRuns.map((r) => r.tta_val_acc!), child, s.predicted ?? 'improves') : baselineGrade(child)
    this.spend(seeds.length * s.knobs.epochs * (compare ? 2 : 1) * (4.2 / 9.9))
    this.emit('star.graded', { star_id: id, grade: g })
    this.emit('star.updated', { star: { ...this.star(id), parent_runs: parentRuns, reflection: this.reflect(s, g), finished_at: new Date().toISOString() } })
    if (done) { done(); return }
    this.afterGrade(id, g)
  }

  private reflect(s: Star, g: Grade): string {
    if (g.verdict === 'baseline') return `Baseline: ${(g.mean_child * 100).toFixed(2)}% over ${g.n} seeds.`
    const vs = s.parent_id ? this.star(s.parent_id).title : ''
    const d = `${pts(g.delta)} pts vs ${vs}`
    if (g.verdict === 'inconclusive') return `${d}, but the interval crosses zero at ${g.n} seeds.`
    if (g.verdict === 'confirmed') return `${d}: ${PREDICTION[s.predicted ?? 'improves']}, as the claim predicted. The interval clears zero.`
    return `${d}: the opposite of the prediction.${s.knob_changes.mixup_alpha ? ' The paper trained 200 epochs; this ran ' + s.knobs.epochs + '.' : ''}`
  }

  private afterGrade(id: string, g: Grade) {
    const s = this.star(id)
    if (g.verdict === 'inconclusive' && Math.abs(g.delta) >= 0.0005 && g.n < SEEDS.length * 2) {
      this.emit('agent.replanned', { star_id: id, because: 'The interval crosses zero but the effect could be real.', change: `5 more seeds on ${s.title}` })
      this.later(() => this.run(id, EXTRA_SEEDS), 500)
      return
    }
    if (g.verdict === 'refuted' && s.knob_changes.mixup_alpha && !this.asked) { this.askAboutMixup(s); return }
    // the agent writes its take and options with an LLM call on the real backend: the card shows "Generating next steps" meanwhile
    this.writing++
    this.later(() => { this.writing--; this.suggest(id); this.settle() }, SUGGEST_MS)
  }

  private askAboutMixup(s: Star) {
    this.asked = true
    this.asking = true
    this.think(`${s.title} went against the paper. Searching your library for why.`, s.id)
    this.later(() => {
      this.emit('library.search', { star_id: s.id, query: 'mixup short training epochs converge', hits: [P.bot, P.botNote, P.mix] })
      this.later(() => {
        const q: Question = {
          id: uid('q'), star_id: s.id, status: 'open',
          text: `Mixup lost ${pts(s.grade!.delta)} pts at ${s.knobs.epochs} epochs. Zhang et al. trained 200, and your Bag of Tricks note says mixup needs long training, but every test here trains the same ~10 epochs. Try the gentler α = 0.2, or drop it?`,
          evidence: [P.mix, P.mixNote, P.bot, P.botNote],
          options: [
            { id: 'O1', label: 'Mixup at Bag of Tricks α = 0.2', consequence: 'Same ~10 epochs as every other test: a fair comparison.', knob_changes: { mixup_alpha: 0.2 }, parent_star_id: 'S0' },
            { id: 'O2', label: 'Drop mixup', consequence: 'Cheap. Leaves the claim untested at its own conditions.' },
          ],
          agent_leaning: 'O2',
        }
        this.asking = false
        this.emit('question.asked', { question: q })
        this.emit('session.status', { status: 'waiting_human' })
      }, 1400)
    }, 1200)
  }

  // When every branch has settled and nothing waits on the human, Litmus plans from the best star.
  private settle() {
    const s = this.session
    if (this.asking || this.writing || s.stars.some((x) => x.status === 'running' || x.status === 'queued')) return
    if (s.proposals.some((p) => p.status === 'open') || s.questions.some((q) => q.status === 'open')) {
      if (s.status !== 'waiting_human') this.emit('session.status', { status: 'waiting_human' })
      return
    }
    if (s.stars.length >= MAX_STARS || s.budget_used >= s.budget_total) { this.emit('session.status', { status: 'done' }); return }
    const best = s.stars.filter((x) => x.chosen_by !== 'shadow' && x.grade).sort((a, b) => b.grade!.mean_child - a.grade!.mean_child)[0]
    this.think('No agent has an open option, so I’m planning from the best result so far.', best.id)
    this.propose(best.id, MOVES)
  }

  // The demo's chat: answers from the star's own record, routed by what the question asks about.
  chat(star_id: string | undefined, question: string) {
    if (!star_id) return this.overview()
    const s = this.star(star_id), g = s.grade, q = question.toLowerCase()
    const parent = s.parent_id ? this.star(s.parent_id) : null
    const seeds = s.runs.map((r) => r.seed)
    const claim = s.provenance.find((p) => p.kind === 'highlight'), note = s.provenance.find((p) => p.kind === 'note')
    const result = !g ? `${s.title} has not been graded yet.`
      : g.verdict === 'baseline' ? `The reference configuration averaged ${(g.mean_child * 100).toFixed(2)}% over ${g.n} seeds.`
      : `It moved accuracy from ${(g.mean_parent * 100).toFixed(2)}% to ${(g.mean_child * 100).toFixed(2)}% (${pts(g.delta)} pts, 95% CI ${pts(g.ci_low)} to ${pts(g.ci_high)}). ${g.ci_low <= 0 && g.ci_high >= 0 ? 'The interval includes zero, so seed noise could explain it.' : 'The interval excludes zero, so this is unlikely to be noise.'}`
    const answer = /run|ran|test|seed|config|setting|did/.test(q) && parent
      ? `I changed ${knobText(s.knob_changes)} on top of ${parent.title} and trained ${seeds.length} seeds (${seeds.join(', ')}). ${parent.title} was re-run on the same seeds, so each pair differs only by that change. ${result}`
      : /paper|claim|highlight|note|why/.test(q) && claim
        ? `It tests "${claim.text.slice(0, 140)}${claim.text.length > 140 ? '…' : ''}"${note ? `, and your note asked: ${note.text}` : ''}. ${result}`
        : result
    return { answer, provenance: s.provenance }
  }

  // The demo's answer about the research as a whole: what is graded, the best result, and what goes against the papers.
  private overview() {
    const graded = this.stars.filter((s) => s.parent_id && s.grade)
    if (!graded.length) return { answer: `Nothing is graded yet. ${this.stars.filter((s) => s.parent_id).map((s) => `${agentName(s)} is testing ${knobText(s.knob_changes)}`).join('; ') || 'No agent has started.'}.`, provenance: [] }
    const best = graded.reduce((a, b) => (b.grade!.delta > a.grade!.delta ? b : a))
    const refuted = graded.filter((s) => s.grade!.verdict === 'refuted')
    const answer = `${graded.length} of ${this.stars.length - 1} experiments are graded. The best is ${agentName(best)} at ${pts(best.grade!.delta)} pts (${best.grade!.verdict}).`
      + (refuted.length ? ` ${refuted.map((s) => agentName(s)).join(' and ')} went against the paper${refuted.length > 1 ? 's' : ''}.` : ' Nothing has gone against the papers yet.')
    return { answer, provenance: [] }
  }

  generateAbstract() {
    const graded = this.stars.filter((s) => s.grade && s.grade.verdict !== 'baseline' && s.chosen_by !== 'shadow')
    const base = this.stars[0]?.grade
    const cite = (s: Star) => `[${s.id}]${s.provenance.find((p) => p.kind === 'highlight') ? `[${s.provenance.find((p) => p.kind === 'highlight')!.id}]` : ''}`
    const line = (s: Star) => `${s.title}: ${pts(s.grade!.delta)} pts [${pts(s.grade!.ci_low)}, ${pts(s.grade!.ci_high)}], ${s.grade!.verdict} ${cite(s)}`
    const by = (v: Grade['verdict']) => graded.filter((s) => s.grade!.verdict === v)
    const best = graded.slice().sort((a, b) => b.grade!.mean_child - a.grade!.mean_child)[0]
    const steered = this.session.decisions.filter((d) => d.changed_trajectory).length
    const text = [
      `We tested ${graded.length} claims from your library on airbench94 (CIFAR-10, ${base ? `baseline ${(base.mean_child * 100).toFixed(2)}%` : 'baseline pending'}) with paired seeds and a locked t-interval grader [S0].`,
      by('confirmed').length ? `${by('confirmed').length} held: ${by('confirmed').map((s) => `${s.title.toLowerCase()} ${cite(s)}`).join('; ')}.` : '',
      by('refuted').length ? `${by('refuted').length} went against the paper under short training: ${by('refuted').map((s) => `${s.title.toLowerCase()} ${cite(s)}`).join('; ')}.` : '',
      by('inconclusive').length ? `${by('inconclusive').length} stayed inside the noise even with extra seeds ${by('inconclusive').map(cite).join('')}.` : '',
      best ? `The most accurate configuration was ${best.title.toLowerCase()} at ${(best.grade!.mean_child * 100).toFixed(2)}% ${cite(best)}.` : '',
      steered ? `You overruled the agents ${steered} time${steered === 1 ? '' : 's'}.` : '',
    ].filter(Boolean).join(' ')
    const citations = [...new Map(graded.flatMap((s) => s.provenance.filter((p) => p.kind === 'highlight')).map((p) => [p.id, p])).values()]
    this.emit('abstract.ready', { abstract: { text, findings: graded.map(line), citations } })
    this.emit('papiers.export_ready', { path: `exports/${this.sid}/findings.md`, instructions: 'Paste findings.md into a Papiers note; the next session’s library search will find it.' })
  }

  exportMarkdown() {
    const a = this.session.abstract
    return a ? `# Litmus findings — ${this.goal}\n\n${a.text}\n\n## Findings\n\n${a.findings.map((f) => `- ${f}`).join('\n')}\n` : ''
  }

  pause() { this.paused = true; this.emit('session.status', { status: 'paused' }) }
  resume() {
    this.paused = false
    this.emit('session.status', { status: this.session.questions.some((q) => q.status === 'open') ? 'waiting_human' : 'running' })
    this.pending.splice(0).forEach((f) => f())
  }
  stopBranch(star_id: string) {
    this.stopped.add(star_id)
    this.emit('star.failed', { star_id, error: 'Stopped by you' })
    this.settle()
  }
}
