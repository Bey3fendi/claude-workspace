// canary: read-only upstream check (Phase 6). Compares the lock's pins with upstream releases and
// claude-mem's npm version, and reports local claude-mem drift. Never installs or changes anything.
import { run } from '../lib/run.mjs'
import { listPlugins } from '../lib/claude.mjs'
import { checkUpstream } from '../lib/canary.mjs'

export async function canary(ctx, rep) {
  let installed = null
  try { installed = listPlugins(ctx).find((e) => e.id === ctx.lock.claudeMem.pluginId)?.version ?? null } catch {}
  const runner = (cmd, args) => {
    const r = run(cmd === 'npm' ? (ctx.env.CW_NPM_BIN || 'npm') : cmd, args, { cwd: ctx.home, env: { ...ctx.env, GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 60_000 })
    return { code: r.code, stdout: r.stdout ?? '' }
  }
  const rows = checkUpstream(ctx.lock, { runner, installedClaudeMem: installed })
  for (const r of rows) {
    const line = `${r.name}${r.enabled === false ? ' (optional)' : ''}: ${r.note}`
    if (r.status === 'update' || r.status === 'drift') rep.warn(line)
    else if (r.status === 'error' || r.status === 'unknown') rep.info(line)
    else rep.ok(line)
  }
  const updates = rows.filter((r) => r.status === 'update').length
  rep.info(updates ? `canary: ${updates} upstream update(s) available; review release notes, bump workspace.lock.json, re-run the live suites` : 'canary: all pins current')
  return { ok: true, rows }
}
