import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EXECUTION_NOTE, executionNote } from '../../plugins/workspace-core/lib/execution.mjs'

const policy = JSON.parse(readFileSync(new URL('../../policies/skill-denies.json', import.meta.url), 'utf8'))

test('subagent-driven-development is denied, executing-plans and the final review are not', () => {
  assert.ok(policy.rules.includes('Skill(skill:superpowers:subagent-driven-development)'))
  for (const s of ['executing-plans', 'requesting-code-review', 'writing-plans'])
    assert.ok(!policy.rules.includes(`Skill(skill:superpowers:${s})`), s)
})

test('the note names the method the deny leaves open, and stays short', () => {
  assert.match(EXECUTION_NOTE, /superpowers:executing-plans/)
  assert.match(EXECUTION_NOTE, /superpowers:requesting-code-review/)
  assert.match(EXECUTION_NOTE, /already chosen/) // writing-plans: a supplied method is used without asking
  assert.ok(EXECUTION_NOTE.length < 700, String(EXECUTION_NOTE.length))
})

test('switch and subagents', () => {
  assert.equal(executionNote(), EXECUTION_NOTE)
  assert.equal(executionNote({ disabled: true }), null)
  assert.equal(executionNote({ agent: true }), null)
})
