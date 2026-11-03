import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { sandbox, cli, tree, git, write, read, calls, ROOT } from '../helpers.mjs'

const POLICY_RULES = JSON.parse(readFileSync(join(ROOT, 'policies', 'skill-denies.json'), 'utf8')).rules.length

const LOCK = JSON.parse(readFileSync(new URL('../../workspace.lock.json', import.meta.url), 'utf8'))
const regOf = (sb) => JSON.parse(read(join(sb.home, '.claude', 'plugins', 'installed_plugins.json'))).plugins

function existingRepo() {
  const sb = sandbox()
  const P = sb.project
  write(join(P, 'CLAUDE.md'), '# Project rules\nKeep it simple.\n')
  write(join(P, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', permissions: { deny: ['Bash(rm -rf:*)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }, null, 4) + '\n')
  write(join(P, '.gitignore'), 'node_modules\ndist')
  write(join(P, 'src', 'index.js'), 'console.log(1)\n')
  git(P, 'init', '-q'); git(P, 'add', '-A')
  const c = git(P, 'commit', '-qm', 'init')
  assert.equal(c.status, 0, `fixture commit failed: ${c.stderr}`)
  return sb
}

test('empty project: install, idempotent re-run, doctor, clean uninstall', () => {
  const sb = sandbox()
  const r1 = cli(sb, ['install', '--yes'])
  assert.equal(r1.code, 0, r1.stdout + r1.stderr)
  assert.ok(r1.json.changes.length > 0)
  assert.ok(!/AGENT:|example\.invalid/.test(r1.stdout + r1.stderr), 'upstream agent-directed text must never be relayed')

  // pins recorded by Claude Code's registry equal the lock
  const reg = regOf(sb)
  for (const p of LOCK.plugins.filter((p) => p.enabled && typeof p.source === 'object'))
    assert.equal(reg[`${p.name}@cw-workspace`][0].gitCommitSha, p.source.sha)
  assert.ok(!reg['router@cw-workspace'], 'optional router not installed')

  const s = JSON.parse(read(join(sb.project, '.claude', 'settings.json')))
  assert.equal(s.enabledPlugins['superpowers@cw-workspace'], true)
  assert.equal(s.permissions.deny.length, POLICY_RULES)
  assert.deepEqual(JSON.parse(read(join(sb.project, '.caveman.json'))), { defaultMode: 'lite' })
  assert.match(read(join(sb.project, '.gitignore')), /\.claude\/workspace\//)
  assert.equal(JSON.parse(read(join(sb.home, '.claude-mem', 'telemetry.json'))).enabled, false)

  const before = tree(sb.project)
  const r2 = cli(sb, ['install', '--yes'])
  assert.equal(r2.code, 0, r2.stdout)
  assert.deepEqual(r2.json.changes, [], 'second run makes zero changes')
  assert.deepEqual(tree(sb.project), before, 'second run leaves every file byte-identical')

  const d = cli(sb, ['doctor'])
  assert.equal(d.code, 0, d.stdout)
  assert.equal(d.json.checks.find((c) => c.id === 'claude-mem-telemetry').status, 'ok')

  const u = cli(sb, ['uninstall'])
  assert.equal(u.code, 0, u.stdout)
  assert.deepEqual(readdirSync(sb.project), [], 'project returns to empty')
  assert.ok(!Object.keys(regOf(sb)).some((k) => k.endsWith('@cw-workspace')), 'registry cleaned')
  assert.ok(regOf(sb)['claude-mem@thedotmack'], 'user-level claude-mem left in place by default')
})

test('existing repo: unrelated files untouched, uninstall restores byte-exactly', () => {
  const sb = existingRepo()
  const before = tree(sb.project, ['.git'])
  const r = cli(sb, ['install', '--yes'])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const mid = tree(sb.project, ['.git'])
  assert.equal(mid['CLAUDE.md'], before['CLAUDE.md'])
  assert.equal(mid['src/index.js'], before['src/index.js'])
  const s = JSON.parse(read(join(sb.project, '.claude', 'settings.json')))
  assert.equal(s.model, 'opus'); assert.ok(s.hooks.Stop); assert.equal(s.permissions.deny[0], 'Bash(rm -rf:*)')
  assert.equal(s.permissions.deny.length, 1 + POLICY_RULES)

  // second install in a git repo: our own uncommitted edits are not "dirty"
  const r2 = cli(sb, ['install', '--yes'])
  assert.equal(r2.code, 0, r2.stdout)
  assert.deepEqual(r2.json.changes, [])

  const u = cli(sb, ['uninstall'])
  assert.equal(u.code, 0, u.stdout)
  assert.deepEqual(tree(sb.project, ['.git']), before, 'byte-exact restore')
  assert.equal(git(sb.project, 'status', '--porcelain').stdout, '')
})

test('dirty tree: refuses by default; --allow-dirty keeps the dirty bytes recoverable', () => {
  const sb = existingRepo()
  const f = join(sb.project, '.claude', 'settings.json')
  writeFileSync(f, read(f).replace('"opus"', '"sonnet"'))
  const dirty = tree(sb.project, ['.git'])
  const r = cli(sb, ['install', '--yes'])
  assert.equal(r.code, 1)
  assert.match(r.json.error, /uncommitted changes/)
  assert.deepEqual(tree(sb.project, ['.git']), dirty, 'refusal changes nothing')

  assert.equal(cli(sb, ['install', '--yes', '--allow-dirty']).code, 0)
  assert.equal(cli(sb, ['uninstall']).code, 0)
  assert.deepEqual(tree(sb.project, ['.git']), dirty, 'uncommitted content restored byte-exactly')
})

test('file edited after install: uninstall removes only workspace keys', () => {
  const sb = existingRepo()
  assert.equal(cli(sb, ['install', '--yes']).code, 0)
  const f = join(sb.project, '.claude', 'settings.json')
  const s = JSON.parse(read(f)); s.permissions.allow = ['Read']; writeFileSync(f, JSON.stringify(s, null, 2) + '\n')
  const u = cli(sb, ['uninstall'])
  assert.equal(u.code, 0, u.stdout)
  const after = JSON.parse(read(f))
  assert.deepEqual(after.permissions, { deny: ['Bash(rm -rf:*)'], allow: ['Read'] })
  assert.equal(after.model, 'opus')
  assert.ok(!after.extraKnownMarketplaces?.['cw-workspace'])
  assert.ok(!Object.keys(after.enabledPlugins || {}).some((k) => k.endsWith('@cw-workspace')))
  assert.equal(read(join(sb.project, '.gitignore')), 'node_modules\ndist', 'unedited file restored byte-exactly')
  assert.ok(!existsSync(join(sb.project, '.caveman.json')))
  assert.ok(!existsSync(join(sb.project, '.claude', 'workspace')))
})

test('telemetry gate: install disables, doctor fails on any enabling override and names it', () => {
  const sb = sandbox()
  assert.equal(cli(sb, ['install', '--yes']).code, 0)

  // project settings env block
  write(join(sb.project, '.claude', 'settings.local.json'), JSON.stringify({ env: { CLAUDE_MEM_TELEMETRY: '1' } }))
  let d = cli(sb, ['doctor'])
  assert.equal(d.code, 1)
  assert.match(d.json.checks.find((c) => c.id === 'claude-mem-telemetry').message, /settings\.local\.json/)
  write(join(sb.project, '.claude', 'settings.local.json'), '{}')

  // process environment
  d = cli(sb, ['doctor'], { CLAUDE_MEM_TELEMETRY: 'true' })
  assert.equal(d.code, 1)
  assert.match(d.json.checks.find((c) => c.id === 'claude-mem-telemetry').message, /process environment/)

  // shell rc file
  write(join(sb.home, '.zshrc'), 'export CLAUDE_MEM_TELEMETRY=on\n')
  d = cli(sb, ['doctor'])
  assert.equal(d.code, 1)
  assert.match(d.json.checks.find((c) => c.id === 'claude-mem-telemetry').message, /\.zshrc:1/)
  write(join(sb.home, '.zshrc'), '')

  // re-enabled in claude-mem's config (e.g. by an update): doctor re-disables and passes
  write(join(sb.home, '.claude-mem', 'telemetry.json'), JSON.stringify({ enabled: true }))
  d = cli(sb, ['doctor'])
  assert.equal(d.code, 0, d.stdout)
  assert.ok(d.json.changes.some((c) => /telemetry disable/.test(c)))
  assert.equal(JSON.parse(read(join(sb.home, '.claude-mem', 'telemetry.json'))).enabled, false)

  // --no-fix verifies only
  write(join(sb.home, '.claude-mem', 'telemetry.json'), JSON.stringify({ enabled: true }))
  assert.equal(cli(sb, ['doctor', '--no-fix']).code, 1)

  // the official mechanism does not take effect -> doctor must fail
  d = cli(sb, ['doctor'], { FAKE_TELEMETRY_DISABLE_NOOP: '1' })
  assert.equal(d.code, 1)

  // never sets DO_NOT_TRACK anywhere
  const all = calls(sb)
  assert.ok(!/DO_NOT_TRACK/.test(all))
  for (const f of ['.bashrc', '.zshrc', '.profile', '.claude/settings.json'])
    if (existsSync(join(sb.home, f))) assert.ok(!/DO_NOT_TRACK/.test(read(join(sb.home, f))))
})

test('claude-mem needs consent; without it nothing user-level is installed', () => {
  const sb = sandbox()
  const r = cli(sb, ['install'])
  assert.equal(r.code, 0, r.stdout)
  assert.ok(r.json.warnings.some((w) => /consent required/.test(w)))
  assert.ok(!/npx .*install/.test(calls(sb)))
  assert.ok(!existsSync(join(sb.home, '.local', 'bin', 'claude-mem')))
})

test('installer failure is reported with a log path, output not relayed', () => {
  const sb = sandbox()
  const r = cli(sb, ['install', '--yes'], { FAKE_NPX_INSTALL_FAIL: '1' })
  assert.equal(r.code, 1)
  assert.match(r.json.error, /claude-mem installer failed .*claude-mem-install-\d+\.log/)
})

test('duplicate plugin at user scope blocks install', () => {
  const sb = sandbox()
  write(join(sb.home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'superpowers@claude-plugins-official': [{ scope: 'user', version: '6.0.0' }] } }))
  const r = cli(sb, ['install', '--yes'])
  assert.equal(r.code, 1)
  assert.match(r.json.error, /superpowers@claude-plugins-official \(user\)/)
  assert.deepEqual(readdirSync(sb.project), [], 'nothing written')
})

test('pin drift: doctor fails, repair reinstalls at the locked sha', () => {
  const sb = sandbox()
  assert.equal(cli(sb, ['install', '--yes']).code, 0)
  const f = join(sb.home, '.claude', 'plugins', 'installed_plugins.json')
  const reg = JSON.parse(read(f)); reg.plugins['caveman@cw-workspace'][0].gitCommitSha = 'f'.repeat(40); writeFileSync(f, JSON.stringify(reg))
  const d = cli(sb, ['doctor'])
  assert.equal(d.code, 1)
  assert.match(d.json.checks.find((c) => c.id === 'plugin caveman@cw-workspace').message, /pin mismatch/)
  const r = cli(sb, ['repair', '--yes'])
  assert.equal(r.code, 0, r.stdout)
  assert.equal(regOf(sb)['caveman@cw-workspace'][0].gitCommitSha, LOCK.plugins.find((p) => p.name === 'caveman').source.sha)
})

test('repair restores a missing claude-mem runtime and deleted project pieces', () => {
  const sb = sandbox()
  assert.equal(cli(sb, ['install', '--yes']).code, 0)
  rmSync(join(sb.home, '.local', 'bin', 'claude-mem'))
  rmSync(join(sb.project, '.caveman.json'))
  assert.equal(cli(sb, ['doctor']).code, 1)
  const r = cli(sb, ['repair', '--yes'])
  assert.equal(r.code, 0, r.stdout)
  assert.ok(existsSync(join(sb.home, '.local', 'bin', 'claude-mem')))
  assert.ok(existsSync(join(sb.project, '.caveman.json')))
})


test('update by re-pointing the marketplace records history, and rollback names the previous source', () => {
  const sb = sandbox()
  // A second marketplace source with the same catalog (stands in for another release tag).
  const B = join(sb.base, 'release-b')
  write(join(B, '.claude-plugin', 'marketplace.json'), read(join(ROOT, '.claude-plugin', 'marketplace.json')))
  assert.equal(cli(sb, ['install', '--yes', '--marketplace', ROOT]).code, 0)
  const r = cli(sb, ['repair', '--yes', '--marketplace', B])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const m = JSON.parse(read(join(sb.project, '.claude', 'workspace', 'manifest.json')))
  assert.equal(m.marketplace.source, B)
  assert.equal(m.history?.length, 1, 'the re-point must record the previous state')
  assert.equal(m.history[0].source, ROOT)
  assert.ok(m.history[0].plugins['superpowers@cw-workspace']?.sha, 'previous pins were captured before the marketplace was removed')
  const rb = cli(sb, ['rollback'])
  assert.equal(rb.code, 0, rb.stdout + rb.stderr)
  assert.ok(rb.stdout.includes(ROOT), rb.stdout)
})
