// claude-mem integration: pinned npx installer, telemetry OFF enforcement, health.
// Policy (plan §3a): telemetry must be OFF. We use only claude-mem's own `telemetry disable`
// mechanism; we never set DO_NOT_TRACK and never edit the user's shell or settings files.
import { readdirSync } from 'node:fs'
import { join, delimiter } from 'node:path'
import { run } from './run.mjs'
import { readMaybe, readJsonFile, stripAnsi, writeAtomic, exists } from './util.mjs'

const pkg = (ctx) => `${ctx.lock.claudeMem.npmPackage}@${ctx.lock.claudeMem.version}`
const npx = (ctx, args, { env = ctx.env, timeoutMs = 300_000 } = {}) =>
  run(ctx.npxBin, ['-y', pkg(ctx), ...args], { cwd: ctx.home, env, timeoutMs })

export const TELEMETRY_VAR = 'CLAUDE_MEM_TELEMETRY'
const ENABLING = /^(1|true|on|yes)$/i
const DISABLING = /^(0|false|off|no)$/i

// ---------------------------------------------------------------- install

/**
 * Run the pinned upstream installer. Its output is written to a private log and NEVER relayed:
 * the installer prints agent-directed text (Phase 0: "AGENT: show this link to the user...").
 * Only a whitelisted summary is returned.
 */
export function installClaudeMem(ctx) {
  const r = npx(ctx, ctx.lock.claudeMem.installArgs, { timeoutMs: 900_000 })
  const raw = `$ npx -y ${pkg(ctx)} ${ctx.lock.claudeMem.installArgs.join(' ')}\nexit=${r.code}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`
  const logFile = join(ctx.stateDir, 'logs', `claude-mem-install-${Date.now()}.log`)
  writeAtomic(logFile, raw, 0o600)
  return { ok: r.code === 0, code: r.code, logFile, ...summarizeInstallerOutput(r.stdout + '\n' + r.stderr) }
}

/** Whitelist summary of upstream installer output. Agent-directed lines are counted, never shown. */
export function summarizeInstallerOutput(text) {
  const lines = stripAnsi(text).split(/\r?\n/)
  const agentLines = lines.filter((l) => /^\s*AGENT\s*:/i.test(l)).length
  const version = lines.map((l) => l.match(/^\s*Version:\s*v?([\w.-]+)/i)).find(Boolean)?.[1] ?? null
  const complete = lines.some((l) => /Installation Complete/i.test(l))
  return { version, complete, agentLines }
}

export const uninstallClaudeMem = (ctx) => npx(ctx, ['uninstall'], { timeoutMs: 600_000 })

// ---------------------------------------------------------------- telemetry

export function parseTelemetryStatus(text) {
  const t = stripAnsi(text)
  const state = t.match(/^\s*Telemetry:\s*(ENABLED|DISABLED)/mi)?.[1]?.toUpperCase() ?? null
  const decidedBy = t.match(/^\s*Decided by:\s*(.+)$/mi)?.[1]?.trim() ?? null
  const configFile = t.match(/^\s*Config file:\s*(.+)$/mi)?.[1]?.trim() ?? null
  let source = null
  if (decidedBy) {
    if (/DO_NOT_TRACK/i.test(decidedBy)) source = 'DO_NOT_TRACK'
    else if (/CLAUDE_MEM_TELEMETRY/i.test(decidedBy)) source = 'env'
    else if (/config/i.test(decidedBy)) source = 'config'
    else if (/default/i.test(decidedBy)) source = 'default'
    else source = 'other'
  }
  return { state, decidedBy, source, configFile }
}

/** Env with the telemetry-affecting variables removed: shows what the persistent config decides. */
export function cleanEnv(env) {
  const e = { ...env }
  delete e[TELEMETRY_VAR]
  delete e.DO_NOT_TRACK
  return e
}

export function telemetryStatus(ctx, env = ctx.env) {
  const r = npx(ctx, ['telemetry', 'status'], { env, timeoutMs: 180_000 })
  return { code: r.code, ...parseTelemetryStatus(r.stdout + '\n' + r.stderr) }
}

export const telemetryDisable = (ctx) => npx(ctx, ['telemetry', 'disable'], { env: cleanEnv(ctx.env), timeoutMs: 180_000 })

/**
 * Locations where CLAUDE_MEM_TELEMETRY could be set for claude-mem processes:
 * the current environment, the `env` block of every Claude Code settings scope (hooks inherit
 * it), and common shell startup files. Read-only.
 */
export function scanTelemetryOverrides(ctx) {
  const found = []
  const note = (location, value) => found.push({
    location, value, effect: ENABLING.test(value) ? 'enables' : DISABLING.test(value) ? 'disables' : 'unknown',
  })
  if (ctx.env[TELEMETRY_VAR] != null) note('process environment', ctx.env[TELEMETRY_VAR])

  const settingsFiles = []
  for (const d of ctx.managedDirs) {
    settingsFiles.push(['managed', join(d, 'managed-settings.json')])
    try {
      for (const f of readdirSync(join(d, 'managed-settings.d')).filter((f) => f.endsWith('.json')).sort())
        settingsFiles.push(['managed', join(d, 'managed-settings.d', f)])
    } catch {}
  }
  settingsFiles.push(['user', join(ctx.configDir, 'settings.json')])
  settingsFiles.push(['project', ctx.p('.claude/settings.json')])
  settingsFiles.push(['local', ctx.p('.claude/settings.local.json')])
  for (const [scope, f] of settingsFiles) {
    let s
    try { s = readJsonFile(f, { missing: null }) } catch { found.push({ location: `${scope} settings ${f}`, value: null, effect: 'unknown', error: 'unparseable JSON' }); continue }
    const v = s?.env?.[TELEMETRY_VAR]
    if (v != null) note(`${scope} settings ${f} (env.${TELEMETRY_VAR})`, String(v))
  }

  const rcFiles = ['.bashrc', '.bash_profile', '.bash_login', '.profile', '.zshrc', '.zshenv', '.zprofile', '.zlogin', '.config/fish/config.fish', '.pam_environment']
  const lineRe = new RegExp(`^\\s*(?:export\\s+|set\\s+(?:-[a-zA-Z]+\\s+)*)?${TELEMETRY_VAR}(?:\\s*=\\s*|\\s+)["']?([^"'\\s#;]*)`, 'm')
  for (const rc of [...rcFiles.map((f) => join(ctx.home, f)), '/etc/environment']) {
    const b = readMaybe(rc)
    if (!b) continue
    const lines = b.toString('utf8').split(/\r?\n/)
    lines.forEach((l, i) => { const m = l.match(lineRe); if (m) note(`${rc}:${i + 1}`, m[1]) })
  }
  return found
}

/**
 * Enforce and verify telemetry OFF. Steps:
 *  1. status with telemetry env vars removed -> must be DISABLED decided by the config file;
 *     if ENABLED or decided by default and `fix`, run `telemetry disable` and re-check.
 *  2. scan for enabling overrides; any is an error (we report its location, never edit it).
 *  3. effective status with the real environment must be DISABLED.
 */
export function enforceTelemetry(ctx, { fix = true } = {}) {
  const actions = []
  let base = telemetryStatus(ctx, cleanEnv(ctx.env))
  if (base.state == null) {
    return { ok: false, actions, base, overrides: [], effective: null, message: `could not read claude-mem telemetry status (exit ${base.code})` }
  }
  if (!(base.state === 'DISABLED' && base.source === 'config') && fix) {
    const r = telemetryDisable(ctx)
    actions.push(`ran \`npx ${pkg(ctx)} telemetry disable\` (exit ${r.code})`)
    base = telemetryStatus(ctx, cleanEnv(ctx.env))
  }
  const overrides = scanTelemetryOverrides(ctx)
  const enabling = overrides.filter((o) => o.effect === 'enables' || o.error)
  const effective = telemetryStatus(ctx, ctx.env)
  const problems = []
  if (!(base.state === 'DISABLED' && base.source === 'config')) problems.push(`persistent config is not DISABLED (status: ${base.state}, decided by: ${base.decidedBy})`)
  for (const o of enabling) problems.push(o.error ? `cannot verify ${o.location}: ${o.error}` : `${TELEMETRY_VAR}=${o.value} at ${o.location} re-enables telemetry; remove it`)
  if (effective.state !== 'DISABLED') problems.push(`effective status is ${effective.state ?? 'unknown'} (decided by: ${effective.decidedBy})`)
  return {
    ok: problems.length === 0,
    actions, base, overrides, effective, problems,
    message: problems.length ? problems.join('; ') : `OFF (source: ${base.decidedBy}${base.configFile ? `, ${base.configFile}` : ''})`,
  }
}

// ---------------------------------------------------------------- health

export function workerPort(ctx) {
  try {
    const s = readJsonFile(join(ctx.home, '.claude-mem', 'settings.json'), { missing: {} })
    if (s.CLAUDE_MEM_WORKER_PORT) return Number(s.CLAUDE_MEM_WORKER_PORT)
  } catch {}
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0
  return 37700 + (uid % 100)
}

export async function workerHealth(ctx, timeoutMs = 1500) {
  const port = workerPort(ctx)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) })
    const body = await res.json().catch(() => ({}))
    return { port, up: res.ok, status: res.status, version: body.version ?? null }
  } catch { return { port, up: false } }
}

export function findOnPath(ctx, name, extra = []) {
  const dirs = [...(ctx.env.PATH || '').split(delimiter), ...extra]
  for (const d of dirs) { if (d && exists(join(d, name))) return join(d, name) }
  return null
}
