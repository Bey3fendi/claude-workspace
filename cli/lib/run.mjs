import { spawnSync } from 'node:child_process'
import { UserError } from './util.mjs'

/**
 * Run an external program without a shell. stdin is always closed (empty input) so
 * upstream installers can never block on a prompt. Output is captured, never streamed:
 * callers decide what (if anything) is shown to the user.
 */
export function run(bin, args, { cwd, env, timeoutMs = 300_000 } = {}) {
  const r = spawnSync(bin, args, {
    cwd, env, input: '', encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
  })
  if (r.error && r.error.code === 'ENOENT') return { code: 127, stdout: '', stderr: `${bin}: not found`, missing: true }
  if (r.error && r.error.code === 'ETIMEDOUT') return { code: 124, stdout: r.stdout || '', stderr: `${bin}: timed out after ${timeoutMs} ms` }
  if (r.error) throw r.error
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '', signal: r.signal }
}

/** Parse `--json` output: whole stdout first, else the last line that looks like JSON. */
export function parseJsonOutput(stdout) {
  const t = stdout.trim()
  if (!t) return null
  try { return JSON.parse(t) } catch {}
  const lines = t.split('\n').reverse()
  for (const l of lines) {
    const s = l.trim()
    if (s.startsWith('{') || s.startsWith('[')) { try { return JSON.parse(s) } catch {} }
  }
  return null
}

export function mustJson(res, what) {
  const j = parseJsonOutput(res.stdout)
  if (j == null) throw new UserError(`${what}: could not parse JSON output (exit ${res.code}): ${(res.stderr || res.stdout).trim().slice(0, 400)}`)
  return j
}
