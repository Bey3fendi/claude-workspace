import { readFileSync, existsSync } from 'node:fs'
import { run } from './run.mjs'
import { claudeVersion } from './claude.mjs'
import { cmpVersion, UserError } from './util.mjs'
import { TOUCHED } from './context.mjs'

export function detectPlatform(env = process.env) {
  if (process.platform === 'win32') return { ok: false, name: 'windows', message: 'native Windows is not supported; run inside WSL (or a Linux devcontainer)' }
  if (process.platform === 'darwin') return { ok: true, name: 'macos' }
  if (process.platform !== 'linux') return { ok: false, name: process.platform, message: `unsupported platform ${process.platform}` }
  let rel = ''
  try { rel = readFileSync('/proc/sys/kernel/osrelease', 'utf8') } catch {}
  // A container on Docker-in-WSL shares the WSL kernel string, so check for a container first.
  if (env.REMOTE_CONTAINERS || env.CODESPACES || env.DEVCONTAINER || existsSync('/.dockerenv') || existsSync('/run/.containerenv'))
    return { ok: true, name: 'devcontainer' }
  if (/microsoft|wsl/i.test(rel) || env.WSL_DISTRO_NAME) return { ok: true, name: 'wsl' }
  return { ok: true, name: 'linux' }
}

/** Hard requirements. Throws UserError on the first failure. */
export function preflight(ctx) {
  const plat = detectPlatform(ctx.env)
  if (!plat.ok) throw new UserError(plat.message)
  if (cmpVersion(process.versions.node, ctx.lock.node.min) < 0)
    throw new UserError(`Node ${ctx.lock.node.min}+ required (found ${process.versions.node})`)
  const cv = claudeVersion(ctx)
  if (!cv) throw new UserError(`Claude Code CLI not found or not runnable (${ctx.claudeBin}); install it first: https://code.claude.com/docs`)
  if (cmpVersion(cv, ctx.lock.claudeCode.min) < 0)
    throw new UserError(`Claude Code ${ctx.lock.claudeCode.min}+ required (found ${cv})`)
  return { platform: plat.name, claudeVersion: cv, tested: ctx.lock.claudeCode.tested.includes(cv) }
}

/**
 * Same-named plugins installed from somewhere else that would also load in this project
 * (user scope, or project/local scope for this project from another marketplace).
 */
export function findDuplicates(ctx, installed) {
  const names = new Set(ctx.lock.plugins.map((p) => p.name))
  const out = []
  for (const e of installed) {
    const [name, mkt] = String(e.id).split('@')
    if (!names.has(name)) continue
    const here = e.scope === 'user' || (e.projectPath === ctx.projectRoot && (e.scope === 'project' || e.scope === 'local'))
    if (!here) continue
    if (mkt === ctx.marketplaceName && e.scope === 'project') continue
    out.push({ id: e.id, scope: e.scope, enabled: e.enabled !== false })
  }
  return out
}

/** Things that would compete with the optional router. Warnings only. */
export function findRouterConflicts(ctx, installed) {
  const out = []
  if (ctx.env.ANTHROPIC_BASE_URL) out.push(`ANTHROPIC_BASE_URL is set (${ctx.env.ANTHROPIC_BASE_URL}); a proxy may already route models`)
  for (const e of installed) {
    const [name, mkt] = String(e.id).split('@')
    if (/router/i.test(name) && mkt !== ctx.marketplaceName && e.enabled !== false) out.push(`router-like plugin ${e.id} (${e.scope}) is enabled`)
  }
  return out
}

/** Touched files with uncommitted changes (only if the project is a git work tree). */
export function dirtyTouchedFiles(ctx) {
  const inside = run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ctx.projectRoot, env: ctx.env, timeoutMs: 30_000 })
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') return []
  const r = run('git', ['status', '--porcelain', '--untracked-files=all', '--', ...TOUCHED], { cwd: ctx.projectRoot, env: ctx.env, timeoutMs: 30_000 })
  if (r.code !== 0) return []
  return r.stdout.split('\n').filter(Boolean).map((l) => l.slice(3)).filter((f) => !f.startsWith('.claude/workspace/'))
}
