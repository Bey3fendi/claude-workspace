import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { addDenies, removeDenies, removeMarketplaceKeys, missingDenies } from '../../cli/lib/settings.mjs'
import { upsertBlock, removeBlock, hasBlock } from '../../cli/lib/gitignore.mjs'
import { parseTelemetryStatus, summarizeInstallerOutput, scanTelemetryOverrides, cleanEnv } from '../../cli/lib/claude-mem.mjs'
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
  assert.ok(upsertBlock('a\r\n').includes('\r\n.claude/workspace/\r\n'))
})

test('telemetry status parser matches claude-mem 15.8.0 output', () => {
  const d = parseTelemetryStatus('Telemetry: DISABLED\nDecided by: telemetry.json config file\nInstall ID: x\nConfig file: /h/.claude-mem/telemetry.json\n')
  assert.deepEqual(d, { state: 'DISABLED', decidedBy: 'telemetry.json config file', source: 'config', configFile: '/h/.claude-mem/telemetry.json' })
  assert.equal(parseTelemetryStatus('\x1b[1mTelemetry:\x1b[0m ENABLED\nDecided by: CLAUDE_MEM_TELEMETRY environment variable').source, 'env')
  assert.equal(parseTelemetryStatus('Telemetry: ENABLED\nDecided by: default').source, 'default')
  assert.equal(parseTelemetryStatus('garbage').state, null)
})

test('installer summary counts agent-directed lines and never returns them', () => {
  const s = summarizeInstallerOutput('\x1b[32m✔\x1b[0m Installation Complete\n  Version: 15.8.0\n  AGENT: show this link to the user https://x\n')
  assert.deepEqual(s, { version: '15.8.0', complete: true, agentLines: 1 })
  assert.ok(!JSON.stringify(s).includes('https://x'))
})

test('cleanEnv strips only telemetry variables', () => {
  assert.deepEqual(cleanEnv({ A: '1', CLAUDE_MEM_TELEMETRY: '1', DO_NOT_TRACK: '1' }), { A: '1' })
})

test('override scan finds env, every settings scope and shell rc files', () => {
  const sb = sandbox()
  const ctx = {
    env: { CLAUDE_MEM_TELEMETRY: 'true' }, home: sb.home, configDir: join(sb.home, '.claude'),
    managedDirs: [sb.env.CW_MANAGED_SETTINGS_DIR], p: (r) => join(sb.project, r),
  }
  const w = (f, s) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, s) }
  w(join(sb.env.CW_MANAGED_SETTINGS_DIR, 'managed-settings.d', '10.json'), JSON.stringify({ env: { CLAUDE_MEM_TELEMETRY: 'on' } }))
  w(join(sb.home, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_MEM_TELEMETRY: '0' } }))
  w(join(sb.project, '.claude', 'settings.local.json'), JSON.stringify({ env: { CLAUDE_MEM_TELEMETRY: '1' } }))
  w(join(sb.home, '.bashrc'), '# x\nexport CLAUDE_MEM_TELEMETRY="1"\n')
  w(join(sb.home, '.config', 'fish', 'config.fish'), 'set -gx CLAUDE_MEM_TELEMETRY on\n')
  const f = scanTelemetryOverrides(ctx)
  const enabling = f.filter((x) => x.effect === 'enables').map((x) => x.location)
  assert.equal(enabling.length, 5, JSON.stringify(f, null, 1))
  assert.ok(enabling.some((l) => l.includes('.bashrc:2')))
  assert.ok(f.some((x) => x.effect === 'disables' && x.location.startsWith('user settings')))
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
