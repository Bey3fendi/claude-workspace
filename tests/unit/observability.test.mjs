import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { redact, redactDeep, projectKey, promptSummary, markerCounts, attributeCommand, fnv64 } from '../../plugins/workspace-core/lib/events.mjs'
import { createSink, flush } from '../../plugins/workspace-core/lib/sink.mjs'
import { createReader } from '../../observability/reader.mjs'
import { deriveSession, summarize } from '../../observability/derive.mjs'
import { ROOT } from '../helpers.mjs'

const FIX = join(ROOT, 'tests', 'fixtures', 'events')

// ---------------------------------------------------------------- shared lib

test('redaction scrubs common secret shapes and keeps ordinary text', () => {
  const cases = [
    'key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA end',
    'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123',
    'AKIAABCDEFGHIJKLMNOP',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
    'TYPESAFE_API_KEY=ts_live_123456789',
    'password: hunter2hunter2',
    'https://user:pa55word@example.com/repo.git',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
  ]
  for (const c of cases) {
    const r = redact(c)
    assert.match(r, /REDACTED/, c)
    assert.ok(!/AAAAAAAAAAAA|ABCDEFGHIJKLMNOPQRST|abcdefghijklmnopqrstuvwxyz0|ts_live_1234|hunter2|pa55word|MIIabc|eyJzdWIi/.test(r), r)
  }
  assert.equal(redact('fix the failing test in src/app.ts'), 'fix the failing test in src/app.ts')
  assert.deepEqual(redactDeep({ a: ['token=abcdefgh123'], n: 3 }), { a: ['token=[REDACTED]'], n: 3 })
})

test('prompt summary stores hash, redacted 80-char preview and length only', () => {
  const s = promptSummary('deploy with API_KEY=supersecret123 ' + 'x'.repeat(200))
  assert.equal(s.len, 235)
  assert.ok(s.preview.length <= 80)
  assert.ok(!s.preview.includes('supersecret'))
  assert.equal(s.hash, fnv64('deploy with API_KEY=supersecret123 ' + 'x'.repeat(200)))
})

test('project keys are stable and filesystem-safe', () => {
  assert.equal(projectKey('/home/u/my proj'), projectKey('/home/u/my proj'))
  assert.notEqual(projectKey('/a/app'), projectKey('/b/app'))
  assert.match(projectKey('/home/u/my proj'), /^my_proj-[0-9a-f]{10}$/)
})

test('marker counts and command attribution', () => {
  assert.deepEqual(markerCounts('You have superpowers. # claude-mem status'), { superpowers: 1, claudeMem: 1 })
  assert.deepEqual(markerCounts([{ type: 'text', text: 'PONYTAIL MODE ACTIVE' }]), { ponytail: 1 })
  assert.deepEqual(markerCounts(null), {})
  assert.equal(attributeCommand('claude-mem hook claude-code context'), 'claudeMem')
  assert.equal(attributeCommand('"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start'), null)
})

// ---------------------------------------------------------------- mod sink

test('sink: rows before setup are carried, segments rotate, ids change on new session', () => {
  const s = createSink()
  assert.equal(s.record('injection', { len: 5 }), null, 'no path before setup')
  s.setup({ home: '/h', xdg: undefined, override: undefined, root: '/w/p', sid: 'S1' })
  const w = s.record('session.start', {})
  assert.match(w.path, new RegExp(`^/h/\\.local/state/claude-workspace/events/p-[0-9a-f]{10}/S1\\.${s.state.run}\\.000\\.jsonl$`))
  const rows = w.body.trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(rows.map((r) => r.ev), ['injection', 'session.start'])
  for (let i = 0; i < 600; i++) s.record('tool.call', { tool: 'Read' })
  assert.match(s.record('tool.call', {}).path, /\.001\.jsonl$/)
  s.setSid('S2')
  assert.match(s.record('turn.start', {}).path, /\/S2\..*\.000\.jsonl$/)
  assert.ok(s.record('x', { secret: 'token=abcdefgh1234' }).body.includes('token=[REDACTED]'))
})

test('sink: flush serializes writes so an older body never lands last', async () => {
  const s = createSink()
  s.setup({ home: '/h', root: '/w', sid: 'S' })
  const landed = []
  const write = (p, b) => new Promise((r) => setTimeout(() => { landed.push(b.split('\n').filter(Boolean).length); r() }, b.length % 7))
  await Promise.all([1, 2, 3, 4, 5].map(() => flush(s, s.record('e'), write)))
  assert.deepEqual(landed, [1, 2, 3, 4, 5])
  await flush(s, s.record('e'), () => Promise.reject(new Error('disk full')))
  assert.equal(s.state.failures, 1, 'failed write is counted, not thrown')
})

// ---------------------------------------------------------------- golden derivation

function loadFixture(name) {
  const dir = join(FIX, name)
  const sessions = createReader(join(dir, 'events')).sessions()
  assert.equal(sessions.size, 1)
  const s = [...sessions.values()][0]
  const hooks = existsSync(join(dir, 'hooks.json')) ? JSON.parse(readFileSync(join(dir, 'hooks.json'), 'utf8')) : null
  return deriveSession({ sid: s.sid, projectKey: s.projectKey, events: s.events, hooks })
}

function golden(name, view) {
  const f = join(FIX, name, 'expected.json')
  const got = JSON.stringify(view, null, 2) + '\n'
  if (process.env.UPDATE_GOLDEN || !existsSync(f)) writeFileSync(f, got)
  assert.equal(got, readFileSync(f, 'utf8'), `golden ${name} changed (review, then UPDATE_GOLDEN=1)`)
}

test('golden: live headless session (allowed skill + denied skill)', () => {
  const v = loadFixture('live-skill-deny')
  assert.equal(v.interactive, false)
  assert.equal(v.requests.length, 1)
  const r = v.requests[0]
  assert.deepEqual(r.models, ['claude-opus-5-5'])
  assert.deepEqual(r.efforts, ['medium'])
  assert.equal(r.reason, 'answer')
  assert.ok(r.usage.out > 0)
  assert.deepEqual(r.skills.map((s) => [s.skill, s.state]), [
    ['andrej-karpathy-skills:karpathy-guidelines', 'completed'],
    ['caveman:lean-build', 'denied'],
  ])
  assert.equal(v.capabilities.superpowers.state, 'observed')
  assert.equal(v.capabilities.ponytail.state, 'observed')
  assert.equal(v.capabilities.claudeMem.state, 'observed')
  assert.equal(v.capabilities.caveman.state, 'not-applicable', 'Caveman injects only in interactive sessions')
  assert.equal(v.capabilities.karpathy.state, 'activated', 'model-invoked skill; evidence is skill.prompt')
  assert.equal(v.capabilities.router.state, 'disabled')
  assert.deepEqual(v.failures, [], 'a denied skill is policy, not a failure')
  golden('live-skill-deny', v)
})

test('golden: synthetic mixed session (subagent, router, failures, reload)', () => {
  const v = loadFixture('synthetic-mixed')
  assert.equal(v.requests.length, 4, 'requests span two runs (reload) of one session')
  const [r1, r2, r3, r4] = v.requests
  assert.deepEqual(r1.routing.verdict, 'match')
  assert.deepEqual(r1.skills.map((s) => [s.skill, s.state]), [['superpowers:systematic-debugging', 'completed'], ['superpowers:test-driven-development', 'failed']])
  assert.equal(r1.subagents.length, 1)
  assert.deepEqual([r1.subagents[0].type, r1.subagents[0].steps[0].model], ['Explore', 'claude-haiku-5-5'])
  assert.deepEqual([r2.routing.verdict, r2.routing.selected, r2.routing.used, r2.reason], ['mismatch', 'claude-haiku-5-5', 'claude-opus-5-5', 'aborted'])
  assert.deepEqual([r3.routing.verdict, r3.routing.error, r3.routing.used], ['fallback', 'auth', 'claude-opus-5-5'])
  assert.equal(r4.routing, null)
  assert.deepEqual(Object.fromEntries(Object.entries(v.capabilities).map(([k, c]) => [k, c.state])), {
    superpowers: 'observed', caveman: 'observed', claudeMem: 'failed', ponytail: 'unverified', karpathy: 'not-activated', router: 'failed',
  })
  assert.ok(v.capabilities.claudeMem.evidence.some((e) => /best-effort/.test(e)))
  assert.deepEqual(v.failures.map((f) => [f.capability, f.source]), [
    ['claudeMem', 'transcript (best-effort)'], ['superpowers', 'event'], [null, 'event'],
  ])
  assert.deepEqual(v.totals, { requests: 4, steps: 6, in: 1011, out: 206, cacheRead: 5000, cacheWrite: 300, skills: 2 })
  assert.equal(summarize(v).failures, 3)
  assert.equal(v.endReason, 'prompt_input_exit')
  golden('synthetic-mixed', v)
})
