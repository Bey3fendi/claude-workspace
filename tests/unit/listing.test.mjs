import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deniedSkills, trimListing } from '../../plugins/workspace-core/lib/listing.mjs'
import { CONTRACTS } from '../../plugins/workspace-core/lib/contracts.mjs'
import { ROOT } from '../helpers.mjs'

const listing = [
  '- superpowers:systematic-debugging: Use when encountering any bug',
  '- caveman:lean-build: Build feature work with high overbuilding risk',
  '- claude-api: Reference for the Claude API',
  'TRIGGER — read BEFORE opening the target file',
  'SKIP only when another provider is being worked on',
  '- claude-mem:build: Build things',
  '  continued description line',
  '- claude-mem:mem-search: Search memory',
  '- anthropic-skills:pdf',
].join('\n')

test('denied entries are removed whole (with continuation lines); others are untouched', () => {
  const d = deniedSkills({ deny: ['Skill(skill:caveman:lean-build)', 'Skill(claude-mem:build)', 'Bash(rm -rf:*)'] })
  const t = trimListing(listing, d)
  assert.deepEqual(t.removed, ['caveman:lean-build', 'claude-mem:build'])
  assert.equal(t.text, [
    '- superpowers:systematic-debugging: Use when encountering any bug',
    '- claude-api: Reference for the Claude API',
    'TRIGGER — read BEFORE opening the target file',
    'SKIP only when another provider is being worked on',
    '- claude-mem:mem-search: Search memory',
    '- anthropic-skills:pdf',
  ].join('\n'))
  assert.equal(t.after, t.text.length)
  assert.ok(t.after < t.before)
})

test('prefix wildcards; no rules or no permissions leave the listing unchanged', () => {
  const t = trimListing(listing, deniedSkills({ deny: ['Skill(skill:claude-mem:*)'] }))
  assert.deepEqual(t.removed, ['claude-mem:build', 'claude-mem:mem-search'])
  assert.equal(trimListing(listing, deniedSkills(undefined)).text, listing)
  assert.equal(trimListing(listing, deniedSkills({ deny: [] })).removed.length, 0)
})

test('with the workspace policy, every contract skill stays listed', () => {
  const policy = JSON.parse(readFileSync(join(ROOT, 'policies', 'skill-denies.json'), 'utf8'))
  const wanted = [...new Set(Object.values(CONTRACTS).flatMap((c) => [...c.skills, ...c.then]))]
  const fake = wanted.map((s) => `- ${s}: x`).join('\n') + '\n' + policy.rules.map((r) => `- ${r.slice(12, -1)}: y`).join('\n')
  const t = trimListing(fake, deniedSkills({ deny: policy.rules }))
  assert.equal(t.removed.length, policy.rules.length)
  for (const s of wanted) assert.ok(t.text.includes(`- ${s}: x`), s)
})
