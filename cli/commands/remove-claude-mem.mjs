// remove-claude-mem: the workspace replaced claude-mem with md-memory (0.8.0). This runs claude-mem's own
// uninstaller, after confirmation. It is USER-LEVEL: claude-mem goes away for every project of this user.
// claude-mem's uninstaller keeps its data directory (~/.claude-mem); the workspace never deletes it.
import { join } from 'node:path'
import { listPlugins } from '../lib/claude.mjs'
import { claudeMemInstalls, uninstallClaudeMem, LEGACY_VERSION } from '../lib/claude-mem.mjs'
import { confirm } from '../lib/report.mjs'
import { writeAtomic } from '../lib/util.mjs'

export async function removeClaudeMem(ctx, rep) {
  let installed = []
  try { installed = listPlugins(ctx) } catch {}
  const cms = claudeMemInstalls(installed)
  if (!cms.length) { rep.ok('claude-mem: not installed; nothing to remove'); return { ok: true, removed: false } }
  const ok = await confirm([
    `Remove claude-mem (${cms.map((c) => `${c.scope}${c.version ? ` ${c.version}` : ''}`).join(', ')}) with its own uninstaller (npx claude-mem@${LEGACY_VERSION} uninstall)?`,
    '  - USER-LEVEL: it is removed for ALL your projects, not just this one',
    '  - your claude-mem data in ~/.claude-mem is kept (delete it yourself if you want it gone)',
  ].join('\n'), { yes: ctx.opts.yes, env: ctx.env })
  if (!ok) { rep.warn('claude-mem left installed (confirmation required: re-run with --yes, or interactively)'); return { ok: true, removed: false } }
  const r = uninstallClaudeMem(ctx)
  const log = join(ctx.stateDir, 'logs', `claude-mem-uninstall-${Date.now()}.log`)
  writeAtomic(log, `exit=${r.code}\n${r.stdout}\n${r.stderr}`, 0o600)
  let still = []
  try { still = claudeMemInstalls(listPlugins(ctx)) } catch {}
  if (r.code === 0 && !still.length) { rep.change(`claude-mem removed (user level; ~/.claude-mem kept); log ${log}`); return { ok: true, removed: true } }
  rep.fail(`claude-mem uninstall ${r.code === 0 ? 'ran, but the plugin is still listed' : `failed (exit ${r.code})`}; log ${log}`)
  return { ok: false, removed: false }
}
