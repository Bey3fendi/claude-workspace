import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { addDenies, removeDenies, removeMarketplaceKeys, missingDenies } from '../../cli/lib/settings.mjs'
import { upsertBlock, removeBlock, hasBlock } from '../../cli/lib/gitignore.mjs'
import { cmpVersion } from '../../cli/lib/util.mjs'
import { render } from '../../scripts/gen-marketplace.mjs'
import { parseArgs } from '../../cli/bin/claude-workspace.mjs'
import { ROOT, sandbox } from '../helpers.mjs'

test('deny merge is additive, idempotent and reversible', () => {
  const base = { model: 'x', permissions: { deny: ['Bash(rm:*)'], allow: ['Read'] } }
  const rules = ['Skill(skill:a:b)', 'Bash(rm:*)']
  const { settings: s1, added } = addDenies(base, rules)
  assert.deepEqual(added, ['Skill(skill:a:b)'])
  assert.deepEqual(s1.permissions.deny, ['Bash(rm:*)', 'Skill(skill:a:b)'])
  assert.deepEqual(addDenies(s1, rules).added, [])
  assert.deepEqual(removeDenies(s1, added), base)
  assert.deepEqual(missingDenies(s1, rules), [])
  assert.deepEqual(removeDenies({ permissions: { deny: ['x'] } }, ['x']), {})
})

test('marketplace key removal only touches our marketplace', () => {
  const s = { enabledPlugins: { 'a@cw-workspace': true, 'b@other': true }, extraKnownMarketplaces: { 'cw-workspace': {}, other: {} } }
  assert.deepEqual(removeMarketplaceKeys(s, 'cw-workspace'), { enabledPlugins: { 'b@other': true }, extraKnownMarketplaces: { other: {} } })
})

test('gitignore block round-trips byte-exactly (LF, CRLF, no trailing newline, empty)', () => {
  for (const t of ['node_modules/\n', 'a\r\nb\r\n', 'dist', '']) {
    const u = upsertBlock(t)
    assert.ok(hasBlock(u))
    assert.equal(upsertBlock(u), u, 'idempotent')
    if (t.endsWith('\n') || t === '') assert.equal(removeBlock(u), t)
    else assert.equal(removeBlock(u), t + '\n')
  }
  assert.ok(upsertBlock('a\r\n').includes('\r\n.claude/workspace/*\r\n!.claude/workspace/CLAUDE.workspace.md\r\n'))
})

test('committed marketplace.json is generated from workspace.lock.json', () => {
  const lock = JSON.parse(readFileSync(join(ROOT, 'workspace.lock.json'), 'utf8'))
  assert.equal(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'), render(lock))
  for (const p of lock.plugins) {
    if (typeof p.source === 'string') { assert.ok(p.source.startsWith('./')); continue }
    assert.match(p.source.sha, /^[0-9a-f]{40}$/, `${p.name} pinned by full sha`)
    assert.match(p.source.url, /^https:\/\//, `${p.name} uses https (no SSH key needed)`)
  }
  assert.ok(!/^claude-|anthropic/i.test(lock.marketplace.name), 'reserved marketplace name prefix')
  assert.equal(lock.plugins.find((p) => p.name === 'router').enabled, false, 'router stays opt-in')
})

test('version compare and arg parsing', () => {
  assert.equal(cmpVersion('2.1.316', '2.1.290'), 1)
  assert.equal(cmpVersion('22.13.0', '22.13'), 0)
  assert.equal(cmpVersion('22.9.0', '22.13.0'), -1)
  assert.deepEqual(parseArgs(['install', '-y', '--no-claude-mem', '--project', '/p']), { _: ['install'], yes: true, claudeMem: false, project: '/p' })
  assert.throws(() => parseArgs(['--bogus']))
})
