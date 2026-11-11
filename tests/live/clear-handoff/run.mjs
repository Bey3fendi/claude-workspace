#!/usr/bin/env node
// Live check of the md-memory /clear handoff (costs real requests: 3 short turns).
//   node tests/live/clear-handoff/run.mjs [--workdir DIR] [--max-usage 0.6]
// One `claude -p` process with stream-json input and a context-pressure threshold of 1K tokens, so the
// pressure note fires on the second prompt:
//   1. a read-only investigation of a failing test
//   2. "let's stop here": the pressure note asks for a handoff block in .memory/session.md
//   3. `/clear`
//   4. "what were we working on?", answered without opening files
// Evidence (engine and disk, not the model's words):
//   - session.md on disk gained a handoff block that names the earlier work, and nothing under src/ changed;
//   - workspace-core logged a memory session-start with source "clear";
//   - the engine's transcript holds, after the clear, the [md-memory] injection carrying that handoff.
// The model's final answer is reported as secondary evidence.
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
const WORK = resolve(args.workdir ?? join(tmpdir(), `cw-clear-${Date.now()}`))
const MAX_USAGE = Number(args['max-usage'] ?? 0.95)
const CLAUDE = process.env.CW_CLAUDE_BIN || 'claude'
const log = (m) => process.stderr.write(`[clear-handoff] ${m}\n`)
const WORK_RE = /quantity|discount|10 items/i

const dir = join(WORK, 'shop-cart')
if (!existsSync(dir)) {
  cpSync(FIXTURE, dir, { recursive: true })
  git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'fixture')
  const r = spawnSync(process.execPath, [join(REPO, 'cli', 'bin', 'claude-workspace.mjs'), 'install', '--yes', '--project', dir, '--json'], { encoding: 'utf8', input: '' })
  const res = JSON.parse(r.stdout.trim().split('\n').pop())
  if (!res.ok) throw new Error(`workspace install failed: ${res.error || res.failures.join('; ')}`)
}
const SESSION = join(dir, '.memory', 'session.md')
const before = readFileSync(SESSION, 'utf8')
const core = join(WORK, 'core')
const MESSAGES = [
  "The test 'quantity discount starts at 10 items' fails. Investigate why, but do not edit any source files.",
  "Thanks, let's stop here for today.",
  '/clear',
  'What were we working on before this conversation, and what did we find? Answer only from what you already know; do not open any files.',
]
const ch = spawn(CLAUDE, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--allowedTools', 'Skill', 'Read', 'Grep', 'Glob', 'Bash(node --test:*)', 'Bash(npm test:*)',
],
{ cwd: dir, env: { ...process.env, CW_EVENTS_DIR: core, CW_CONTEXT_PRESSURE_TOKENS: '1000', CONTEXT_PRESSURE_TOKENS: '1000' }, stdio: ['pipe', 'pipe', 'pipe'] })
let out = '', buf = '', sent = 0, aborted = null
const results = []
const send = () => {
  if (sent >= MESSAGES.length || aborted) { ch.stdin.end(); return }
  const text = MESSAGES[sent++]
  log(`send ${sent}: ${text.slice(0, 70)}`)
  ch.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n')
}
ch.stdout.on('data', (d) => {
  out += d; buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1)
    let e; try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'result') {
      results.push(e)
      log(`result ${results.length}: ${e.subtype}${e.is_error ? ' (error)' : ''} $${(e.total_cost_usd ?? 0).toFixed(2)}`)
      const over = overLimit(usageFrom(out), MAX_USAGE)
      if (e.is_error || over) aborted = e.is_error ? String(e.result).slice(0, 120) : over
      send()
    }
  }
})
ch.stderr.on('data', (d) => { out += d })
const timer = setTimeout(() => ch.kill('SIGTERM'), 900_000)
send()
await new Promise((r) => ch.on('close', r))
clearTimeout(timer)
mkdirSync(WORK, { recursive: true })
writeFileSync(join(WORK, 'stream.jsonl'), out)

// ---------------------------------------------------------------- evidence
const after = readFileSync(SESSION, 'utf8')
const added = after.slice(after.startsWith(before) ? before.length : 0)
const handoffWritten = after !== before && WORK_RE.test(added)
const srcClean = git(dir, 'status', '--porcelain', '--', 'src', 'test').trim() === ''

const rows = []
const walk = (d) => { if (!existsSync(d)) return; for (const f of readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(join(d, f.name)) : f.name.endsWith('.jsonl') && rows.push(...readFileSync(join(d, f.name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))) }
walk(core)
const memStarts = rows.filter((r) => r.ev === 'memory' && r.action === 'session-start')
const clearStart = memStarts.find((r) => r.source === 'clear')

// Delivery: a transcript line carrying the [md-memory] injection together with the handoff. The startup
// injection was written before the handoff existed, so such a line can only come from the reload.
const tdir = join(homedir(), '.claude', 'projects', realpathSync(dir).replace(/[^A-Za-z0-9]/g, '-'))
const tlines = existsSync(tdir) ? readdirSync(tdir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => readFileSync(join(tdir, f), 'utf8').split('\n')) : []
const delivered = tlines.some((l) => l.includes('[md-memory]') && WORK_RE.test(l))

const answer = results.at(-1)?.result ?? ''
const answerMentions = results.length === MESSAGES.length && WORK_RE.test(answer)
const pass = handoffWritten && srcClean && !!clearStart && delivered
const cost = results.reduce((s, e) => Math.max(s, e.total_cost_usd ?? 0), 0)
const res = { pass, handoffWritten, srcClean, memoryStarts: memStarts.map((r) => r.source), clearReload: !!clearStart, deliveredAfterClear: delivered, answerMentions, results: results.length, aborted, costUsd: cost, usage: usageFrom(out), workdir: dir }
writeFileSync(join(WORK, 'result.json'), JSON.stringify(res, null, 2))
log(`handoff written=${handoffWritten} src clean=${srcClean} memory starts=${res.memoryStarts.join(',')} delivered after clear=${delivered}`)
log(`answer mentions the earlier work: ${answerMentions} · ${answer.replace(/\s+/g, ' ').slice(0, 300)}`)
log(`usage: ${fmtUsage(res.usage)}${aborted ? ` · stopped: ${aborted}` : ''}`)
log(`${pass ? 'PASS' : 'FAIL'} · evidence: ${join(WORK, 'result.json')}`)
process.exitCode = pass ? 0 : 1
