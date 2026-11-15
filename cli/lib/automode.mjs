// Auto mode trust (0.19.0). Auto mode's classifier blocks a push to a repo it does not trust; it is told which
// repos are trusted, in plain English, by `autoMode.environment`, which Claude Code reads only from the user's
// own settings (~/.claude/settings.json) or managed settings, never from a project's files. So the workspace
// only hints at it (doctor) and writes it on request (`install --trust-remote`), recording the line it added.
import { join } from 'node:path'
import { run } from './run.mjs'
import { readJsonFile, writeJsonIfChanged } from './util.mjs'

/** A git remote URL → host/owner/repo (null when it is not one). */
export function normalizeRemote(url) {
  const u = String(url ?? '').trim()
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/i.exec(u)
  if (!m || /^(file|\/|\.)/.test(u)) return null
  const path = m[2].replace(/^\/+/, '')
  return path.includes('/') ? `${m[1].toLowerCase()}/${path}` : null
}

export const trustLine = (remote) => `Source control: ${remote} (this project's repo)`
export const userSettingsPath = (ctx) => join(ctx.configDir, 'settings.json')

export function originRemote(ctx) {
  const r = run('git', ['-C', ctx.projectRoot, 'remote', 'get-url', 'origin'], { timeoutMs: 10_000 })
  return r.code === 0 ? normalizeRemote(r.stdout) : null
}

/** Is the remote already named in autoMode.environment (by the workspace's line or the user's own)? */
export function isTrusted(settings, remote) {
  const env = settings?.autoMode?.environment
  return Array.isArray(env) && env.some((l) => typeof l === 'string' && l.toLowerCase().includes(remote.toLowerCase()))
}

/** Add the line. A new list starts with "$defaults": a list without it replaces the built-in rules. */
export function addTrust(settings, line) {
  const s = structuredClone(settings ?? {})
  s.autoMode = s.autoMode && typeof s.autoMode === 'object' ? s.autoMode : {}
  const env = Array.isArray(s.autoMode.environment) ? s.autoMode.environment : null
  const created = !env
  if (env?.includes(line)) return { settings: s, added: false, created: false }
  s.autoMode.environment = created ? ['$defaults', line] : [...env, line]
  return { settings: s, added: true, created }
}

/** Remove the line it added; a list left as just ["$defaults"] that the workspace created goes too. */
export function removeTrust(settings, line, created) {
  const s = structuredClone(settings ?? {})
  const env = s.autoMode?.environment
  if (!Array.isArray(env) || !env.includes(line)) return { settings: s, removed: false }
  s.autoMode.environment = env.filter((l) => l !== line)
  if (created && s.autoMode.environment.length === 1 && s.autoMode.environment[0] === '$defaults') delete s.autoMode.environment
  if (!Object.keys(s.autoMode).length) delete s.autoMode
  return { settings: s, removed: true }
}

export const readUserSettings = (ctx) => readJsonFile(userSettingsPath(ctx), { missing: {} })
export const writeUserSettings = (ctx, s) => writeJsonIfChanged(userSettingsPath(ctx), s)
