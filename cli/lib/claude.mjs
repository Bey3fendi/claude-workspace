// Thin wrapper over the official `claude plugin` CLI. We let Claude Code write its own
// settings keys (extraKnownMarketplaces, enabledPlugins) and plugin registry.
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { run, parseJsonOutput, mustJson } from './run.mjs'
import { readJsonFile, UserError } from './util.mjs'

const T = 600_000

export function claudeVersion(ctx) {
  const r = run(ctx.claudeBin, ['--version'], { env: ctx.env, timeoutMs: 30_000 })
  if (r.code !== 0) return null
  const m = r.stdout.match(/(\d+\.\d+\.\d+)/)
  return m ? m[1] : null
}

export function listPlugins(ctx) {
  const r = run(ctx.claudeBin, ['plugin', 'list', '--json'], { cwd: ctx.projectRoot, env: ctx.env, timeoutMs: 120_000 })
  if (r.code !== 0) throw new UserError(`claude plugin list failed: ${(r.stderr || r.stdout).trim().slice(0, 400)}`)
  const j = mustJson(r, 'claude plugin list')
  return Array.isArray(j) ? j : []
}

export function listMarketplaces(ctx) {
  const r = run(ctx.claudeBin, ['plugin', 'marketplace', 'list', '--json'], { cwd: ctx.projectRoot, env: ctx.env, timeoutMs: 120_000 })
  if (r.code !== 0) return []
  const j = parseJsonOutput(r.stdout)
  return Array.isArray(j) ? j : []
}

function op(ctx, args, what) {
  const r = run(ctx.claudeBin, ['plugin', ...args, '--json'], { cwd: ctx.projectRoot, env: ctx.env, timeoutMs: T })
  const j = parseJsonOutput(r.stdout) || {}
  return { ok: r.code === 0 && j.outcome !== 'failed', code: r.code, result: j, message: j.message || (r.stderr || r.stdout).trim().slice(0, 400), what }
}

export const marketplaceAdd = (ctx, source) => op(ctx, ['marketplace', 'add', source, '--scope', 'project'], `marketplace add ${source}`)
export const marketplaceRemove = (ctx, name) => op(ctx, ['marketplace', 'remove', name, '--scope', 'project'], `marketplace remove ${name}`)
export const pluginInstall = (ctx, id) => op(ctx, ['install', id, '--scope', 'project'], `install ${id}`)
export const marketplaceUpdate = (ctx, name) => op(ctx, ['marketplace', 'update', name], `marketplace update ${name}`)
export const pluginUpdate = (ctx, id) => op(ctx, ['update', id, '--scope', 'project'], `update ${id}`)
export const pluginEnable = (ctx, id) => op(ctx, ['enable', id, '--scope', 'project'], `enable ${id}`)
export const pluginUninstall =(ctx, id) => op(ctx, ['uninstall', id, '--scope', 'project', '-y'], `uninstall ${id}`)

/** Claude Code's install registry: exact gitCommitSha per install (verified Phase 0). */
export function installedRegistry(ctx) {
  const j = readJsonFile(join(ctx.configDir, 'plugins', 'installed_plugins.json'), { missing: { plugins: {} } })
  return j.plugins || {}
}

/** Registry record for id installed at project scope for this project. */
export function projectInstall(ctx, id) {
  const recs = installedRegistry(ctx)[id] || []
  return recs.find((r) => r.scope === 'project' && r.projectPath === ctx.projectRoot) || null
}

/**
 * Other projects (still on disk) that have plugins from this marketplace, as Map(projectPath -> ids).
 * Claude Code keeps marketplaces in one per-user registry, even when they are declared at project scope,
 * and `marketplace remove` uninstalls the marketplace's plugins in EVERY project (seen live on 2.1.317).
 */
export function otherProjectsUsing(ctx, marketplaceName) {
  const out = new Map()
  for (const [id, rows] of Object.entries(installedRegistry(ctx))) {
    if (!id.endsWith(`@${marketplaceName}`)) continue
    for (const r of rows) {
      if (r.scope !== 'project' || !r.projectPath || r.projectPath === ctx.projectRoot || !existsSync(r.projectPath)) continue
      if (!out.has(r.projectPath)) out.set(r.projectPath, [])
      out.get(r.projectPath).push(id)
    }
  }
  return out
}
