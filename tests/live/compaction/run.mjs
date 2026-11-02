#!/usr/bin/env node
// Live check of the Phase 4 compaction restore (costs real requests: ~1 debug turn + 1 compaction).
//   node tests/live/compaction/run.mjs [--workdir DIR] [--max-usage 0.9]
// One `claude -p` process with stream-json *input*, so workspace-core's in-memory request state survives:
//   1. a debug prompt (read-only: investigate, no edits)
//   2. `/compact`
// Pass = workspace-core logged `compact.restore` AND the engine's session transcript holds the restore
// text after the compaction boundary (engine evidence, not the model's words).
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { git } from '../outcomes/fixture.mjs'
import { usageFrom, overLimit, fmtUsage } from '../usage-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const FIXTURE = join(REPO, 'tests', 'live', 'activation', 'fixture-project')
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []))
const WORK = resolve(args.workdir ?? join(tmpdir(), `cw-compaction-${Date.now()}`))
const MAX_USAGE = Number(args['max-usage'] ?? 0.95)
const CLAUDE = process.env.CW_CLAUDE_BIN || 'claude'
const log = (m) => process.stderr.write(`[compaction] ${m}\n`)

const dir = join(WORK, 'shop-cart')
if (!existsSync(dir)) {
  cpSync(FIXTURE, dir, { recursive: true })
  git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'fixture')
  const r = spawnSync(process.execPath, [join(REPO, 'cli', 'bin', 'claude-workspace.mjs'), 'install', '--yes', '--project', dir, '--json'], { encoding: 'utf8', input: '' })
  const res = JSON.parse(r.stdout.trim().split('\n').pop())
  if (!res.ok) throw new Error(`workspace install failed: ${res.error || res.failures.join('; ')}`)
}
const core = join(WORK, 'core')
const MESSAGES = [
  "The test 'quantity discount starts at 10 items' fails. Investigate why, but do not edit any files yet.",
  '/compact',
]

const ch = spawn(CLAUDE, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--allowedTools', 'Skill', 'Read', 'Grep', 'Glob', 'Bash(node --test:*)', 'Bash(npm test:*)',
  '--settings', JSON.stringify({ enabledPlugins: { 'claude-mem@thedotmack': false } })],
{ cwd: dir, env: { ...process.env, CW_EVENTS_DIR: core }, stdio: ['pipe', 'pipe', 'pipe'] })
let out = '', buf = '', sent = 0, results = 0, aborted = null
const send = () => {
  if (sent >= MESSAGES.length || aborted) { ch.stdin.end(); return }
  const text = MESSAGES[sent++]
  log(`send ${sent}: ${text.slice(0, 60)}`)
  ch.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n')
}
ch.stdout.on('data', (d) => {
  out += d; buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1)
    let e; try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'result') {
      results++
      log(`result ${results}: ${e.subtype}${e.is_error ? ' (error)' : ''} $${(e.total_cost_usd ?? 0).toFixed(2)}`)
      const over = overLimit(usageFrom(out), MAX_USAGE)
      if (e.is_error || over) aborted = e.is_error ? String(e.result).slice(0, 120) : over
      send()
    }
  }
})
ch.stderr.on('data', (d) => { out += d })
const timer = setTimeout(() => ch.kill('SIGTERM'), 600_000)
send()
await new Promise((r) => ch.on('close', r))
clearTimeout(timer)
mkdirSync(WORK, { recursive: true })
writeFileSync(join(WORK, 'stream.jsonl'), out)

// ---------------------------------------------------------------- evidence
const rows = []
const walk = (d) => { if (!existsSync(d)) return; for (const f of readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(join(d, f.name)) : f.name.endsWith('.jsonl') && rows.push(...readFileSync(join(d, f.name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))) }
walk(core)
rows.sort((a, b) => a.t - b.t || a.seq - b.seq)
const restore = rows.find((r) => r.ev === 'compact.restore')
// Delivery evidence: the engine's own session transcript holds the restore text after the compaction.
const MARK = 'restored after compaction]'
const transcript = restore?.sid ? join(homedir(), '.claude', 'projects', realpathSync(dir).replace(/[^A-Za-z0-9]/g, '-'), `${restore.sid}.jsonl`) : null
const tlines = transcript && existsSync(transcript) ? readFileSync(transcript, 'utf8').split('\n') : []
const boundary = tlines.findIndex((l) => l.includes('"compact_boundary"') || l.includes('"isCompactSummary":true'))
const delivered = tlines.some((l, i) => i > boundary && l.includes(MARK))
const inStream = out.includes(MARK)
const cost = [...out.matchAll(/"total_cost_usd":\s*([\d.]+)/g)].map((m) => Number(m[1])).pop() ?? 0
const usage = usageFrom(out)
const res = { class: rows.find((r) => r.ev === 'classify')?.class ?? null, restore: restore ?? null, deliveredInjection: delivered, markerInStream: inStream, results, aborted, costUsd: cost, usage }
writeFileSync(join(WORK, 'result.json'), JSON.stringify(res, null, 2))
log(`class=${res.class} restore=${!!restore} delivered=${delivered} markerInStream=${inStream} cost=$${cost.toFixed(2)} usage=${fmtUsage(usage)}${aborted ? ` aborted: ${aborted}` : ''}`)
log(`${restore && delivered ? 'PASS' : 'FAIL'} · evidence: ${join(WORK, 'result.json')}`)
process.exitCode = restore && delivered ? 0 : 1
