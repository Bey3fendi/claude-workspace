// workspace-core: evidence collection (Phase 2). Observe-only: every hook forwards through
// next() and returns the engine's own result unchanged. Events come only from documented
// engine events (plan §4); nothing is inferred from what the model says.
// Validator rules: literal event names, function-literal hooks, `$` spelled at each call site.
import { createSink, flush } from '../lib/sink.mjs'
import { promptSummary, markerCounts, short } from '../lib/events.mjs'

const sink = createSink()
const st = { model: null, effort: null, skills: 0, requests: 0 }
const statusText = () =>
  `cw ${st.model ? st.model.replace(/^claude-/, '') : '?'}${st.effort ? `/${st.effort}` : ''} · skills ${st.skills} · req ${st.requests}`

export const register = (on) => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    try {
      sink.setup({
        home: await $.env.get('HOME'), xdg: await $.env.get('XDG_STATE_HOME'), override: await $.env.get('CW_EVENTS_DIR'),
        root: await $.session.root(), sid: await $.session.id(),
      })
      const model = await $.session.model().catch(() => null)
      const w = sink.record('session.start', { cwd: e.cwd, root: sink.state.root, surface: e.surface ?? null, interactive: !!e.isInteractive, model })
      await flush(sink, w, (p, b) => $.fs.write(p, b))
      $.ui.status(statusText())
    } catch { sink.fail() }
    return r
  })

  on('session.end', async ($, e, next) => {
    await flush(sink, sink.record('session.end', { reason: e.reason ?? null }), (p, b) => $.fs.write(p, b))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      st.requests++
      try { sink.setSid(await $.session.id()) } catch {}
    }
    const w = sink.record('turn.start', { turnId: r?.turnId ?? e.turnId ?? null, agentId: e.agentId ?? null, prompt: e.agentId === undefined ? promptSummary(e.text) : undefined })
    await flush(sink, w, (p, b) => $.fs.write(p, b))
    return r
  })

  on('turn.step', async function* ($, e, next) {
    const w = sink.record('turn.step', { turnId: e.turnId, index: e.index, model: e.model, effort: e.effort ?? null, agentId: e.agentId ?? null })
    await flush(sink, w, (p, b) => $.fs.write(p, b))
    if (e.agentId === undefined) { st.model = e.model; st.effort = e.effort ?? null; $.ui.status(statusText()) }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const u = r?.usage ?? e.usage
    const w = sink.record('turn.complete', {
      turnId: e.turnId, agentId: e.agentId ?? null, reason: e.reason ?? null,
      usage: u ? { model: u.model, in: u.input_tokens, out: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens } : null,
    })
    await flush(sink, w, (p, b) => $.fs.write(p, b))
    return r
  })

  on('skill.prompt', async ($, e, next) => {
    const r = await next(e)
    st.skills++
    const w = sink.record('skill.prompt', { skill: e.skill, pluginName: e.pluginName ?? null, source: e.source ?? null, agentId: e.agentId ?? null })
    await flush(sink, w, (p, b) => $.fs.write(p, b))
    $.ui.status(statusText())
    return r
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    const isSkill = e.tool === 'Skill'
    const w = sink.record('tool.call', {
      tool: e.tool,
      skill: isSkill ? (e.skill ?? null) : undefined,
      subagentType: e.subagent_type ?? undefined,
      agentId: e.agentId ?? null,
      denied: r?.deny !== undefined ? true : undefined,
      isError: r?.isError === true ? true : undefined,
      errorText: isSkill && (r?.isError || r?.deny !== undefined) ? short(r.deny ?? r.text ?? '', 200) : undefined,
    })
    await flush(sink, w, (p, b) => $.fs.write(p, b))
    return r
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const w = sink.record('agent.spawn', { subagentType: e.subagentType ?? null, model: r?.model ?? null, agentId: r?.agentId ?? null, denied: r?.deny !== undefined ? true : undefined })
    await flush(sink, w, (p, b) => $.fs.write(p, b))
    return r
  }).catch(($, e, next) => next(e))

  on('session.append', async ($, e, next) => {
    const r = await next(e)
    if (e.door === 'hook-context' && e.origin?.kind === 'hook') {
      const content = e.message?.content
      const len = typeof content === 'string' ? content.length : JSON.stringify(content ?? '').length
      const w = sink.record('injection', { hookEvent: e.origin.event ?? null, len, markers: markerCounts(content) })
      await flush(sink, w, (p, b) => $.fs.write(p, b))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('state.set', async ($, e, next) => {
    const r = await next(e)
    if (e.plugin === 'router' && e.key === 'view' && e.value) {
      const v = e.value
      const w = sink.record('router.view', {
        phase: v.phase ?? null, mode: v.mode ?? null, nativeModel: v.nativeModel ?? null, selectedModel: v.selectedModel ?? null,
        actualModel: v.actualModel ?? null, tier: v.tier ?? null, effort: v.effort ?? null, reason: v.reason ?? null, error: v.error ?? null,
      })
      await flush(sink, w, (p, b) => $.fs.write(p, b))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUse', async ($, e, next) => {
    const r = await next(e)
    if (e?.tool_name === 'Skill') await flush(sink, sink.record('skill.loaded', { skill: e.tool_input?.skill ?? null, agentId: e.agent_id ?? null }), (p, b) => $.fs.write(p, b))
    return r
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUseFailure', async ($, e, next) => {
    const r = await next(e)
    if (e?.tool_name === 'Skill') await flush(sink, sink.record('skill.failed', { skill: e.tool_input?.skill ?? null, error: short(e.error ?? '', 200) }), (p, b) => $.fs.write(p, b))
    return r
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStart', async ($, e, next) => {
    const r = await next(e)
    await flush(sink, sink.record('subagent.start', { agentType: e?.agent_type ?? null, agentId: e?.agent_id ?? null }), (p, b) => $.fs.write(p, b))
    return r
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const r = await next(e)
    await flush(sink, sink.record('subagent.stop', { agentType: e?.agent_type ?? null, agentId: e?.agent_id ?? null }), (p, b) => $.fs.write(p, b))
    return r
  }).catch(($, e, next) => next(e))

  on('classic.PreCompact', async ($, e, next) => {
    const r = await next(e)
    await flush(sink, sink.record('compact', { trigger: e?.trigger ?? null }), (p, b) => $.fs.write(p, b))
    return r
  }).catch(($, e, next) => next(e))
}
