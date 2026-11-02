import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeProbe, listingFromTranscript, wilson, diffCI, scoreRun, aggregate } from '../live/activation/lib.mjs'

const rows = [
  { ev: 'session.start', sid: 'S' },
  { ev: 'turn.step', sid: 'S', model: 'claude-opus-5-5', effort: 'medium', agentId: null },
  { ev: 'skill.prompt', sid: 'S', skill: 'superpowers:systematic-debugging', agentId: null },
  { ev: 'skill.call', sid: 'S', skill: 'superpowers:systematic-debugging', isError: false, denied: false },
  { ev: 'skill.call', sid: 'S', skill: 'caveman:lean-build', isError: true, denied: false },
  { ev: 'turn.step', sid: 'S', model: 'claude-haiku-5-5', effort: 'low', agentId: 'A' },
  { ev: 'turn.complete', sid: 'S', agentId: 'A', reason: 'answer', usage: { in: 1, out: 2, cacheRead: 3, cacheWrite: 4 } },
  { ev: 'turn.complete', sid: 'S', agentId: null, reason: 'answer', usage: { in: 10, out: 20, cacheRead: 30, cacheWrite: 40 } },
]

test('probe analysis: activations, denials, main-loop models, summed usage', () => {
  const r = analyzeProbe(rows)
  assert.deepEqual(r.activated, ['superpowers:systematic-debugging'])
  assert.deepEqual(r.denied, ['caveman:lean-build'])
  assert.deepEqual(r.models, ['claude-opus-5-5'], 'subagent steps are not the main model')
  assert.deepEqual(r.usage, { in: 11, out: 22, cacheRead: 33, cacheWrite: 44 })
  assert.equal(r.reason, 'answer')
})

test('listing parse counts name-only entries (dropped descriptions)', () => {
  const content = '- a:x: does x\n- b:y\n- z: plain'
  const line = JSON.stringify({ attachment: { type: 'skill_listing', content, skillCount: 3 } })
  assert.deepEqual(listingFromTranscript(`{"x":1}\n${line}\n`), { skillCount: 3, chars: content.length, withDescription: 2, nameOnly: ['b:y'] })
  assert.equal(listingFromTranscript('{}'), null)
})

test('Wilson and Newcombe intervals', () => {
  const w = wilson(8, 10)
  assert.equal(w.p, 0.8)
  assert.ok(Math.abs(w.lo - 0.4902) < 0.001 && Math.abs(w.hi - 0.9433) < 0.001)
  assert.deepEqual(wilson(0, 0), { p: null, lo: null, hi: null })
  const d = diffCI(5, 10, 5, 10)
  assert.equal(d.d, 0)
  assert.ok(d.lo < 0 && d.hi > 0)
})

test('scoring: expected-any hit; trivial counts process-skill over-activation', () => {
  const run = { activated: ['superpowers:brainstorming'] }
  assert.equal(scoreRun(run, { expectAny: ['superpowers:brainstorming'] }).hit, true)
  assert.equal(scoreRun(run, { expectAny: ['superpowers:writing-plans'] }).hit, false)
  assert.deepEqual(scoreRun(run, { expectAny: [] }), { hit: false, overActivation: ['superpowers:brainstorming'] })
  assert.equal(scoreRun({ activated: ['andrej-karpathy-skills:karpathy-guidelines'] }, { expectAny: [] }).hit, true)
})

test('aggregate compares conditions and flags mandatory listing drops', () => {
  const suite = { classes: { debug: { expectAny: ['superpowers:systematic-debugging'] }, trivial: { expectAny: [] } } }
  const mk = (condition, cls, activated, nameOnly = []) => ({
    condition, class: cls, promptId: cls, ok: true,
    run: { activated, denied: [], models: ['m'], steps: 1, usage: { in: 1, out: 1, cacheRead: 100, cacheWrite: 0 } },
    listing: { skillCount: 9, chars: 1000, withDescription: 9 - nameOnly.length, nameOnly },
  })
  const rep = aggregate([
    mk('before', 'debug', ['superpowers:systematic-debugging']), mk('before', 'debug', []), mk('before', 'trivial', []),
    mk('with', 'debug', ['superpowers:systematic-debugging']), mk('with', 'debug', ['superpowers:systematic-debugging'], ['claude-mem:mem-search']),
  ], suite)
  assert.equal(rep.conditions.before.byClass.debug.hits, 1)
  assert.equal(rep.conditions.with.overall.hits, 2)
  assert.equal(rep.comparison.activationDiff.d, 0.5)
  assert.deepEqual(rep.listing.with.mandatoryNameOnly, ['claude-mem:mem-search'])
  assert.equal(rep.comparison.contextPerStepDelta, 0)
})

test('unscored classes never count as hits or misses', () => {
  const suite = { classes: { review: { expectAny: [], unscored: true }, debug: { expectAny: ['superpowers:systematic-debugging'] } } }
  const mk = (cls, activated) => ({ condition: 'with', class: cls, promptId: cls, ok: true, run: { activated, denied: [], models: ['m'], steps: 1, usage: { in: 1, out: 1, cacheRead: 1, cacheWrite: 0 } }, listing: null })
  const rep = aggregate([mk('review', []), mk('debug', ['superpowers:systematic-debugging'])], suite)
  assert.deepEqual(rep.conditions.with.overall, { n: 1, hits: 1, rate: rep.conditions.with.overall.rate })
  assert.equal(scoreRun({ activated: ['superpowers:brainstorming'] }, suite.classes.review).unscored, true)
})

test('usage guard reads the latest rate-limit utilization and trips at the threshold', async () => {
  const { usageFrom, overLimit } = await import('../live/usage-guard.mjs')
  const ev = (f, s) => JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: f }, seven_day: { utilization: s } } } })
  const out = [ev(0.2, 0.27), '{"type":"assistant"}', ev(0.61, 0.3), '{"type":"result"}'].join('\n')
  assert.deepEqual(usageFrom(out), { five_hour: 0.61, seven_day: 0.3 })
  assert.match(overLimit(usageFrom(out), 0.6), /five_hour usage 61% ≥ 60%/)
  assert.equal(overLimit({ five_hour: 0.59, seven_day: 0.3 }, 0.6), null)
  assert.equal(usageFrom('no events'), null)
})
