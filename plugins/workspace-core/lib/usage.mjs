// Workspace Usage evidence: pure logic shared by the mod (live footer) and the CLI (replay).
// Honesty rules:
//   - "activated" means the skill's instructions were loaded (skill.prompt). It does NOT mean they
//     were followed.
//   - Anything the model claims without a matching engine event is labeled self-reported.
//   - Integrations are "active" only if their injected context was observed this session; being
//     installed or enabled is not evidence of anything.
//   - A claimed skill loaded in an earlier request of this conversation (still in context; reset by /clear
//     and compaction) is "loaded earlier", with that request's number, not "self-reported only".

/** System-prompt section (cached, steady). Keep it short: it is the only token cost of reporting. */
// Since 0.15.1 one line, and only when there is something to say (AgentBridge: a 3-bullet section closed 43 of
// 97 answers, next to the engine footer).
export const USAGE_INSTRUCTION = [
  'Only when this request invoked a skill via the Skill tool, or skipped one a workspace contract named, end with one line (main conversation only):',
  '"Workspace Usage — Applied: <full skill id> (why)" or "Workspace Usage — Skipped: <skill id> (why)".',
  'List only skills you invoked; installed ≠ applied. Otherwise no such line. The engine adds a verified line.',
].join('\n')

// The one-line form ("Workspace Usage — Applied: …") and the older heading-plus-bullets form.
const SECTION_RE = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*|\*\*)?Workspace Usage\b\**[ \t]*[—:–-]?[ \t]*([\s\S]*)$/i
const ID_RE = /\b([a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*)\b/g

/** Bare skill names the model may write without a plugin prefix. */
export const KNOWN_BARE = {
  'mem-search': 'claude-mem:mem-search',
  ...Object.fromEntries(['brainstorming', 'systematic-debugging', 'test-driven-development', 'writing-plans', 'executing-plans',
    'verification-before-completion', 'requesting-code-review', 'receiving-code-review', 'subagent-driven-development',
    'dispatching-parallel-agents', 'using-git-worktrees', 'finishing-a-development-branch', 'writing-skills', 'using-superpowers']
    .map((n) => [n, `superpowers:${n}`])),
}

const INTEGRATIONS = { caveman: 'Caveman', ponytail: 'Ponytail', mdMemory: 'md-memory', claudeMem: 'claude-mem (legacy)', superpowers: 'Superpowers', karpathy: 'Karpathy', claudeMd: 'Karpathy guidelines (loaded via CLAUDE.md)' }

/** Parse the model's own "Workspace Usage" section. Only the Applied line yields skill claims. */
export function parseUsageSection(answer) {
  const m = typeof answer === 'string' ? answer.match(SECTION_RE) : null
  if (!m) return { present: false, applied: [] }
  const applied = new Set()
  for (const line of m[1].split('\n')) {
    if (!/^\s*[-*]?\s*\**\s*Applied\b/i.test(line)) continue
    for (const x of line.matchAll(ID_RE)) applied.add(x[1])
    for (const [bare, id] of Object.entries(KNOWN_BARE)) if (new RegExp(`(^|[^:\\w-])${bare}(?![\\w-])`).test(line)) applied.add(id)
  }
  return { present: true, applied: [...applied] }
}

/** Per-request tracker; session-level integration activity survives requests. */
export function createTracker() {
  // loaded: skill → number of the request that loaded it (this conversation; reset by /clear and compaction)
  // shown: what the footer already said this session (the injected-context list, the /explain HEAD hint).
  const session = { active: new Set(), loaded: new Map(), n: 0, shown: { active: null, explainHint: false } }
  let req = null
  const fresh = () => ({ activated: new Set(), completed: new Set(), denied: new Set(), failed: new Set(), gate: null, pressure: null, explain: null, ponytail: null })
  return {
    // Keep what arrived since the last finish (a slash-command skill loads before its turn starts).
    turnStart() { req ??= fresh() },
    injection(markers) { for (const [k, n] of Object.entries(markers || {})) if (n > 0 && INTEGRATIONS[k]) session.active.add(k) },
    skillPrompt(skill) { if (!skill) return; (req ??= fresh()).activated.add(skill) },
    skillLoaded(skill) { if (!skill) return; (req ??= fresh()).completed.add(skill) },
    skillFailed(skill) { if (!skill) return; (req ??= fresh()).failed.add(skill) },
    /** Phase 6: the context-pressure note was attached to this request (context size in tokens). */
    pressure(tokens) { (req ??= fresh()).pressure = tokens },
    /** Explain in this request: { commit } (a commit was made), { unit, files } (record), { unit, passed, total, failedRules } (check). */
    explain(info) { req ??= fresh(); req.explain = { ...(req.explain ?? {}), ...info } },
    /** Ponytail driven by the workspace: { reminded: 'contract'|'edit', level } | { level, closing: bool } | { asked: true }. */
    ponytail(info) { req ??= fresh(); req.ponytail = { ...(req.ponytail ?? {}), ...info } },
    /** Phase 4 gate outcome for this request: action 'deny' | 'release'. */
    gate(action, reason) {
      req ??= fresh()
      const g = (req.gate ??= { held: 0, released: null })
      if (action === 'deny') g.held++
      else if (action === 'release') g.released = reason ?? 'released'
    },
    skillCall(skill, { denied, isError, errorText }) {
      if (!skill) return
      req ??= fresh()
      if (denied || (isError && /denied|permission/i.test(errorText || ''))) req.denied.add(skill)
      else if (isError && !req.activated.has(skill)) req.failed.add(skill)
    },
    /** Close the request: evidence + footer line (null when there is nothing to report). */
    finish(answer, claimedOverride) {
      const r = req ?? fresh()
      req = null
      session.n++
      const section = claimedOverride ? { present: true, applied: claimedOverride } : parseUsageSection(answer)
      const s = summarize(r, section, [...session.active], session.loaded, session.shown)
      for (const k of s.activated) session.loaded.set(k, session.n)
      if (s.footer && s.reportPresent && s.showActive) session.shown.active = s.active.join(',')
      if (s.footer && s.explainHint) session.shown.explainHint = true
      return s
    },
    /** /clear or compaction: skills loaded before it are no longer known to be in context. */
    contextReset() { session.loaded.clear() },
    get activeIntegrations() { return [...session.active] },
  }
}

/** `shown`: what this session's footer already said; omitted (pure use, golden fixtures) = nothing yet. */
export function summarize(r, section, active, earlier = new Map(), shown = { active: null, explainHint: false }) {
  const failed = [...r.failed].filter((s) => !r.denied.has(s)), denied = [...r.denied].filter((s) => !r.activated.has(s))
  const activated = [...r.activated].filter((s) => !failed.includes(s))
  const matches = (claim) => activated.includes(claim)
  const claimedEarlier = section.applied.filter((c) => !matches(c) && earlier.has(c)).map((c) => ({ skill: c, n: earlier.get(c) }))
  const claimedNotObserved = section.applied.filter((c) => !matches(c) && !earlier.has(c))
  const observedNotClaimed = section.present ? activated.filter((s) => !section.applied.includes(s)) : []
  // The injected-context list once per session (and when it changes); the /explain HEAD hint once per session.
  const showActive = active.length > 0 && shown.active !== active.join(',')
  const explainHint = !!r.explain?.commit && !shown.explainHint
  const evidence = { activated, denied, failed, gate: r.gate ?? null, pressure: r.pressure ?? null, explain: r.explain ?? null, ponytail: r.ponytail ?? null, active, showActive, explainHint, reportPresent: section.present, claimed: section.applied, claimedEarlier, claimedNotObserved, observedNotClaimed }
  return { ...evidence, footer: renderFooter(evidence) }
}

const short = (id) => id.replace(/^andrej-karpathy-skills:/, 'karpathy:')

export function renderFooter(e) {
  const hint = e.explainHint ?? true // pure calls without session state keep the hint
  if (!e.reportPresent && !e.activated.length && !e.denied.length && !e.failed.length && !e.gate?.held && !e.pressure && !e.explain?.unit && !(e.explain?.commit && hint) && e.ponytail?.closing === undefined) return null
  const parts = []
  parts.push(e.activated.length ? `activated ${e.activated.map(short).join(', ')}` : 'no skill loaded in this request')
  if (e.denied.length) parts.push(`denied ${e.denied.map(short).join(', ')}`)
  if (e.failed.length) parts.push(`failed ${e.failed.map(short).join(', ')}`)
  if (e.gate?.held) {
    const how = e.gate.released === 'root cause stated' ? ' until a root cause was stated'
      : e.gate.released === 'gate limit reached' ? ', then let it through (limit reached)' : ''
    parts.push(`root-cause gate held edits ${e.gate.held === 1 ? 'once' : `${e.gate.held} times`}${how}`)
  }
  if (e.ponytail?.closing !== undefined) parts.push(`ponytail ${e.ponytail.level}: ${e.ponytail.reminded ? 'rule repeated, ' : ''}closing line ${e.ponytail.closing ? 'present' : 'missing'}${e.ponytail.asked ? ' (asked for it)' : ''}`)
  if (e.pressure) parts.push(`context ~${Math.round(e.pressure / 1000)}K: /clear-or-/compact advice attached`)
  if (e.explain?.unit) {
    const x = e.explain
    parts.push(x.total === undefined ? `explain ${x.unit}: record captured, no file written`
      : `explain ${x.unit}: ${x.passed}/${x.total} checks${x.failedRules?.length ? ` (failed: ${x.failedRules.join(', ')})` : ''}`)
  }
  if (e.explain?.commit && hint) parts.push('commit made: /explain HEAD explains it')
  if (e.reportPresent) {
    if (e.active.length && (e.showActive ?? true)) parts.push(`context injected this session: ${e.active.map((k) => INTEGRATIONS[k]).join(', ')}`)
    if (e.claimedEarlier?.length) parts.push(`loaded earlier this session: ${e.claimedEarlier.map((x) => `${short(x.skill)} (#${x.n})`).join(', ')}`)
    if (e.claimedNotObserved.length) parts.push(`self-reported only (no engine event): ${e.claimedNotObserved.map(short).join(', ')}`)
    if (e.observedNotClaimed.length) parts.push(`activated but not reported: ${e.observedNotClaimed.map(short).join(', ')}`)
    if (!e.claimedNotObserved.length && !e.observedNotClaimed.length) parts.push('report matches engine events')
  }
  return `Verified by engine: ${parts.join(' · ')} (activation = instructions loaded, not proof they were followed)`
}

/** Replay recorded rows (JSONL) into per-request evidence. Used by the CLI and golden tests. */
export function replay(rows) {
  const t = createTracker()
  const out = []
  let open = false, n = 0, startedAt = null, pendingPressure = null
  for (const e of rows) {
    switch (e.ev) {
      case 'injection': t.injection(e.markers); break
      case 'claude-md': if (e.karpathy) t.injection({ claudeMd: 1 }); break
      case 'turn.start': if (e.agentId == null) { t.turnStart(); if (pendingPressure) { t.pressure(pendingPressure); pendingPressure = null } open = true; n++; startedAt = e.t } break
      case 'skill.prompt': t.skillPrompt(e.skill); break
      case 'context.reset': t.contextReset(); break
      case 'skill.loaded': t.skillLoaded(e.skill); break
      case 'skill.failed': t.skillFailed(e.skill); break
      case 'gate': if (!e.sameStep) t.gate(e.action, e.reason); break
      case 'ponytail':
        if (e.action === 'remind') t.ponytail({ reminded: e.via, level: e.level })
        else if (e.action === 'closing') t.ponytail({ level: e.level, closing: e.present })
        else if (e.action === 'close-asked') t.ponytail({ asked: true })
        break
      case 'pressure': pendingPressure = e.tokens; break
      case 'explain':
        if (e.action === 'record' && e.unit) t.explain({ unit: e.unit, files: e.files })
        else if (e.action === 'validate') t.explain({ unit: e.unit, passed: e.passed.length, total: e.passed.length + e.failed.length, failedRules: e.failed })
        break
      case 'tool.call': if (e.tool === 'Skill' && e.skill) t.skillCall(e.skill, e); break
      case 'turn.complete':
        if (e.agentId == null && open) {
          const s = t.finish(null, e.usageReport?.present ? e.usageReport.claimed : null)
          out.push({ n, t: startedAt, reason: e.reason ?? null, ...s })
          open = false
        }
        break
      default: break
    }
  }
  return out
}
