#!/usr/bin/env node
// Live check of the /clear handoff with claude-mem (costs real requests: 2 short read-only turns, plus
// claude-mem's own background summarising).
//   node tests/live/clear-handoff/run.mjs [--workdir DIR] [--max-usage 0.6] [--wait 45]
// One `claude -p` process with stream-json input, claude-mem ENABLED:
//   1. a read-only investigation of a failing test
//   2. (wait for claude-mem to record it) `/clear`
//   3. "what were we working on?" with file tools disallowed
// Evidence (engine, not the model's words): the SessionStart hook output that claude-mem injects after
// the clear mentions the earlier work. The model's answer is reported as secondary evidence.
// The project folder gets a unique name, because claude-mem keys memories by folder name.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { git } from '../outcomes/fixture.mjs'
import { usageFrom, overLimit, fmtUsage } from '../usage-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const FIXTURE = join(REPO, 'tests', 'live', 'activation', 'fixture-project')
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []))
const WORK = resolve(args.workdir ?? join(tmpdir(), `cw-clear-${Date.now()}`))
const MAX_USAGE = Number(args['max-usage'] ?? 0.95)
const WAIT_MS = Number(args.wait ?? 45) * 1000
const CLAUDE = process.env.CW_CLAUDE_BIN || 'claude'
const log = (m) => process.stderr.write(`[clear-handoff] ${m}\n`)

const dir = join(WORK, `cart-handoff-${Date.now().toString(36)}`)
if (!existsSync(dir)) {
  cpSync(FIXTURE, dir, { recursive: true })
  git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'fixture')
  const r = spawnSync(process.execPath, [join(REPO, 'cli', 'bin', 'claude-workspace.mjs'), 'install', '--yes', '--project', dir, '--json'], { encoding: 'utf8', input: '' })
  const res = JSON.parse(r.stdout.trim().split('\n').pop())
  if (!res.ok) throw new Error(`workspace install failed: ${res.error || res.failures.join('; ')}`)
}
const MESSAGES = [
  { text: "The test 'quantity discount starts at 10 items' fails. Investigate why, but do not edit any files.", waitAfter: WAIT_MS },
  { text: '/clear', waitAfter: 0 },
  { text: 'What were we working on before this conversation, and what did we find? Answer only from what you already know; do not open any files.', waitAfter: 0 },
]
const ch = spawn(CLAUDE, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--allowedTools', 'Skill', 'Read', 'Grep', 'Glob', 'Bash(node --test:*)', 'Bash(npm test:*)'],
{ cwd: dir, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
let out = '', buf = '', sent = 0, aborted = null, clearAt = -1
const events = []
const send = () => {
  if (sent >= MESSAGES.length || aborted) { ch.stdin.end(); return }
  const m = MESSAGES[sent++]
  if (m.text === '/clear') clearAt = events.length
  log(`send ${sent}: ${m.text.slice(0, 70)}`)
  ch.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: m.text } }) + '\n')
}
ch.stdout.on('data', (d) => {
  out += d; buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1)
    let e; try { e = JSON.parse(line) } catch { continue }
    events.push(e)
    if (e.type === 'result') {
      log(`result: ${e.subtype}${e.is_error ? ' (error)' : ''} $${(e.total_cost_usd ?? 0).toFixed(2)}`)
      const over = overLimit(usageFrom(out), MAX_USAGE)
      if (e.is_error || over) aborted = e.is_error ? String(e.result).slice(0, 120) : over
      const wait = MESSAGES[sent - 1]?.waitAfter ?? 0
      if (wait && !aborted) log(`waiting ${wait / 1000}s for claude-mem to record the turn`)
      setTimeout(send, wait)
    }
  }
})
ch.stderr.on('data', (d) => { out += d })
const timer = setTimeout(() => ch.kill('SIGTERM'), 900_000)
send()
ch.on('close', () => {
  clearTimeout(timer)
  const after = clearAt >= 0 ? events.slice(clearAt) : []
  const hookOut = after.filter((e) => e.type === 'system' && e.subtype === 'hook_response' && /SessionStart/i.test(JSON.stringify(e)))
  const memHook = hookOut.filter((e) => /claude-mem|mem-search|observation|memory/i.test(JSON.stringify(e)))
  const mentions = memHook.some((e) => /quantity|discount|10 items/i.test(JSON.stringify(e)))
  const answer = [...events].reverse().find((e) => e.type === 'result')?.result ?? ''
  const answerMentions = /quantity|discount/i.test(answer)
  log(`after /clear: ${hookOut.length} SessionStart hook output(s), ${memHook.length} from claude-mem; mentions the earlier work: ${mentions}`)
  log(`answer mentions the earlier work: ${answerMentions}`)
  log(`answer: ${answer.replace(/\s+/g, ' ').slice(0, 400)}`)
  log(`usage: ${fmtUsage(usageFrom(out))}${aborted ? ` · stopped: ${aborted}` : ''}`)
  console.log(JSON.stringify({ pass: mentions, hookOutputs: hookOut.length, memHook: memHook.length, mentions, answerMentions, workdir: dir }))
  process.exit(mentions ? 0 : 1)
})
