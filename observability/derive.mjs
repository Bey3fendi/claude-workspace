// Pure derivation: ordered events (+ optional transcript hook rows) -> evidence view.
// Every state names the evidence it rests on. Vocabulary:
//   capability: observed | activated | failed | not-observed | not-activated | not-applicable | unverified | disabled
//   skill:      activated | completed | denied | failed
// "observed" means a documented engine event showed it; "unverified" means only the
// undocumented transcript fallback did.

const CAPS = ['superpowers', 'caveman', 'claudeMem', 'ponytail', 'karpathy', 'router']
const PLUGIN_OF = { superpowers: 'superpowers', caveman: 'caveman', claudeMem: 'claude-mem', ponytail: 'ponytail', karpathy: 'andrej-karpathy-skills' }

const pluginOfSkill = (skill, pluginName) => pluginName ?? (String(skill).includes(':') ? String(skill).split(':')[0] : null)

export function deriveSession({ sid, projectKey = null, events, hooks = null }) {
  const S = {
    sid, projectKey, root: null, startedAt: null, lastAt: null, endedAt: null, endReason: null,
    interactive: null, surface: null, model: null,
    requests: [], injections: [], capabilities: {}, failures: [], totals: { requests: 0, steps: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0, skills: 0 },
    sources: { events: events.length, transcript: hooks == null ? 'unavailable' : `${hooks.length} hook rows (best-effort)` },
  }
  let req = null
  const agentType = new Map()

  for (const e of events) {
    S.startedAt ??= e.t
    S.lastAt = e.t
    switch (e.ev) {
      case 'session.start':
        S.root = e.root ?? e.cwd ?? S.root; S.interactive = e.interactive ?? null; S.surface = e.surface ?? null; S.model = e.model ?? null
        break
      case 'session.end':
        S.endedAt = e.t; S.endReason = e.reason ?? null
        break
      case 'injection':
        if ((e.len ?? 0) > 3) S.injections.push({ t: e.t, hookEvent: e.hookEvent, len: e.len, markers: e.markers ?? {}, request: req?.n ?? null })
        break
      case 'turn.start':
        if (e.agentId == null) {
          req = { n: S.requests.length + 1, turnId: e.turnId, t: e.t, prompt: e.prompt ?? null, steps: [], subagents: {}, skills: [], tools: { calls: 0, errors: 0, denied: 0, byTool: {} }, router: [], reason: null, usage: null, endedAt: null }
          S.requests.push(req)
        } else if (req) {
          sub(req, e.agentId).turns++
        }
        break
      case 'turn.step': {
        S.totals.steps++
        const step = { index: e.index, model: e.model, effort: e.effort ?? null }
        if (e.agentId == null) { if (req) req.steps.push(step) }
        else if (req) sub(req, e.agentId).steps.push(step)
        break
      }
      case 'turn.complete':
        if (e.agentId == null && req && req.turnId === e.turnId) {
          req.reason = e.reason; req.usage = e.usage ?? null; req.endedAt = e.t
          if (e.usage) for (const k of ['in', 'out', 'cacheRead', 'cacheWrite']) S.totals[k] += e.usage[k] ?? 0
        } else if (e.agentId != null && req) {
          const s = sub(req, e.agentId); s.reason = e.reason; s.usage = e.usage ?? null
        }
        break
      case 'agent.spawn':
        if (e.agentId) agentType.set(e.agentId, e.subagentType)
        if (req && e.agentId) { const s = sub(req, e.agentId); s.type = e.subagentType ?? s.type; s.model = e.model ?? s.model }
        break
      case 'subagent.start':
        if (req && e.agentId) sub(req, e.agentId).type ??= e.agentType
        break
      case 'skill.prompt': {
        S.totals.skills++
        const target = req ?? sessionReq(S)
        skillRec(target, e.skill, pluginOfSkill(e.skill, e.pluginName), e.agentId).state = 'activated'
        skillRec(target, e.skill).evidence.push('skill.prompt')
        break
      }
      case 'skill.loaded': {
        const r = skillRec(req ?? sessionReq(S), e.skill)
        if (r.state === 'activated') r.state = 'completed'
        r.evidence.push('PostToolUse')
        break
      }
      case 'skill.failed': {
        const r = skillRec(req ?? sessionReq(S), e.skill)
        r.state = 'failed'; r.detail = e.error ?? null; r.evidence.push('PostToolUseFailure')
        break
      }
      case 'tool.call': {
        const target = req ?? sessionReq(S)
        target.tools.calls++
        target.tools.byTool[e.tool] = (target.tools.byTool[e.tool] ?? 0) + 1
        if (e.isError) target.tools.errors++
        if (e.denied) target.tools.denied++
        if (e.tool === 'Skill' && e.skill && (e.isError || e.denied)) {
          const r = skillRec(target, e.skill, pluginOfSkill(e.skill), e.agentId)
          const denied = e.denied || /denied|permission/i.test(e.errorText ?? '')
          if (r.state == null || r.state === 'activated') r.state = denied ? 'denied' : 'failed'
          r.detail = e.errorText ?? null
          r.evidence.push(e.denied ? 'tool.call deny' : denied ? 'tool.call isError (permission denied)' : 'tool.call isError')
          if (denied) target.tools.denied += e.denied ? 0 : 1
        }
        break
      }
      case 'router.view': {
        const target = req ?? sessionReq(S)
        target.router.push({ t: e.t, phase: e.phase, mode: e.mode, selectedModel: e.selectedModel, actualModel: e.actualModel, nativeModel: e.nativeModel, tier: e.tier, effort: e.effort, reason: e.reason, error: e.error })
        break
      }
      default: break
    }
  }

  // per-request reconciliation: router decision vs model actually used (turn.step)
  for (const r of S.requests) {
    r.models = [...new Set(r.steps.map((s) => s.model))]
    r.efforts = [...new Set(r.steps.map((s) => s.effort).filter(Boolean))]
    r.subagents = Object.values(r.subagents)
    const decided = [...r.router].reverse().find((v) => v.selectedModel || v.actualModel || v.error)
    r.routing = decided ? {
      selected: decided.selectedModel ?? null, expected: decided.actualModel ?? decided.selectedModel ?? null, used: r.models[0] ?? null,
      error: decided.error ?? null, reason: decided.reason ?? null,
      verdict: decided.error ? 'fallback' : (decided.actualModel ?? decided.selectedModel) && r.models[0]
        ? (sameModel(decided.actualModel ?? decided.selectedModel, r.models[0]) ? 'match' : 'mismatch') : 'unknown',
    } : null
    S.totals.requests++
  }

  // capability evidence
  const inj = (k) => S.injections.filter((i) => (i.markers[k] ?? 0) > 0)
  const skillsOf = (plugin) => S.requests.concat(S._session ? [S._session] : []).flatMap((r) => r.skills).filter((s) => s.plugin === plugin)
  const hookRows = (k) => (hooks ?? []).filter((h) => h.capability === k)
  for (const k of CAPS) {
    if (k === 'router') {
      const views = S.requests.flatMap((r) => r.router).concat(S._session?.router ?? [])
      S.capabilities.router = views.length
        ? { state: views.some((v) => v.error) ? 'failed' : 'observed', evidence: [`${views.length} router.view`], detail: views.find((v) => v.error)?.error ?? null }
        : { state: 'disabled', evidence: ['no router.view events (optional, off by default)'] }
      continue
    }
    const ev = []
    const i = inj(k)
    if (i.length) ev.push(`injection ×${i.length} (${[...new Set(i.map((x) => x.hookEvent))].join(', ')}; content markers)`)
    const sk = skillsOf(PLUGIN_OF[k])
    const act = sk.filter((s) => s.state === 'activated' || s.state === 'completed')
    if (act.length) ev.push(`skills activated ×${act.length}`)
    const failedHooks = hookRows(k).filter((h) => h.failed)
    const okHooks = hookRows(k).filter((h) => !h.failed)
    let state
    if (failedHooks.length) {
      state = 'failed'
      for (const h of failedHooks) S.failures.push({ capability: k, source: 'transcript (best-effort)', hookEvent: h.hookEvent, command: h.command, detail: h.detail })
      ev.push(`hook failures ×${failedHooks.length} (transcript, best-effort)`)
    } else if (i.length) state = 'observed'
    else if (k === 'karpathy') state = act.length ? 'activated' : 'not-activated'
    else if (act.length) state = 'activated'
    else if (k === 'caveman' && S.interactive === false) { state = 'not-applicable'; ev.push('headless session: Caveman injects only in interactive sessions') }
    else if (okHooks.length) { state = 'unverified'; ev.push(`hook ran ×${okHooks.length} (transcript only, best-effort)`) }
    else state = 'not-observed'
    S.capabilities[k] = { state, evidence: ev }
  }

  for (const r of S.requests) for (const s of r.skills) if (s.state === 'failed') S.failures.push({ capability: s.plugin, source: 'event', request: r.n, skill: s.skill, detail: s.detail ?? null })
  for (const r of S.requests) if (r.reason && r.reason !== 'answer') S.failures.push({ capability: null, source: 'event', request: r.n, detail: `turn ended: ${r.reason}` })

  if (S._session) { S.preamble = S._session; delete S._session }
  return S
}

function sub(req, agentId) {
  return (req.subagents[agentId] ??= { agentId, type: null, model: null, turns: 0, steps: [], reason: null, usage: null })
}

function sessionReq(S) {
  return (S._session ??= { n: 0, skills: [], tools: { calls: 0, errors: 0, denied: 0, byTool: {} }, router: [] })
}

function skillRec(target, skill, plugin, agentId) {
  let r = target.skills.find((s) => s.skill === skill && s.state !== 'denied' && s.state !== 'failed')
  if (!r) { r = { skill, plugin: plugin ?? null, agentId: agentId ?? null, state: null, evidence: [] }; target.skills.push(r) }
  if (plugin && !r.plugin) r.plugin = plugin
  return r
}

const sameModel = (a, b) => String(a).replace(/\[.*\]$/, '') === String(b).replace(/\[.*\]$/, '')

/** Compact row for session lists. */
export function summarize(s) {
  return {
    sid: s.sid, projectKey: s.projectKey, root: s.root, startedAt: s.startedAt, lastAt: s.lastAt, endedAt: s.endedAt,
    interactive: s.interactive, model: s.model, requests: s.totals.requests, skills: s.totals.skills,
    tokens: { in: s.totals.in, out: s.totals.out, cacheRead: s.totals.cacheRead, cacheWrite: s.totals.cacheWrite },
    capabilities: Object.fromEntries(Object.entries(s.capabilities).map(([k, v]) => [k, v.state])),
    failures: s.failures.length,
  }
}
