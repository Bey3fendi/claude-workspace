#!/usr/bin/env node
// Live check of the plan-execution choice (costs real requests: one write-enabled session on a 2-task plan).
//   node tests/live/plan-execution/run.mjs [--workdir DIR] [--max-usage 0.6]
// The plan carries Superpowers' usual header ("subagent-driven-development (recommended) or executing-plans").
// Pass (engine evidence from the stream, not the model's words):
//   - superpowers:executing-plans is loaded; superpowers:subagent-driven-development is not loaded
//   - the tasks are implemented in the main session (main-loop Edit/Write calls, none inside subagents)
//   - at most one subagent (Agent/Task tool) is dispatched: the whole-branch review
//   - afterwards no test fails that did not fail before (the fixture keeps three deliberately failing tests)
// The fixture starts on a feature branch: executing-plans will not implement on master without consent.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { git } from '../outcomes/fixture.mjs'
import { usageFrom, overLimit, fmtUsage } from '../usage-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const FIXTURE = join(REPO, 'tests', 'live', 'activation', 'fixture-project')
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []))
const WORK = resolve(args.workdir ?? join(tmpdir(), `cw-plan-${Date.now()}`))
const MAX_USAGE = Number(args['max-usage'] ?? 0.95)
const CLAUDE = process.env.CW_CLAUDE_BIN || 'claude'
const log = (m) => process.stderr.write(`[plan-execution] ${m}\n`)

const PLAN = [
  '# Cart Helpers Implementation Plan',
  '',
  '> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.',
  '',
  '**Goal:** Two small helpers for the cart: an item counter and a cents formatter.',
  '',
  '**Architecture:** Plain functions in `src/`, tested with `node --test`.',
  '',
  '---',
  '',
  '### Task 1: itemCount',
  '',
  '**Files:** Modify `src/cart.js`, test `test/cart.test.js`',
  '',
  '- [ ] Write a failing test: `itemCount([{price:100,qty:2},{price:50,qty:3}])` returns `5`; `itemCount([])` returns `0`.',
  '- [ ] Run `npm test`; expected: the new test fails (itemCount is not exported).',
  '- [ ] Implement `export function itemCount(items)` summing `qty`.',
  '- [ ] Run `npm test`; expected: the new tests pass (three pre-existing cart/coupon tests fail; they are out of scope, leave them).',
  '- [ ] Commit: `git add -A && git commit -m "itemCount"`',
  '',
  '### Task 2: formatCents',
  '',
  '**Files:** Create `src/format.js`, create `test/format.test.js`',
  '',
  '- [ ] Write a failing test: `formatCents(1234)` is `"$12.34"`, `formatCents(5)` is `"$0.05"`, `formatCents(-250)` is `"-$2.50"`.',
  '- [ ] Run `npm test`; expected: fails (module missing).',
  '- [ ] Implement `export function formatCents(n)` in `src/format.js`.',
  '- [ ] Run `npm test`; expected: the format tests pass.',
  '- [ ] Commit: `git add -A && git commit -m "formatCents"`',
  '',
].join('\n')

const dir = join(WORK, 'shop-cart')
if (!existsSync(dir)) {
  cpSync(FIXTURE, dir, { recursive: true })
  mkdirSync(join(dir, 'docs', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'plans', '2026-11-11-cart-helpers.md'), PLAN)
  git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'fixture')
  const r = spawnSync(process.execPath, [join(REPO, 'cli', 'bin', 'claude-workspace.mjs'), 'install', '--yes', '--project', dir, '--json'], { encoding: 'utf8', input: '' })
  const res = JSON.parse(r.stdout.trim().split('\n').pop())
  if (!res.ok) throw new Error(`workspace install failed: ${res.error || res.failures.join('; ')}`)
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'workspace')
  // executing-plans will not implement on master/main without consent: start on a feature branch.
  git(dir, 'switch', '-q', '-c', 'cart-helpers')
}
// The fixture keeps three deliberately failing tests (the debug suites use them). Only NEW failures count.
const failingOf = (stdout) => (stdout.match(/^not ok .*$/gm) ?? []).map((l) => l.replace(/^not ok \d+ - /, ''))
const baseline = new Set(failingOf(spawnSync('npm', ['test'], { cwd: dir, encoding: 'utf8' }).stdout))
const PROMPT = 'Execute the implementation plan in docs/plans/2026-11-11-cart-helpers.md.'
const a = ['-p', PROMPT, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
  '--allowedTools', 'Skill', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'Agent', 'Task', 'TodoWrite',
  'Bash(npm test:*)', 'Bash(node --test:*)', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git rev-parse:*)',
  '--settings', JSON.stringify({ enabledPlugins: { 'claude-mem@thedotmack': false } })]
log(`workdir ${dir}`)
const ch = spawn(CLAUDE, a, { cwd: dir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
ch.stdout.on('data', (d) => { out += d })
ch.stderr.on('data', (d) => { out += d })
const timer = setTimeout(() => ch.kill('SIGTERM'), 900_000)
ch.on('close', () => {
  clearTimeout(timer)
  writeFileSync(join(WORK, 'stream.jsonl'), out)
  const ev = out.split('\n').flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })
  const uses = ev.filter((e) => e.type === 'assistant')
    .flatMap((e) => (e.message?.content ?? []).filter((c) => c.type === 'tool_use').map((c) => ({ ...c, sub: !!e.parent_tool_use_id })))
  const main = uses.filter((u) => !u.sub)
  const isEdit = (u) => ['Edit', 'Write', 'MultiEdit'].includes(u.name)
  const skills = main.filter((u) => u.name === 'Skill').map((u) => u.input?.skill)
  const agents = main.filter((u) => u.name === 'Agent' || u.name === 'Task')
  const edits = main.filter(isEdit).length
  const subEdits = uses.filter((u) => u.sub && isEdit(u)).length
  const t = spawnSync('npm', ['test'], { cwd: dir, encoding: 'utf8' })
  const failing = failingOf(t.stdout).filter((f) => !baseline.has(f))
  const ran = /itemCount|formatCents|format/i.test(t.stdout)
  const commits = spawnSync('git', ['log', '--oneline'], { cwd: dir, encoding: 'utf8' }).stdout.trim().split('\n')
  const result = [...ev].reverse().find((e) => e.type === 'result')
  const checks = {
    executingPlans: skills.includes('superpowers:executing-plans'),
    noSubagentMode: !skills.includes('superpowers:subagent-driven-development'),
    implementedInline: edits >= 2 && subEdits === 0,
    atMostOneSubagent: agents.length <= 1,
    testsOk: ran && failing.length === 0,
  }
  log(`skills: ${skills.join(', ') || 'none'}`)
  log(`main-session edits ${edits}, subagent edits ${subEdits}, subagents dispatched ${agents.length}${agents.length ? ` (${agents.map((x) => x.input?.description ?? x.input?.subagent_type ?? '?').join('; ')})` : ''}`)
  log(`commits: ${commits.slice(0, 4).join(' | ')}`)
  log(`new test failures after the run: ${failing.join('; ') || 'none'} (pre-existing: ${baseline.size})`)
  log(`result: ${result?.subtype} $${(result?.total_cost_usd ?? 0).toFixed(2)} · usage: ${fmtUsage(usageFrom(out))}${overLimit(usageFrom(out), MAX_USAGE) ? ' (over --max-usage)' : ''}`)
  const pass = Object.values(checks).every(Boolean)
  console.log(JSON.stringify({ pass, checks, skills, agents: agents.length, edits, subEdits, failing, workdir: dir }))
  process.exit(pass ? 0 : 1)
})
