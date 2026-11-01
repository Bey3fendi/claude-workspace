// Independent measurement probe (deliberately shares no code with workspace-core, so it can
// judge it). Observe-only. Writes <CW_PROBE_DIR>/probe.jsonl; inert when CW_PROBE_DIR is unset.
const P = { dir: null, sid: null, lines: [], chain: Promise.resolve(), ready: false }
const rec = (ev, data) => { P.lines.push(JSON.stringify({ t: Date.now(), ev, sid: P.sid, ...data })); return P.dir ? { path: `${P.dir}/probe.jsonl`, body: P.lines.join('\n') + '\n' } : null }
const queue = (w, write) => { if (!w) return P.chain; P.chain = P.chain.then(() => write(w.path, w.body)).catch(() => {}); return P.chain }

export const register = (on) => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    P.dir = (await $.env.get('CW_PROBE_DIR')) || null
    P.sid = await $.session.id()
    await queue(rec('session.start', { interactive: !!e.isInteractive }), (p, b) => $.fs.write(p, b))
    return r
  })
  on('turn.step', async function* ($, e, next) {
    await queue(rec('turn.step', { turnId: e.turnId, index: e.index, model: e.model, effort: e.effort ?? null, agentId: e.agentId ?? null }), (p, b) => $.fs.write(p, b))
    return yield* next(e)
  })
  on('skill.prompt', async ($, e, next) => {
    const r = await next(e)
    await queue(rec('skill.prompt', { skill: e.skill, agentId: e.agentId ?? null }), (p, b) => $.fs.write(p, b))
    return r
  })
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (e.tool === 'Skill') await queue(rec('skill.call', { skill: e.skill ?? null, isError: r?.isError === true, denied: r?.deny !== undefined }), (p, b) => $.fs.write(p, b))
    return r
  }).catch(($, e, next) => next(e))
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const u = r?.usage ?? e.usage
    await queue(rec('turn.complete', { agentId: e.agentId ?? null, reason: e.reason ?? null, usage: u ? { in: u.input_tokens, out: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens } : null }), (p, b) => $.fs.write(p, b))
    return r
  })
}
