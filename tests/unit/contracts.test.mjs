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
