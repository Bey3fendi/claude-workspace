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
  assert.equal(s.permissions.allow, undefined, 'the shared settings get no allow rules (Claude Code ignores them there)')
  assert.deepEqual(JSON.parse(read(join(sb.project, '.claude', 'settings.local.json'))), { permissions: { allow: ['Edit(.memory/**)'] } }, 'md-memory writes need no prompt')
  assert.deepEqual(JSON.parse(read(join(sb.project, '.caveman.json'))), { defaultMode: 'lite' })
  assert.match(read(join(sb.project, '.gitignore')), /\.claude\/workspace\//)
  for (const f of ['session.md', 'context.md', 'decisions.md']) assert.ok(existsSync(join(sb.project, '.memory', f)), f)
  assert.ok(!/npx/.test(calls(sb)), 'nothing user-level is installed: no claude-mem, no npx')
  assert.ok(!existsSync(join(sb.home, '.claude-mem')))

  const before = tree(sb.project)
  const r2 = cli(sb, ['install', '--yes'])
  assert.equal(r2.code, 0, r2.stdout)
  assert.deepEqual(r2.json.changes, [], 'second run makes zero changes')
  assert.deepEqual(tree(sb.project), before, 'second run leaves every file byte-identical')

  const d = cli(sb, ['doctor'])
  assert.equal(d.code, 0, d.stdout)
  assert.equal(d.json.checks.find((c) => c.id === 'memory').status, 'ok')
  assert.equal(d.json.checks.find((c) => c.id === 'claude-mem').status, 'ok')

  const u = cli(sb, ['uninstall'])
  assert.equal(u.code, 0, u.stdout)
  assert.deepEqual(readdirSync(sb.project), [], 'project returns to empty (unused memory templates removed)')
  assert.ok(!Object.keys(regOf(sb)).some((k) => k.endsWith('@cw-workspace')), 'registry cleaned')
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

// A user who still has claude-mem installed (any project before 0.8.0): it is disabled per project, reported,
// and removed for good only through `remove-claude-mem`, after confirmation.
function withClaudeMem(sb) {
  write(join(sb.home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'claude-mem@thedotmack': [{ scope: 'user', version: '15.9.0', installPath: '/fake/cm' }] } }))
}

test('claude-mem leftover: disabled in the project, doctor warns, uninstall undoes only that key', () => {
  const sb = sandbox()
  withClaudeMem(sb)
  const r = cli(sb, ['install'])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(r.json.changes.some((c) => /disabled claude-mem@thedotmack in this project/.test(c)))
  const s = JSON.parse(read(join(sb.project, '.claude', 'settings.json')))
  assert.equal(s.enabledPlugins['claude-mem@thedotmack'], false)
  assert.ok(!/npx/.test(calls(sb)), 'install never runs claude-mem itself')
  const d = cli(sb, ['doctor'])
  assert.equal(d.code, 0, d.stdout)
  const cm = d.json.checks.find((c) => c.id === 'claude-mem')
  assert.equal(cm.status, 'warn'); assert.match(cm.message, /remove-claude-mem/)
  // re-enabled by hand in this project: two memory systems -> doctor fails
  write(join(sb.project, '.claude', 'settings.json'), JSON.stringify({ ...s, enabledPlugins: { ...s.enabledPlugins, 'claude-mem@thedotmack': true } }))
  assert.equal(cli(sb, ['doctor']).code, 1)
  write(join(sb.project, '.claude', 'settings.json'), JSON.stringify({ ...s, model: 'opus' }))
  const u = cli(sb, ['uninstall'])
  assert.equal(u.code, 0, u.stdout)
  const after = JSON.parse(read(join(sb.project, '.claude', 'settings.json')))
  assert.equal(after.model, 'opus', 'the user edit is kept')
  assert.equal(after.enabledPlugins?.['claude-mem@thedotmack'], undefined, 'our disable is undone')
  assert.ok(!after.permissions, 'workspace deny and allow rules removed')
  assert.ok(regOf(sb)['claude-mem@thedotmack'], 'user-level claude-mem is never removed by install/uninstall')
})

test('remove-claude-mem asks first; with consent it runs claude-mem\'s own uninstaller', () => {
  const sb = sandbox()
  withClaudeMem(sb)
  const no = cli(sb, ['remove-claude-mem'])
  assert.equal(no.code, 0, no.stdout)
  assert.ok(no.json.warnings.some((w) => /confirmation required/.test(w)))
  assert.ok(!/npx/.test(calls(sb)))
  const yes = cli(sb, ['remove-claude-mem', '--yes'])
  assert.equal(yes.code, 0, yes.stdout + yes.stderr)
  assert.match(calls(sb), /npx -y claude-mem@15\.9\.0 uninstall/)
  assert.ok(!regOf(sb)['claude-mem@thedotmack'])
  assert.ok(yes.json.changes.some((c) => /~\/\.claude-mem kept/.test(c)))
  const again = cli(sb, ['remove-claude-mem', '--yes'])
  assert.equal(again.code, 0); assert.ok(!/uninstall[\s\S]*uninstall/.test(calls(sb)), 'nothing to do the second time')
})

test('memory files: existing ones are never overwritten; notes survive uninstall; old deny rules are cleaned up', () => {
  const sb = sandbox()
  const mine = '# Session log\n\n## 2026-11-01 10:00 · my notes\n- Goal: keep\n'
  write(join(sb.project, '.memory', 'session.md'), mine)
  assert.equal(cli(sb, ['install']).code, 0)
  assert.equal(read(join(sb.project, '.memory', 'session.md')), mine, 'existing session.md untouched')
  // a context note written after install
  write(join(sb.project, '.memory', 'context.md'), '# Context\n\n## Cart\n<!-- paths: src/** -->\n- cents\n')
  // simulate a pre-0.8.0 install that added a claude-mem deny rule
  const mf = join(sb.project, '.claude', 'workspace', 'manifest.json')
  const m = JSON.parse(read(mf)); m.addedDenies.push('Skill(skill:claude-mem:babysit)'); writeFileSync(mf, JSON.stringify(m))
  const sf = join(sb.project, '.claude', 'settings.json')
  const s = JSON.parse(read(sf)); s.permissions.deny.push('Skill(skill:claude-mem:babysit)'); writeFileSync(sf, JSON.stringify(s))
  const r = cli(sb, ['repair'])
  assert.equal(r.code, 0, r.stdout)
  assert.ok(!JSON.parse(read(sf)).permissions.deny.includes('Skill(skill:claude-mem:babysit)'), 'stale workspace rule removed')
  assert.equal(JSON.parse(read(sf)).permissions.deny.length, POLICY_RULES)
  const u = cli(sb, ['uninstall'])
  assert.equal(u.code, 0, u.stdout)
  assert.equal(read(join(sb.project, '.memory', 'session.md')), mine, 'the user\'s own session.md stays')
  assert.match(read(join(sb.project, '.memory', 'context.md')), /## Cart/, 'notes written after install stay')
  assert.ok(!existsSync(join(sb.project, '.memory', 'decisions.md')), 'unused template removed')
  assert.ok(u.json.infos?.some?.((i) => /kept .*context\.md/.test(i)) ?? true)
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

test('repair restores deleted memory files and project pieces', () => {
  const sb = sandbox()
  assert.equal(cli(sb, ['install']).code, 0)
  rmSync(join(sb.project, '.memory', 'session.md'))
  rmSync(join(sb.project, '.caveman.json'))
  const d = cli(sb, ['doctor'])
  assert.equal(d.code, 1)
  assert.match(d.json.checks.find((c) => c.id === 'memory').message, /session\.md/)
  const r = cli(sb, ['repair'])
  assert.equal(r.code, 0, r.stdout)
  assert.ok(existsSync(join(sb.project, '.memory', 'session.md')))
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
