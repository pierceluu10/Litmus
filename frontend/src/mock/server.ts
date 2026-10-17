import { applyEvent, initialState, type AppState } from '../reducer'
import type { Decision, Grade, Knobs, LitmusEvent, Predicted, Proposal, Provenance, RunResult, Selection, Star } from '../types'
import { claims, documents, P } from './library'

// Scripted stand-in for the backend. Numbers are illustrative (mock), shaped like real airbench results.
const BASE_KNOBS: Knobs = { label_smoothing: 0, epochs: 10, tta_level: 2, flip: 'random', mixup_alpha: 0, cutout: 0, lr_scale: 1, whiten: true, dirac_init: true, translate: 2 }
const SEED_OFFSETS = [-0.0008, 0.0005, 0.0011, -0.0003, -0.0005] // zero-sum, so the mean is exact
const BASELINE_MEAN = 0.9402
const SEEDS = [0, 1, 2, 3, 4]

type Effect = { delta: number; lo: number; hi: number; sd?: number }
const EFFECTS: Record<string, Effect> = {
  ls: { delta: 0.0021, lo: 0.0007, hi: 0.0035 },
  flip: { delta: 0.0012, lo: -0.0003, hi: 0.0027 },
  tta: { delta: -0.0031, lo: -0.0042, hi: -0.002 },
  mix: { delta: -0.0062, lo: -0.0081, hi: -0.0044 },
  mixlong: { delta: 0.0094, lo: 0.0071, hi: 0.0117 },
  stack: { delta: 0.0031, lo: 0.0014, hi: 0.0048 },
  final: { delta: 0.0009, lo: 0.0001, hi: 0.0017 },
  custom: { delta: 0.0006, lo: -0.0009, hi: 0.0021 },
}
const REFLECT: Record<string, string> = {
  ls: 'Label smoothing 0.1 gave a small but consistent gain: all five seeds moved up and the interval clears zero. It is close to the 0.2 pts Szegedy et al. saw on ImageNet, so your note holds on short CIFAR runs.',
  flip: 'Alternating flip moved accuracy by about a tenth of a point, but the interval crosses zero. This is the "real or noise?" question in your note: five seeds cannot separate it from noise. Adding seeds would tighten it.',
  tta: 'Turning test-time augmentation off cost about 0.3 pts, outside the noise. So a meaningful slice of the 94% is TTA, which answers your note about how much it contributes.',
  mix: 'Mixup at 10 epochs made things worse by about 0.6 pts on all seeds. Zhang et al. trained 200 epochs, so this contradicts the claim only under short training.',
  mixlong: 'Tripling the epochs lets mixup recover: +0.94 pts against the 10-epoch mixup run. Against the plain baseline it is still only about +0.3 pts at three times the cost.',
  stack: 'Stacking label smoothing and alternating flip adds roughly the sum of the parts. Cheap, and the interval stays clear of zero.',
  final: 'The combined configuration is the best star so far, by a small margin over its parent. The gain is real but small; the cost story matters more than the accuracy story.',
  custom: 'Your suggested change moved accuracy slightly, but the interval crosses zero. Treat it as unproven.',
}

const uid = (() => { let n = 0; return (p: string) => `${p}_${++n}` })()
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) }

export class MockServer {
  sid = uid('mock')
  state: AppState = initialState
  log: LitmusEvent[] = []
  listeners = new Set<(e: LitmusEvent) => void>()
  paused = false
  pending: (() => void)[] = []
  stopped = new Set<string>()
  nextStar = 1
  effects = new Map<string, string>() // star id -> effect key
  waveTwoDone = false
  finalStarted = false

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
  private get stars() { return this.state.session?.stars ?? [] }
  private star(id: string) { return this.stars.find((s) => s.id === id)! }
  private think(text: string, star_id?: string) { this.emit('agent.thinking', { star_id, text }) }

  subscribe(fromSeq: number, l: (e: LitmusEvent) => void) {
    this.log.filter((e) => e.seq > fromSeq).forEach(l)
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  // ---- script ----
  private start() {
    this.emit('session.started', { goal: this.goal, replay: this.replay })
    this.emit('budget.updated', { used: 0, total: 900 })
    this.emit('library.loaded', { documents, claims })
    this.think(`Reading your library: ${documents.length} papers, ${claims.length} highlighted claims, ranked by your notes.`)
    this.later(() => {
      this.think('Warming up the GPU and measuring the airbench baseline (first run includes compile time).')
      const base = this.makeStar('S0', null, 0, 'Baseline: airbench', 'Reference configuration, 5 seeds.', {}, [], 'auto')
      base.knobs = BASE_KNOBS
      this.emit('star.created', { star: base })
      this.effects.set('S0', 'base')
      this.runExperiment('S0', 1400, () => this.baselineDone())
    }, 900)
  }

  private makeStar(id: string, parent: string | null, depth: number, title: string, hypothesis: string, changes: Partial<Knobs>, prov: Provenance[], by: Star['chosen_by'], predicted?: Predicted, proposal_id?: string): Star {
    const parentStar = parent ? this.star(parent) : undefined
    return {
      id, parent_id: parent, depth, title, hypothesis, knobs: { ...(parentStar?.knobs ?? BASE_KNOBS), ...changes },
      knob_changes: changes, provenance: prov, chosen_by: by, status: 'queued', predicted, proposal_id,
      runs: [], parent_runs: parentStar?.runs ?? [], created_at: new Date().toISOString(),
    }
  }

  private baselineDone() {
    this.think('Baseline is 94.0%. Reading your notes to pick directions worth testing.', 'S0')
    this.later(() => {
      const mk = (key: string, title: string, hyp: string, pred: Predicted, changes: Partial<Knobs>, prov: Provenance[], note: string, rec: boolean): Proposal =>
        ({ id: `prop_${key}`, star_id: 'S0', title, hypothesis: hyp, predicted: pred, knob_changes: changes, condition_notes: note, provenance: prov, agent_recommended: rec, status: 'open' })
      const proposals = [
        mk('ls', 'Label smoothing 0.1', 'Label smoothing still helps on a 10-epoch CIFAR run.', 'improves', { label_smoothing: 0.1 }, [P.ls, P.lsNote, P.lsCal], 'Paper: ImageNet, ~0.2% gain. Here: CIFAR-10, ~10 epochs.', true),
        mk('flip', 'Alternating flip', 'Deterministic alternating flip beats random flip by a small, real margin.', 'improves', { flip: 'alternating' }, [P.flip, P.flipNote], 'Paper reports ~0.1 pts; needs seeds to tell from noise.', true),
        mk('tta', 'Turn test-time augmentation off', 'A meaningful share of the 94% comes from multi-crop TTA.', 'hurts', { tta_level: 0 }, [P.tta, P.ttaNote], 'Tests how much of the headline number is evaluation-time trickery.', false),
        mk('mix', 'Mixup alpha 0.2', 'Mixup improves accuracy even in a short training run.', 'improves', { mixup_alpha: 0.2 }, [P.mix, P.mixNote], 'Paper trained 200 epochs; we train ~10.', true),
      ]
      this.emit('proposals.ready', { star_id: 'S0', proposals })
      this.emit('session.status', { status: 'waiting_human' })
    }, 1400)
  }

  dispatch(star_id: string, selections: Selection[], instruction?: string) {
    const props = (this.state.session?.proposals ?? []).filter((p) => p.star_id === star_id && p.status === 'open')
    if (!props.length) throw new Error('No open proposals for this star')
    const chosen = selections.map((s) => props.find((p) => p.id === s.proposal_id)!).filter(Boolean)
    const rec = props.filter((p) => p.agent_recommended)
    const same = chosen.length === rec.length && chosen.every((c) => c.agent_recommended)
    const decision: Decision = {
      id: uid('dec'), star_id, kind: 'dispatch', agent_recommendation: rec.map((p) => p.title).join(' + '),
      human_choice: chosen.map((p) => p.title).join(' + ') + (instruction ? ` (“${instruction}”)` : ''),
      agent_recommendation_ids: rec.map((p) => p.id), human_choice_ids: chosen.map((p) => p.id),
      changed_trajectory: !same,
      note: same ? 'You agreed with the agent.' : `You ${chosen.filter((c) => !c.agent_recommended).map((c) => `added ${c.title}`).concat(rec.filter((r) => !chosen.includes(r)).map((r) => `skipped ${r.title}`)).join(' and ')}.`,
      created_at: new Date().toISOString(),
    }
    this.emit('human.dispatched', { star_id, selections, decision })
    this.emit('session.status', { status: 'running' })
    chosen.forEach((p, i) => this.later(() => {
      const key = p.id.replace('prop_', '')
      const id = `S${this.nextStar++}`
      const st = this.makeStar(id, star_id, 1, p.title, p.hypothesis, p.knob_changes, p.provenance, p.agent_recommended ? 'agent' : 'human', p.predicted, p.id)
      this.effects.set(id, key)
      this.emit('star.created', { star: st })
      this.later(() => this.runExperiment(id, key === 'mix' ? 1100 : 2300 + i * 350, key === 'mix' ? () => this.mixupDone(id) : undefined), 1100)
    }, i * 500))
    rec.filter((r) => !chosen.includes(r)).forEach((p, i) => this.later(() => this.makeShadow(p, star_id, decision.id, 1), 1500 + i * 500))
  }

  private makeShadow(p: { id: string; title: string; hypothesis: string; knob_changes: Partial<Knobs>; provenance: Provenance[]; predicted?: Predicted }, parent: string, decisionId: string, depth: number, key?: string) {
    const id = `S${this.nextStar++}`
    const st = { ...this.makeStar(id, parent, depth, `${p.title} (agent alone)`, p.hypothesis, p.knob_changes, p.provenance, 'shadow', p.predicted), shadow_of: decisionId }
    this.effects.set(id, key ?? p.id.replace('prop_', ''))
    this.emit('shadow.created', { star: st })
    this.later(() => this.runExperiment(id, 2600), 1200)
  }

  private mixupDone(id: string) {
    this.think('Mixup hurt by about 0.6 pts, which contradicts the paper. Searching your library for why.', id)
    this.later(() => {
      this.emit('library.search', { star_id: id, query: 'why mixup fails with short training / needs more epochs', hits: [P.bot, P.botNote, P.mix] })
      this.later(() => {
        const q = {
          id: 'q_mix', star_id: id, status: 'open',
          text: 'Mixup lost 0.6 pts at 10 epochs, but Zhang et al. trained 200 epochs and your note on Bag of Tricks says mixup needs long training. Do you want to spend GPU time testing mixup at 30 epochs, or drop it and stack the winners?',
          evidence: [P.mix, P.mixNote, P.bot, P.botNote],
          options: [
            { id: 'opt_long', label: 'Test mixup with longer training (30 epochs)', consequence: 'Costs about 3x the GPU time of a normal branch. Tells you whether mixup is salvageable or just a poor fit for short runs.' },
            { id: 'opt_drop', label: 'Drop mixup, stack the winners', consequence: 'Cheap. Combines label smoothing and alternating flip, but leaves the mixup claim untested at its original conditions.' },
          ],
          agent_leaning: 'opt_drop',
        }
        this.emit('question.asked', { question: q })
        this.emit('session.status', { status: 'waiting_human' })
      }, 1800)
    }, 1800)
  }

  answer(question_id: string, option_id: string, comment?: string) {
    const q = this.state.session?.questions.find((x) => x.id === question_id)
    if (!q || q.status === 'answered') return
    const chosen = q.options.find((o) => o.id === option_id)!
    const lean = q.options.find((o) => o.id === q.agent_leaning)!
    const changed = option_id !== q.agent_leaning
    const decision: Decision = {
      id: uid('dec'), star_id: q.star_id, kind: 'answer', agent_recommendation: lean.label, human_choice: chosen.label + (comment ? ` (“${comment}”)` : ''),
      changed_trajectory: changed, note: changed ? `The agent would have gone with “${lean.label}”. You overrode it using your note on Bag of Tricks.` : 'You agreed with the agent.',
      created_at: new Date().toISOString(),
    }
    this.emit('question.answered', { question_id, option_id, decision })
    this.emit('session.status', { status: 'running' })
    const long = option_id === 'opt_long'
    const id = `S${this.nextStar++}`
    const st = long
      ? this.makeStar(id, q.star_id, 2, 'Mixup + longer training', 'Mixup recovers when given 30 epochs, as Bag of Tricks suggests.', { epochs: 30 }, [P.bot, P.botNote, { kind: 'human', id: decision.id, text: comment || 'You asked to test mixup with longer training.' }], 'human', 'improves')
      : this.makeStar(id, 'S0', 1, 'Stack winners', 'Label smoothing and alternating flip add up.', { label_smoothing: 0.1, flip: 'alternating' }, [P.ls, P.flip, { kind: 'human', id: decision.id, text: comment || 'You chose to drop mixup and stack the winners.' }], 'human', 'improves')
    this.effects.set(id, long ? 'mixlong' : 'stack')
    this.later(() => {
      this.emit('star.created', { star: st })
      this.later(() => this.runExperiment(id, long ? 2000 : 1800, () => this.waveTwoCheck()), 1100)
    }, 600)
    if (changed) this.later(() => {
      this.makeShadow({ id: 'prop_stack', title: 'Stack winners', hypothesis: 'Label smoothing and alternating flip add up.', knob_changes: { label_smoothing: 0.1, flip: 'alternating' }, provenance: [P.ls, P.flip], predicted: 'improves' }, 'S0', decision.id, 1, 'stack')
    }, 1800)
    this.mainWave2 = id
  }
  private mainWave2 = ''

  private waveTwoCheck() {
    if (this.finalStarted) return
    const pendingShadow = this.stars.some((s) => s.chosen_by === 'shadow' && s.status !== 'done' && s.status !== 'failed')
    const others = this.stars.some((s) => s.depth === 1 && (s.status === 'running' || s.status === 'queued'))
    if (pendingShadow || others) { this.later(() => this.waveTwoCheck(), 1500); return }
    this.finalStarted = true
    const parent = this.mainWave2
    const long = this.effects.get(parent) === 'mixlong'
    this.think('Both lines are graded. Combining what worked into a final configuration.', parent)
    this.later(() => {
      const id = `S${this.nextStar++}`
      const changes: Partial<Knobs> = long ? { label_smoothing: 0.1, flip: 'alternating' } : { epochs: 12 }
      const st = this.makeStar(id, parent, 3, 'Final combined config', 'The confirmed changes combine into the strongest configuration.', changes, [P.ls, P.flip], 'agent', 'improves')
      this.effects.set(id, 'final')
      this.emit('star.created', { star: st })
      this.later(() => this.runExperiment(id, 1800, () => this.finish()), 1100)
    }, 1200)
  }

  private finish() {
    this.think('Writing up the findings with citations.')
    this.later(() => {
      const pts = (x?: Grade) => (x ? `${x.delta >= 0 ? '+' : ''}${(x.delta * 100).toFixed(2)} pts [${(x.ci_low * 100).toFixed(2)}, ${(x.ci_high * 100).toFixed(2)}]` : 'n/a')
      const byTitle = (t: string) => this.stars.find((s) => s.title.startsWith(t) && s.chosen_by !== 'shadow')
      const ls = byTitle('Label smoothing'), flip = byTitle('Alternating'), tta = byTitle('Turn test'), mix = byTitle('Mixup alpha'), fin = byTitle('Final')
      const text = `On a 10-epoch airbench run, label smoothing (${ls?.id}) moved accuracy ${pts(ls?.grade)}, a small gain consistent with Szegedy et al. [${ls?.id}] [hl_ls]. Alternating flip (${flip?.id}) was ${pts(flip?.grade)}, which cannot be separated from noise at five seeds [${flip?.id}]. Test-time augmentation accounts for roughly 0.3 pts of the baseline [${tta?.id}] [hl_tta]. Mixup hurt at 10 epochs (${pts(mix?.grade)}) [${mix?.id}] [hl_mix]; after you pointed to Bag of Tricks, longer training recovered it [hl_bot], but at three times the cost. The final configuration reached ${pts(fin?.grade)} over its parent [${fin?.id}].`
      this.emit('abstract.ready', { abstract: {
        text,
        findings: [
          `Label smoothing 0.1 helps by a small amount: ${pts(ls?.grade)} [${ls?.id}].`,
          `Alternating flip is inconclusive at 5 seeds: ${pts(flip?.grade)} [${flip?.id}].`,
          `Turning TTA off costs accuracy: ${pts(tta?.grade)} [${tta?.id}].`,
          `Mixup is refuted at 10 epochs (${pts(mix?.grade)}) and only recovers with longer training [hl_bot].`,
          `Your decision on the mixup branch changed the trajectory; the agent alone would have dropped it [hl_bot].`,
        ],
        citations: [P.ls, P.flip, P.tta, P.mix, P.bot, P.botNote],
      } })
      this.emit('session.status', { status: 'done' })
    }, 1500)
  }

  feedback(star_id: string, kind: 'challenge' | 'suggest' | 'prioritize', text: string) {
    this.emit('feedback.received', { star_id, kind, text })
    this.later(() => {
      this.think('Reading your feedback and re-planning.', star_id)
      this.later(() => {
        if (kind === 'challenge') {
          this.emit('agent.replanned', { star_id, because: text, change: 'Adding 5 more seeds to tighten the confidence interval' })
          const st = this.star(star_id)
          const key = this.effects.get(star_id) ?? 'custom'
          this.emit('star.updated', { star: { ...st, status: 'running', progress: [] } })
          this.runExperiment(star_id, 1500, undefined, true, key)
        } else if (kind === 'suggest') {
          this.emit('agent.replanned', { star_id, because: text, change: `Queued your suggestion as a new branch from ${star_id}` })
          const id = `S${this.nextStar++}`
          const parent = this.star(star_id)
          const st = this.makeStar(id, star_id, parent.depth + 1, `Your idea: ${text.slice(0, 40)}`, text, {}, [{ kind: 'human', id: uid('hum'), text }], 'human')
          this.effects.set(id, 'custom')
          this.emit('star.created', { star: st })
          this.later(() => this.runExperiment(id, 1800), 1100)
        } else {
          this.emit('agent.replanned', { star_id, because: text, change: `Moving ${star_id} to the front of the queue` })
        }
      }, 1200)
    }, 500)
  }

  explain(star_id: string) {
    const s = this.star(star_id)
    const g = s?.grade
    const answer = g
      ? `${s.title}: mean accuracy went from ${(g.mean_parent * 100).toFixed(2)}% to ${(g.mean_child * 100).toFixed(2)}% over ${g.n} paired seeds, a change of ${(g.delta * 100).toFixed(2)} pts with a 95% interval of [${(g.ci_low * 100).toFixed(2)}, ${(g.ci_high * 100).toFixed(2)}]. ${g.ci_low <= 0 && g.ci_high >= 0 ? 'The interval includes zero, so this could be noise.' : 'The interval excludes zero, so the effect is unlikely to be noise.'} ${s.reflection ?? ''}`
      : `${s?.title ?? star_id} has not been graded yet.`
    return { answer, provenance: s?.provenance ?? [] }
  }

  pause() { this.paused = true; this.emit('session.status', { status: 'paused' }) }
  resume() {
    this.paused = false
    const run = this.pending.splice(0)
    this.emit('session.status', { status: this.state.session?.questions.some((q) => q.status === 'open') ? 'waiting_human' : 'running' })
    run.forEach((f) => f())
  }
  stopBranch(star_id: string) { this.stopped.add(star_id); this.emit('star.failed', { star_id, error: 'Stopped by you' }) }
  exportMarkdown() {
    const a = this.state.session?.abstract
    return a ? `# Litmus findings\n\n${a.text}\n\n## Findings\n\n${a.findings.map((f) => `- ${f}`).join('\n')}\n` : ''
  }
  writeBack() {
    if (this.state.exportInfo) return
    this.emit('papiers.export_ready', { path: 'backend/exports/litmus-findings.md', instructions: 'The Papiers CLI is read-only. Import this Markdown file into your library manually.' })
  }

  // ---- experiments ----
  private runExperiment(id: string, tickMs: number, done?: () => void, extra = false, keyArg?: string) {
    if (this.stopped.has(id)) return
    const key = keyArg ?? this.effects.get(id) ?? 'custom'
    const seeds = extra ? SEEDS.map((s) => s + 5) : SEEDS
    const parentGrade = this.parentMean(id)
    const eff = key === 'base' ? { delta: 0, lo: 0, hi: 0 } : EFFECTS[key] ?? EFFECTS.custom
    const finalMean = key === 'base' ? BASELINE_MEAN : parentGrade + eff.delta
    this.emit('experiment.started', { star_id: id, seeds })
    const ticks = 5
    let k = 0
    const step = () => {
      if (this.stopped.has(id)) return
      k++
      const epochs = this.star(id).knobs.epochs
      seeds.forEach((seed, i) => {
        const frac = k / ticks
        const acc = finalMean + SEED_OFFSETS[i % 5] - 0.32 * Math.exp(-3.2 * frac)
        this.emit('experiment.progress', { star_id: id, seed, epoch: Math.round(epochs * frac), val_acc: +acc.toFixed(4) })
      })
      if (k < ticks) { this.later(step, tickMs); return }
      seeds.forEach((seed, i) => this.later(() => {
        const run: RunResult = { seed, val_acc: +(finalMean + SEED_OFFSETS[i % 5]).toFixed(4), time_seconds: +(3.1 + i * 0.07 + (key === 'mixlong' ? 6.2 : 0)).toFixed(2) }
        this.emit('experiment.run_done', { star_id: id, run })
      }, i * 120))
      this.later(() => this.grade(id, key, eff, parentGrade, done), 900)
    }
    this.later(step, tickMs)
  }

  private parentMean(id: string) {
    const st = this.star(id)
    if (!st.parent_id) return BASELINE_MEAN
    return this.star(st.parent_id).grade?.mean_child ?? BASELINE_MEAN
  }

  private grade(id: string, key: string, eff: Effect, mp: number, done?: () => void) {
    if (this.stopped.has(id)) return
    const st = this.star(id)
    const xs = st.runs.map((r) => r.val_acc)
    const n = xs.length
    const widen = n > 5 ? 0.72 : 1 // more seeds narrow the interval
    const lo = eff.delta - (eff.delta - eff.lo) * widen, hi = eff.delta + (eff.hi - eff.delta) * widen
    const verdict: Grade['verdict'] =
      key === 'base' ? 'baseline'
      : key === 'mix' ? 'refuted'
      : lo > 0 || hi < 0 ? 'confirmed' : 'inconclusive'
    const grade: Grade = {
      metric: 'val_acc', mean_parent: mp, mean_child: mean(xs), delta: key === 'base' ? 0 : mean(xs) - mp,
      sd_parent: 0.0008, sd_child: sd(xs), n, ci_low: key === 'base' ? mean(xs) - 0.0009 : lo, ci_high: key === 'base' ? mean(xs) + 0.0009 : hi,
      p_value: verdict === 'inconclusive' ? 0.11 : 0.008, verdict, practical: Math.abs(eff.delta) >= 0.002, grader_version: 'mock-1',
    }
    this.emit('star.graded', { star_id: id, grade })
    const used = (this.state.session?.budget_used ?? 0) + (key === 'mixlong' ? 190 : 95)
    this.emit('budget.updated', { used, total: 900 })
    const fmt = (x: number) => (x * 100).toFixed(2)
    const retest = n > 5 ? `You challenged this, so the agent added seeds (${n} total). The interval tightened to [${fmt(lo)}, ${fmt(hi)}] pts: ${lo > 0 || hi < 0 ? 'it now excludes zero, so the effect looks real but small.' : 'it still includes zero, so the effect stays unproven.'}` : undefined
    const reflection = retest ?? (key === 'base' ? 'Baseline established at 94.0% mean accuracy over 5 seeds.' : (REFLECT[key] ?? REFLECT.custom))
    this.emit('star.updated', { star: { ...this.star(id), reflection, finished_at: new Date().toISOString() } })
    done?.()
  }
}
