// workspace-core (Phase 2R): minimal usage evidence + Workspace Usage report.
//   - Records only the signals in plan §4.1 (skill loads/outcomes, injected-context markers,
//     request boundaries, model/effort per request, router view) to local JSONL.
//   - Adds one short system-prompt section asking for a "Workspace Usage" section on substantive tasks.
//   - Shows an engine-verified footer beneath the main-loop answer (turn.complete {text}); it is
//     never sent to the model. It compares the model's claims with observed skill events.
// Validator rules: literal event names, function-literal hooks, `$` spelled at each call site.
import { createSink, flush } from '../lib/sink.mjs'
import { markerCounts, short } from '../lib/events.mjs'
import { USAGE_INSTRUCTION, createTracker, parseUsageSection } from '../lib/usage.mjs'
import { classify, contractText, restoreText } from '../lib/contracts.mjs'
import { deniedSkills, trimListing } from '../lib/listing.mjs'
import { decide, denyText, statesRootCause } from '../lib/gates.mjs'
import { contextTokens, decidePressure, hasExternalPressureHook, thresholdFrom } from '../lib/pressure.mjs'
import { executionNote } from '../lib/execution.mjs'
import { OWNED, KARPATHY_HEADING, importsWorkspace } from '../lib/claude-md.mjs'
import { FILES, appendBlock, injectText, matchSections, maxLinesFrom, parseSections, relPath, sessionStartText, snapshotBlock, stampOf, trimSession } from '../lib/md-memory.mjs'

const sink = createSink()
const tracker = createTracker()
const st = { model: null, effort: null, skills: 0, requests: 0 }
// Phase 4: per-request state for the root-cause gate. Reset on each human prompt; text is the
// model's visible main-loop text in this request (kept in memory only, never written to disk).
// Context pressure: the main loop's latest request size (tokens), and a note pending for the footer.
let ctx = { tokens: 0, pending: null }
// md-memory: context/decisions section ids already injected in this session (reset at every SessionStart).
let mem = { injected: new Set() }
const MEMORY_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const readText = async ($, p) => { try { return await $.fs.read(p) } catch { return '' } }
let req = { class: null, text: '', denies: 0, released: false, gates: true, contracts: true, skills: [] }
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

  // One cached, session-scoped section (after the shared prefix, so the shared cache is untouched).
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { ...r, sections: [...r.sections, { id: 'workspace-core:usage-report', text: USAGE_INSTRUCTION, scope: 'session' }] }
  }).catch(($, e, next) => next(e))

  // Phase 3 (advise): classify the user's prompt locally and attach a short workflow contract as
  // model-only context. Only the class is recorded, never the prompt text.
  on('prompt.submit', async ($, e, next) => {
    const human = !e.command && !e.isMeta && ['composer', 'bridge', 'sdk'].includes(e.origin?.kind)
    if (!human) return next(e)
    const contracts = (await $.env.get('CW_CONTRACTS')) !== '0'
    const gates = (await $.env.get('CW_GATES')) !== '0'
    const c = classify(e.text)
    req = { class: c.class, text: '', denies: 0, released: false, gates, contracts, skills: [] }
    const add = []
    if (contracts) {
      const text = c.class ? contractText(c.class) : null
      await flush(sink, sink.record('classify', { class: c.class, reason: c.reason, contract: !!text }), (p, b) => $.fs.write(p, b))
      if (text) add.push(text)
    }
    // Phase 6 context pressure (built in; CW_CONTEXT_PRESSURE=0 disables; skipped when a user-level
    // context-pressure hook already adds the same note).
    // Context size: the engine's live window fill (the status line's figure; survives --resume, is absent
    // after /clear or compaction until the next response). Falls back to the last step seen in-process.
    let tokens = ctx.tokens
    try {
      const u = await $.session.usage()
      if (u?.context) tokens = typeof u.context.tokens === 'number' ? u.context.tokens : 0
    } catch { tokens = ctx.tokens }
    let hooksCfg = null
    if (tokens > 0) { try { hooksCfg = await $.settings.read({ key: 'hooks' }) } catch { hooksCfg = null } }
    const p = decidePressure({
      tokens,
      threshold: thresholdFrom(await $.env.get('CW_CONTEXT_PRESSURE_TOKENS'), await $.env.get('CONTEXT_PRESSURE_TOKENS')),
      disabled: (await $.env.get('CW_CONTEXT_PRESSURE')) === '0',
      external: hasExternalPressureHook(hooksCfg),
    })
    if (p) {
      add.push(p.note)
      ctx.pending = p.tokens
      await flush(sink, sink.record('pressure', { tokens: p.tokens }), (q, b) => $.fs.write(q, b))
    }
    return add.length ? next({ ...e, context: [...(e.context ?? []), ...add] }) : next(e)
  }).catch(($, e, next) => next(e))

  // Phase 3 listing work: drop denied (uninvocable) skills from the model-facing skill listing.
  // The transcript keeps the engine's full record; only what the model reads changes.
  on('prompt.attachment', { type: 'skill_listing' }, async ($, e, next) => {
    const r = await next(e)
    if (typeof r?.text !== 'string' || (await $.env.get('CW_LISTING_TRIM')) === '0') return r
    const t = trimListing(r.text, deniedSkills(await $.settings.read({ key: 'permissions' })))
    await flush(sink, sink.record('listing', { before: t.before, after: t.after, removed: t.removed.length, agentId: e.agentId ?? null }), (p, b) => $.fs.write(p, b))
    return t.removed.length ? { ...r, text: t.text } : r
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      st.requests++
      tracker.turnStart()
      if (ctx.pending) { tracker.pressure(ctx.pending); ctx.pending = null }
      try { sink.setSid(await $.session.id()) } catch {}
    }
    const w = sink.record('turn.start', { turnId: r?.turnId ?? e.turnId ?? null, agentId: e.agentId ?? null })
    await flush(sink, w, (p, b) => $.fs.write(p, b))
    return r
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const w = sink.record('turn.step', { turnId: e.turnId, index: e.index, model: e.model, effort: e.effort ?? null })
      await flush(sink, w, (p, b) => $.fs.write(p, b))
      st.model = e.model; st.effort = e.effort ?? null; $.ui.status(statusText())
      // Collect visible text as it streams (debug: a tool call later in the same response sees it), and the
      // request's usage from its stop chunk (context pressure).
      const debug = req.class === 'debug'
      for await (const c of next(e)) {
        if (debug && c?.kind === 'text') req.text += c.text
        else if (c?.kind === 'stop' && c.usage) { const t = contextTokens(c.usage); if (t > 0) ctx.tokens = t }
        yield c
      }
      return // the last next(e)'s result stands
    }
    return yield* next(e)
  })

  // Phase 4 root-cause gate: hold the first source edit of a debug request until a root cause is stated.
  on('tool.call', async ($, e, next) => {
    if (!req.gates || req.class !== 'debug') return next(e)
    const d = decide(req, e)
    if (d.action === 'deny') {
      req.denies++
      tracker.gate('deny')
      await flush(sink, sink.record('gate', { gate: 'root-cause', action: 'deny', tool: e.tool, n: req.denies }), (p, b) => $.fs.write(p, b))
      return { deny: denyText(d.file) }
    }
    if (d.reason && !req.released && e.agentId === undefined) {
      req.released = true // decided once per request; later edits are not re-checked
      tracker.gate('release', d.reason)
      await flush(sink, sink.record('gate', { gate: 'root-cause', action: 'release', reason: d.reason, afterDenies: req.denies }), (p, b) => $.fs.write(p, b))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const u = r?.usage ?? e.usage
    const main = e.agentId === undefined
    const report = main ? parseUsageSection(e.answer) : null
    const ev = main ? tracker.finish(e.answer) : null
    const w = sink.record('turn.complete', {
      turnId: e.turnId, agentId: e.agentId ?? null, reason: e.reason ?? null,
      usage: u ? { model: u.model, in: u.input_tokens, out: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens } : null,
      usageReport: report ? { present: report.present, claimed: report.applied } : undefined,
      footer: ev?.footer ?? undefined,
    })
    await flush(sink, w, (p, b) => $.fs.write(p, b))
    if (main && ev?.footer && e.reason === 'answer') return { ...r, text: ev.footer }
    return r
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    const r = await next(e)
    st.skills++
    tracker.skillPrompt(e.skill)
    if (e.agentId === undefined && e.skill && !req.skills.includes(e.skill)) req.skills.push(e.skill)
    const w = sink.record('skill.prompt', { skill: e.skill, pluginName: e.pluginName ?? null, source: e.source ?? null, agentId: e.agentId ?? null })
    await flush(sink, w, (p, b) => $.fs.write(p, b))
    $.ui.status(statusText())
    return r
  })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const r = await next(e)
    const outcome = {
      denied: r?.deny !== undefined ? true : undefined,
      isError: r?.isError === true ? true : undefined,
      errorText: r?.isError || r?.deny !== undefined ? short(r.deny ?? r.text ?? '', 200) : undefined,
    }
    tracker.skillCall(e.skill ?? null, outcome)
    const w = sink.record('tool.call', { tool: 'Skill', skill: e.skill ?? null, agentId: e.agentId ?? null, ...outcome })
    await flush(sink, w, (p, b) => $.fs.write(p, b))
    return r
  }).catch(($, e, next) => next(e))

  on('session.append', async ($, e, next) => {
    const r = await next(e)
    if (e.door === 'hook-context' && e.origin?.kind === 'hook') {
      const content = e.message?.content
      const len = typeof content === 'string' ? content.length : JSON.stringify(content ?? '').length
      const markers = markerCounts(content)
      tracker.injection(markers)
      const w = sink.record('injection', { hookEvent: e.origin.event ?? null, len, markers })
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

  // Phase 4 compaction restore: the contract rode on the request's prompt, which a compaction summary can
  // drop. After a compaction of the main conversation, re-attach it (with what is already done) as SessionStart
  // context, the engine's own channel for post-compaction context. Gate state is in memory and survives as is.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (!e.agent_id && ['clear', 'compact', 'startup'].includes(e?.source)) { ctx.tokens = 0; ctx.pending = null }
    const add = []
    // Plan execution method (lib/execution.mjs): stated on every main-conversation SessionStart, so it survives /clear and compaction.
    const exec = executionNote({ disabled: (await $.env.get('CW_PLAN_EXECUTION')) === '0', agent: !!e.agent_id })
    if (exec) add.push(exec)
    // CLAUDE.md integration: is the workspace file imported here (CLAUDE.md or CLAUDE.local.md)? Then it already
    // carries the md-memory rules and the Karpathy guidelines; record that (the guidelines have no skill event).
    const root = !e.agent_id ? await $.session.root().catch(() => null) : null
    let viaClaudeMd = false
    if (root) {
      viaClaudeMd = importsWorkspace(await readText($, `${root}/CLAUDE.md`)) || importsWorkspace(await readText($, `${root}/CLAUDE.local.md`))
      const karpathy = viaClaudeMd && (await readText($, `${root}/${OWNED}`)).includes(KARPATHY_HEADING)
      if (karpathy) tracker.injection({ claudeMd: 1 })
      if (e?.source === 'startup' || e?.source === 'resume') await flush(sink, sink.record('claude-md', { imported: viaClaudeMd, karpathy }), (p, b) => $.fs.write(p, b))
    }
    // md-memory: the rules (unless CLAUDE.md has them) plus session.md, on every main-conversation start (so /clear and /compact reload it).
    if (!e.agent_id && (await $.env.get('CW_MEMORY')) !== '0') {
      mem.injected = new Set()
      const text = root ? sessionStartText(await readText($, `${root}/${FILES.session}`), { rules: !viaClaudeMd }) : null
      if (text) {
        add.push(text)
        await flush(sink, sink.record('memory', { action: 'session-start', source: e?.source ?? null, len: text.length }), (p, b) => $.fs.write(p, b))
      }
    }
    if (e?.source === 'compact' && !e.agent_id && req.contracts && req.class) {
      const text = restoreText(req.class, { invoked: req.skills, rootCauseStated: req.class === 'debug' && statesRootCause(req.text) })
      if (text) {
        add.push(text)
        await flush(sink, sink.record('compact.restore', { class: req.class, len: text.length, invoked: req.skills.length }), (p, b) => $.fs.write(p, b))
      }
    }
    if (!add.length) return r
    return { ...r, additionalContext: [...(r?.additionalContext ?? []), ...add] }
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUse', async ($, e, next) => {
    const r = await next(e)
    if (e?.tool_name === 'Skill') {
      tracker.skillLoaded(e.tool_input?.skill ?? null)
      await flush(sink, sink.record('skill.loaded', { skill: e.tool_input?.skill ?? null, agentId: e.agent_id ?? null }), (p, b) => $.fs.write(p, b))
    }
    // md-memory: inject the context.md / decisions.md sections whose paths match the touched file, once per session.
    if (MEMORY_TOOLS.has(e?.tool_name) && (await $.env.get('CW_MEMORY')) !== '0') {
      const root = await $.session.root().catch(() => null)
      const rel = relPath(root, e.tool_input?.file_path ?? e.tool_input?.notebook_path)
      if (rel) {
        const all = [
          ...parseSections(await readText($, `${root}/${FILES.context}`), 'context.md'),
          ...parseSections(await readText($, `${root}/${FILES.decisions}`), 'decisions.md'),
        ]
        const hits = matchSections(all, rel, mem.injected)
        if (hits.length) {
          for (const h of hits) mem.injected.add(h.id)
          await flush(sink, sink.record('memory', { action: 'inject', sections: hits.length, agentId: e.agent_id ?? null }), (p, b) => $.fs.write(p, b))
          return { ...r, additionalContext: [...(r?.additionalContext ?? []), injectText(rel, hits)] }
        }
      }
    }
    return r
  }).catch(($, e, next) => next(e))

  // md-memory: an automatic compaction never leaves session.md stale (mechanical snapshot, then trim).
  on('classic.PreCompact', async ($, e, next) => {
    const r = await next(e)
    if (e?.trigger !== 'auto' || (await $.env.get('CW_MEMORY')) === '0') return r
    const root = await $.session.root().catch(() => null)
    if (!root) return r
    const git = async (argv) => { try { const x = await $.process.run(['git', ...argv], { cwd: root }); return x.exitCode === 0 ? x.stdout.trim() : '' } catch { return '' } }
    const block = snapshotBlock({ stamp: stampOf(), trigger: e.trigger, lastCommit: await git(['log', '-1', '--format=%h %s']), porcelain: await git(['status', '--porcelain']) })
    const max = maxLinesFrom((await $.env.get('CW_MEMORY_MAX_LINES')) ?? (await $.env.get('MD_MEMORY_MAX_LINES')))
    await $.fs.write(`${root}/${FILES.session}`, trimSession(appendBlock(await readText($, `${root}/${FILES.session}`), block), max))
    await flush(sink, sink.record('memory', { action: 'snapshot' }), (p, b) => $.fs.write(p, b))
    return r
  }).catch(($, e, next) => next(e))

  // md-memory: keep session.md within its cap after every turn (oldest blocks dropped first).
  on('classic.Stop', async ($, e, next) => {
    const r = await next(e)
    if ((await $.env.get('CW_MEMORY')) === '0') return r
    const root = await $.session.root().catch(() => null)
    if (!root) return r
    const p = `${root}/${FILES.session}`
    const text = await readText($, p)
    const max = maxLinesFrom((await $.env.get('CW_MEMORY_MAX_LINES')) ?? (await $.env.get('MD_MEMORY_MAX_LINES')))
    const out = trimSession(text, max)
    if (text && out !== text) {
      await $.fs.write(p, out)
      await flush(sink, sink.record('memory', { action: 'trim' }), (p2, b) => $.fs.write(p2, b))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUseFailure', async ($, e, next) => {
    const r = await next(e)
    if (e?.tool_name === 'Skill') {
      tracker.skillFailed(e.tool_input?.skill ?? null)
      await flush(sink, sink.record('skill.failed', { skill: e.tool_input?.skill ?? null, error: short(e.error ?? '', 200) }), (p, b) => $.fs.write(p, b))
    }
    return r
  }).catch(($, e, next) => next(e))
}
