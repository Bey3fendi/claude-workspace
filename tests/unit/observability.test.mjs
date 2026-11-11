import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { redact, redactDeep, projectKey, markerCounts } from '../../plugins/workspace-core/lib/events.mjs'
import { createSink, flush } from '../../plugins/workspace-core/lib/sink.mjs'
import { createReader } from '../../observability/reader.mjs'
import { usageForSession, renderUsage } from '../../observability/derive.mjs'
import { parseUsageSection, createTracker, USAGE_INSTRUCTION } from '../../plugins/workspace-core/lib/usage.mjs'
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

test('project keys are stable and filesystem-safe', () => {
  assert.equal(projectKey('/home/u/my proj'), projectKey('/home/u/my proj'))
  assert.notEqual(projectKey('/a/app'), projectKey('/b/app'))
  assert.match(projectKey('/home/u/my proj'), /^my_proj-[0-9a-f]{10}$/)
})

test('marker counts', () => {
  assert.deepEqual(markerCounts('You have superpowers. # claude-mem status'), { superpowers: 1, claudeMem: 1 })
  assert.deepEqual(markerCounts([{ type: 'text', text: 'PONYTAIL MODE ACTIVE' }]), { ponytail: 1 })
  assert.deepEqual(markerCounts(null), {})
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


// ---------------------------------------------------------------- Workspace Usage evidence

test('usage instruction stays short (token budget ≤ 120, ~4 chars/token)', () => {
  assert.ok(USAGE_INSTRUCTION.length / 4 <= 120, `${USAGE_INSTRUCTION.length} chars`)
})

test('parse: only the Applied line yields claims; bare names map to full ids', () => {
  const a = 'Fixed it.\n\n## Workspace Usage\n- Applied: superpowers:systematic-debugging (root cause first); karpathy-guidelines (minimal diff)\n- Active: Caveman (lite)\n- Not used: test-driven-development (no new code)\n'
  assert.deepEqual(parseUsageSection(a), { present: true, applied: ['superpowers:systematic-debugging'] }, 'karpathy-guidelines is no longer a skill (0.10.0: CLAUDE.md)')
  assert.deepEqual(parseUsageSection('**Workspace Usage**\n- **Applied:** brainstorming'), { present: true, applied: ['superpowers:brainstorming'] })
  assert.deepEqual(parseUsageSection('just an answer'), { present: false, applied: [] })
  assert.deepEqual(parseUsageSection(undefined), { present: false, applied: [] })
})

test('footer: claims are cross-checked; denied/failed are never "activated"', () => {
  const t = createTracker()
  t.injection({ caveman: 2 })
  t.turnStart()
  t.skillPrompt('superpowers:systematic-debugging')
  t.skillCall('caveman:lean-build', { isError: true, errorText: 'Permission to use Skill has been denied' })
  t.skillPrompt('superpowers:test-driven-development'); t.skillFailed('superpowers:test-driven-development')
  const r = t.finish('ok\n### Workspace Usage\n- Applied: superpowers:systematic-debugging, superpowers:writing-plans, caveman:lean-build')
  assert.deepEqual(r.activated, ['superpowers:systematic-debugging'])
  assert.deepEqual(r.denied, ['caveman:lean-build'])
  assert.deepEqual(r.failed, ['superpowers:test-driven-development'])
  assert.deepEqual(r.claimedNotObserved, ['superpowers:writing-plans', 'caveman:lean-build'])
  assert.match(r.footer, /^Verified by engine: activated superpowers:systematic-debugging · denied caveman:lean-build · failed superpowers:test-driven-development · context injected this session: Caveman · self-reported only \(no engine event\): superpowers:writing-plans, caveman:lean-build/)
  assert.match(r.footer, /not proof they were followed/)
  // next request starts clean; a trivial answer with no events and no section gets no footer
  t.turnStart()
  assert.equal(t.finish('2 + 2 = 4').footer, null)
  // section present, nothing invoked, nothing claimed: honest "none observed"
  t.turnStart()
  assert.match(t.finish('done\nWorkspace Usage\n- Not used: brainstorming').footer, /no skill activations observed · context injected this session: Caveman · report matches engine events/)
  // activation not mentioned in the report is flagged too
  t.turnStart(); t.skillPrompt('superpowers:brainstorming')
  assert.match(t.finish('x\nWorkspace Usage\n- Applied: none').footer, /activated but not reported: superpowers:brainstorming/)
})

// ---------------------------------------------------------------- golden replay of recorded sessions

function loadFixture(name) {
  const sessions = createReader(join(FIX, name, 'events')).sessions()
  assert.equal(sessions.size, 1)
  const s = [...sessions.values()][0]
  return usageForSession({ sid: s.sid, projectKey: s.projectKey, events: s.events })
}

function golden(name, view) {
  const f = join(FIX, name, 'expected.json')
  const got = JSON.stringify({ view, text: renderUsage(view).split('\n') }, null, 2) + '\n'
  if (process.env.UPDATE_GOLDEN || !existsSync(f)) writeFileSync(f, got)
  assert.equal(got, readFileSync(f, 'utf8'), `golden ${name} changed (review, then UPDATE_GOLDEN=1)`)
}

test('golden: live headless session (allowed skill + denied skill), no report section', () => {
  const v = loadFixture('live-skill-deny')
  assert.equal(v.interactive, false)
  assert.equal(v.requests.length, 1)
  const r = v.requests[0]
  assert.deepEqual(r.activated, ['andrej-karpathy-skills:karpathy-guidelines'])
  assert.deepEqual(r.denied, ['caveman:lean-build'], 'permission-denied Skill call is denied, not activated')
  assert.equal(r.reportPresent, false)
  assert.equal(r.footer, 'Verified by engine: activated karpathy:karpathy-guidelines · denied caveman:lean-build (activation = instructions loaded, not proof they were followed)')
  golden('live-skill-deny', v)
})

test('golden: synthetic session across a reload, with a partly false self-report', () => {
  const v = loadFixture('synthetic-mixed')
  assert.equal(v.requests.length, 4, 'requests span two runs (reload) of one session')
  const [r1, r2, r3, r4] = v.requests
  assert.deepEqual(r1.activated, ['superpowers:systematic-debugging'], 'subagent turns do not split the request')
  assert.deepEqual(r1.failed, ['superpowers:test-driven-development'])
  assert.deepEqual(r1.claimedNotObserved, ['andrej-karpathy-skills:karpathy-guidelines'])
  assert.deepEqual(r1.active, ['superpowers', 'caveman'])
  assert.match(r1.footer, /self-reported only \(no engine event\): karpathy:karpathy-guidelines/)
  assert.equal(r2.reason, 'aborted')
  for (const r of [r2, r3, r4]) assert.equal(r.footer, null)
  assert.deepEqual(v.usage, { in: 1111, out: 226, cacheRead: 5000, cacheWrite: 300 })
  assert.equal(v.endReason, 'prompt_input_exit')
  golden('synthetic-mixed', v)
})
