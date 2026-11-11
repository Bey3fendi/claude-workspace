// Workspace Usage evidence: pure logic shared by the mod (live footer) and the CLI (replay).
// Honesty rules:
//   - "activated" means the skill's instructions were loaded (skill.prompt). It does NOT mean they
//     were followed.
//   - Anything the model claims without a matching engine event is labeled self-reported.
//   - Integrations are "active" only if their injected context was observed this session; being
//     installed or enabled is not evidence of anything.

/** System-prompt section (cached, steady). Keep it short: it is the only token cost of reporting. */
export const USAGE_INSTRUCTION = [
  'After substantive dev work (code, debugging, design, review, tests), end with "Workspace Usage" (main conversation only, ≤3 bullets):',
  '- Applied: skills invoked via the Skill tool, full id + why',
  '- Active: integrations that actually shaped this task',
  '- Not used: relevant skills skipped (optional)',
  'List only skills you invoked; installed ≠ applied. Skip for trivial questions. The engine adds a verified line.',
].join('\n')

const SECTION_RE = /(?:^|\n)\s*(?:#{1,6}\s*|\*\*)?Workspace Usage\b[^\n]*\n([\s\S]*)$/i
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
  const session = { active: new Set() }
  let req = null
  const fresh = () => ({ activated: new Set(), completed: new Set(), denied: new Set(), failed: new Set(), gate: null, pressure: null })
  return {
    turnStart() { req = fresh() },
    injection(markers) { for (const [k, n] of Object.entries(markers || {})) if (n > 0 && INTEGRATIONS[k]) session.active.add(k) },
    skillPrompt(skill) { if (!skill) return; (req ??= fresh()).activated.add(skill) },
    skillLoaded(skill) { if (!skill) return; (req ??= fresh()).completed.add(skill) },
    skillFailed(skill) { if (!skill) return; (req ??= fresh()).failed.add(skill) },
    /** Phase 6: the context-pressure note was attached to this request (context size in tokens). */
    pressure(tokens) { (req ??= fresh()).pressure = tokens },
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
      const section = claimedOverride ? { present: true, applied: claimedOverride } : parseUsageSection(answer)
      return summarize(r, section, [...session.active])
    },
    get activeIntegrations() { return [...session.active] },
  }
}

export function summarize(r, section, active) {
  const failed = [...r.failed].filter((s) => !r.denied.has(s)), denied = [...r.denied].filter((s) => !r.activated.has(s))
  const activated = [...r.activated].filter((s) => !failed.includes(s))
  const matches = (claim) => activated.includes(claim)
  const claimedNotObserved = section.applied.filter((c) => !matches(c))
  const observedNotClaimed = section.present ? activated.filter((s) => !section.applied.includes(s)) : []
  const evidence = { activated, denied, failed, gate: r.gate ?? null, pressure: r.pressure ?? null, active, reportPresent: section.present, claimed: section.applied, claimedNotObserved, observedNotClaimed }
  return { ...evidence, footer: renderFooter(evidence) }
}

const short = (id) => id.replace(/^andrej-karpathy-skills:/, 'karpathy:')

export function renderFooter(e) {
  if (!e.reportPresent && !e.activated.length && !e.denied.length && !e.failed.length && !e.gate?.held && !e.pressure) return null
  const parts = []
  parts.push(e.activated.length ? `activated ${e.activated.map(short).join(', ')}` : 'no skill activations observed')
  if (e.denied.length) parts.push(`denied ${e.denied.map(short).join(', ')}`)
  if (e.failed.length) parts.push(`failed ${e.failed.map(short).join(', ')}`)
  if (e.gate?.held) {
    const how = e.gate.released === 'root cause stated' ? ' until a root cause was stated'
      : e.gate.released === 'gate limit reached' ? ', then let it through (limit reached)' : ''
    parts.push(`root-cause gate held ${e.gate.held} edit${e.gate.held > 1 ? 's' : ''}${how}`)
  }
  if (e.pressure) parts.push(`context ~${Math.round(e.pressure / 1000)}K: /clear-or-/compact advice attached`)
  if (e.reportPresent) {
    if (e.active.length) parts.push(`context injected this session: ${e.active.map((k) => INTEGRATIONS[k]).join(', ')}`)
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
      case 'skill.loaded': t.skillLoaded(e.skill); break
      case 'skill.failed': t.skillFailed(e.skill); break
      case 'gate': t.gate(e.action, e.reason); break
      case 'pressure': pendingPressure = e.tokens; break
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
