import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classify, contractText, CONTRACTS } from '../../plugins/workspace-core/lib/contracts.mjs'
import { ROOT } from '../helpers.mjs'

const suite = JSON.parse(readFileSync(join(ROOT, 'tests', 'live', 'activation', 'suite.json'), 'utf8'))

test('classifier labels every activation-suite prompt with its class', () => {
  const wrong = suite.prompts.map((p) => [p.id, p.class, classify(p.prompt).class]).filter(([, want, got]) => want !== got)
  assert.deepEqual(wrong, [])
})

test('classifier on held-out phrasings (not in the suite)', () => {
  const cases = [
    ['The game crashes when two rows clear at once', 'debug'],
    ['Why is the score wrong after a combo?', 'debug'],
    ['Add a hold-piece feature to the game', 'feature'],
    ['Implement a pause menu', 'feature'],
    ['Add a function nextPiece() to src/board.c with tests', 'tests'],
    ['Build the scoring module test-first', 'tests'],
    ['Please write unit tests for the collision code', 'tests'],
    ['Can you review my changes in src/board.c?', 'review'],
    ['How should we structure the rendering layer so it can be swapped later?', 'architecture'],
    ['Let us continue where we left off yesterday', 'continue'],
    ['Which file defines the brick shapes?', 'trivial'],
    ['What does CMakeLists.txt build?', 'trivial'],
  ]
  for (const [text, want] of cases) assert.equal(classify(text).class, want, text)
})

test('no contract for commands, short follow-ups or unmatched text', () => {
  assert.equal(classify('/help').class, null)
  assert.equal(classify('fix it').class, null)
  assert.equal(classify('thanks, looks good to me').class, null)
  assert.equal(contractText('trivial'), null)
  assert.equal(contractText(null), null)
})

test('contracts are short, name full skill ids and allow an honest opt-out', () => {
  for (const cls of Object.keys(CONTRACTS)) {
    const t = contractText(cls)
    assert.ok(t.length / 4 <= 110, `${cls}: ${t.length} chars`)
    for (const s of CONTRACTS[cls].skills) assert.match(s, /^[a-z0-9-]+:[a-z0-9-]+$/)
    assert.match(t, /heuristic/)
  }
})

test('review is outcome-only (no skill fits); tests pick TDD vs verification by request type', () => {
  const r = contractText('review')
  assert.doesNotMatch(r, /Skill tool/)
  assert.match(r, /file:line/)
  const t = contractText('tests')
  assert.match(t, /test-driven-development for new or changed behaviour/)
  assert.match(t, /verification-before-completion for coverage of existing code/)
})

test('no skill a contract asks for is denied by the workspace policy', () => {
  const denied = JSON.parse(readFileSync(join(ROOT, 'policies', 'skill-denies.json'), 'utf8')).rules.map((r) => r.match(/^Skill\(skill:(.+)\)$/)?.[1])
  const wanted = Object.values(CONTRACTS).flatMap((c) => [...c.skills, ...c.then])
  assert.deepEqual(wanted.filter((s) => denied.includes(s)), [])
  assert.ok(denied.every(Boolean), 'every rule is a Skill(skill:…) rule')
})

test('restoreText: re-attaches the contract after compaction, without re-asking what is done', async () => {
  const { restoreText } = await import('../../plugins/workspace-core/lib/contracts.mjs')
  assert.equal(restoreText('trivial'), null)
  assert.equal(restoreText(null), null)
  const fresh = restoreText('debug')
  assert.match(fresh, /^\[workspace contract: debug, restored after compaction\]/)
  assert.match(fresh, /If not yet done, invoke the Skill tool with superpowers:systematic-debugging/)
  assert.match(fresh, /root cause \(file:line and why\)/)
  const done = restoreText('debug', { invoked: ['superpowers:systematic-debugging'], rootCauseStated: true })
  assert.match(done, /already invoked superpowers:systematic-debugging/)
  assert.doesNotMatch(done, /If not yet done/)
  assert.match(done, /root cause already stated/)
  assert.doesNotMatch(done, /make the minimal fix/, 'must not push past a user who said "do not edit yet"')
  assert.match(done, /user's own instructions take precedence/)
  assert.match(restoreText('tests'), /test-driven-development for new or changed behaviour/)
  assert.doesNotMatch(restoreText('review'), /Skill tool/)
  for (const c of ['debug', 'feature', 'architecture', 'review', 'tests', 'continue']) assert.ok(restoreText(c).length < 500, c)
})
