// Phase 0 spike observer: logs evidence-bearing engine events to JSONL. Read-only: every hook forwards via next().
const DIR = '/home/furkan/spikes/logs'
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const FILE = `${DIR}/events-${RUN}.jsonl`
const lines = []
let chain = Promise.resolve()

function log($, ev, data = {}) {
  lines.push(JSON.stringify({ t: Date.now(), run: RUN, ev, ...data }))
  chain = chain.then(() => $.fs.write(FILE, lines.join('\n') + '\n')).catch(() => {})
  return chain
}

const MARKERS = {
  superpowers: /You have superpowers/,
  caveman: /caveman/i,
  ponytail: /ponytail/i,
  claudeMem: /claude-mem|<claude-mem|memory context/i,
  karpathy: /karpathy/i,
}
function markers(text) {
  if (text == null) return null
  const shape = Array.isArray(text) ? `array(${text.length})` : typeof text
  if (typeof text !== 'string') text = JSON.stringify(text)
  const out = { shape, len: text.length }
  for (const [k, re] of Object.entries(MARKERS)) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    out[k] = (text.match(g) || []).length
  }
  return out
}
const keys = (o) => (o && typeof o === 'object' ? Object.keys(o) : typeof o)

export const register = (on) => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    let sid = null
    try { sid = await $.session.id() } catch {}
    await log($, 'session.start', { sid, keys: keys(e) })
    return r
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    await log($, 'turn.start', { turnId: e.turnId, agentId: e.agentId ?? null, textLen: (e.text || '').length })
    return r
  })

  on('turn.step', async function* ($, e, next) {
    await log($, 'turn.step', { turnId: e.turnId, index: e.index, model: e.model, effort: e.effort ?? null, agentId: e.agentId ?? null, messageCount: e.messageCount })
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await log($, 'turn.complete', { reason: e.reason ?? null, keys: keys(e) })
    return r
  })

  on('skill.prompt', async ($, e, next) => {
    const r = await next(e)
    await log($, 'skill.prompt', { skill: e.skill, pluginName: e.pluginName ?? null, source: e.source ?? null, textLen: (r?.text || '').length })
    return r
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    await log($, 'agent.spawn', { inKeys: keys(e), agentType: e.agentType ?? e.subagent_type ?? e.type ?? null, model: e.model ?? null, outKeys: keys(r), agentId: r?.agentId ?? null })
    return r
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    await log($, 'tool.call', { tool: e.tool, skill: e.tool === 'Skill' ? e.skill ?? null : undefined, deny: r?.deny ? String(r.deny).slice(0, 160) : undefined, isError: r?.isError ?? undefined })
    return r
  })

  on('session.append', async ($, e, next) => {
    const r = await next(e)
    if (e.door === 'hook-context' || e.door === 'attachment' || e.door === 'notice') {
      const m = markers(e.message?.content)
      await log($, 'session.append', { door: e.door, origin: JSON.stringify(e.origin).slice(0, 200), msgType: e.message?.type, ctx: m })
    }
    return r
  })

  on('state.set', async ($, e, next) => {
    const r = await next(e)
    const v = e.value
    const pick = e.plugin === 'router' && e.key === 'view' && v
      ? { phase: v.phase, mode: v.mode, nativeModel: v.nativeModel, selectedModel: v.selectedModel, actualModel: v.actualModel, tier: v.tier, effort: v.effort, reason: v.reason, error: v.error, credentials: JSON.stringify(v.credentials ?? null).slice(0, 200), health: JSON.stringify(v.health ?? null).slice(0, 200) }
      : undefined
    await log($, 'state.set', { plugin: e.plugin ?? null, key: e.key ?? null, valueKeys: pick ? undefined : keys(v), view: pick })
    return r
  })

  on('classic.SessionStart', async ($, e, next) => classic($, 'SessionStart', e, await next(e)))
  on('classic.UserPromptSubmit', async ($, e, next) => classic($, 'UserPromptSubmit', e, await next(e)))
  on('classic.UserPromptExpansion', async ($, e, next) => classic($, 'UserPromptExpansion', e, await next(e)))
  on('classic.PreToolUse', async ($, e, next) => classic($, 'PreToolUse', e, await next(e)))
  on('classic.PostToolUse', async ($, e, next) => classic($, 'PostToolUse', e, await next(e)))
  on('classic.PostToolUseFailure', async ($, e, next) => classic($, 'PostToolUseFailure', e, await next(e)))
  on('classic.SubagentStart', async ($, e, next) => classic($, 'SubagentStart', e, await next(e)))
  on('classic.SubagentStop', async ($, e, next) => classic($, 'SubagentStop', e, await next(e)))
  on('classic.Stop', async ($, e, next) => classic($, 'Stop', e, await next(e)))
  on('classic.SessionEnd', async ($, e, next) => classic($, 'SessionEnd', e, await next(e)))
  on('classic.PreCompact', async ($, e, next) => classic($, 'PreCompact', e, await next(e)))
  on('classic.Setup', async ($, e, next) => classic($, 'Setup', e, await next(e)))
}

async function classic($, name, e, r) {
  const ac = r?.additionalContext ?? r?.hookSpecificOutput?.additionalContext
  await log($, `classic.${name}`, {
    tool: e?.tool_name ?? e?.tool ?? undefined,
    skill: e?.tool_input?.skill ?? e?.skill ?? undefined,
    source: e?.source ?? undefined,
    agentType: e?.agent_type ?? undefined,
    resultKeys: keys(r),
    block: r?.block ?? undefined,
    ctx: markers(ac),
  })
  return r
}
