import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checksConfig, editCheckText, fillFile, outputTail, shouldStopCheck, stopBlockText } from '../../plugins/workspace-core/lib/checks.mjs'
import { renderFooter, summarize } from '../../plugins/workspace-core/lib/usage.mjs'
import { addTrust, isTrusted, normalizeRemote, removeTrust, trustLine } from '../../cli/lib/automode.mjs'

test('checksConfig: commands from the marker; anything else is no check', () => {
  assert.deepEqual(checksConfig(JSON.stringify({ checks: { stop: ' npm test ', edit: 'npx eslint {file}' } })), { stop: 'npm test', edit: 'npx eslint {file}' })
  assert.deepEqual(checksConfig({ checks: { stop: '', edit: 42 } }), { stop: null, edit: null })
  assert.deepEqual(checksConfig('not json'), { stop: null, edit: null })
  assert.deepEqual(checksConfig({ checks: { stop: 'x'.repeat(501) } }), { stop: null, edit: null })
})

test('fillFile quotes the path; a command without {file} runs as is', () => {
  assert.equal(fillFile('npx eslint {file}', 'src/a b.ts'), "npx eslint 'src/a b.ts'")
  assert.equal(fillFile('ruff check {file} && mypy {file}', "it's.py"), "ruff check 'it'\\''s.py' && mypy 'it'\\''s.py'")
  assert.equal(fillFile('npm run lint', 'src/a.ts'), 'npm run lint')
})

test('outputTail: last lines, colours removed, capped', () => {
  const out = Array.from({ length: 100 }, (_, i) => `\x1b[31mline ${i}\x1b[0m`).join('\n')
  const t = outputTail(out, 'boom', 5)
  assert.equal(t, 'line 96\nline 97\nline 98\nline 99\nboom')
  assert.ok(outputTail('x'.repeat(10_000), '', 40, 100).length <= 101)
})

test('shouldStopCheck: an unchecked code edit with no passing check after it, at most twice', () => {
  const at = 1000
  const passed = [{ cmd: 'npm test', exit: 0, at: 2000 }], failed = [{ cmd: 'npm test', exit: 1, at: 2000 }]
  assert.equal(shouldStopCheck({ cmd: 'npm test', codeEditAt: at, commands: [] }), true)
  assert.equal(shouldStopCheck({ cmd: 'npm test', codeEditAt: at, commands: passed }), false, 'Claude already ran a passing test')
  assert.equal(shouldStopCheck({ cmd: 'npm test', codeEditAt: at, commands: failed }), true)
  assert.equal(shouldStopCheck({ cmd: 'npm test', codeEditAt: at, commands: [{ cmd: 'npm test', exit: 0, at: 500 }] }), true, 'the test ran before the edit')
  assert.equal(shouldStopCheck({ cmd: 'npm test', codeEditAt: at, checkedAt: 1500 }), false, 'this edit was checked')
  assert.equal(shouldStopCheck({ cmd: 'npm test', codeEditAt: at, blocks: 2 }), false)
  assert.equal(shouldStopCheck({ cmd: null, codeEditAt: at }), false)
  assert.equal(shouldStopCheck({ cmd: 'npm test', codeEditAt: 0 }), false)
})

test('texts and footer', () => {
  assert.match(stopBlockText('npm test', 1, 'not ok 1'), /^\[workspace · stop check\] `npm test` failed \(exit 1\) after your last code edit\..*\nOutput \(last lines\):\nnot ok 1\nFix the cause \(not the check\)/s)
  assert.equal(editCheckText('eslint x', 'x.ts', 1, ''), '[workspace · edit check] `eslint x` failed on x.ts (exit 1).')
  const r = (stopCheck) => ({ activated: new Set(), completed: new Set(), failed: new Set(), denied: new Set(), stopCheck })
  const none = { present: false, applied: [] }
  assert.match(renderFooter(summarize(r({ status: 'failed', exit: 1 }), none, [])), /stop check failed \(exit 1\), sent back to Claude/)
  assert.match(renderFooter(summarize(r({ status: 'passed' }), none, [])), /stop check passed/)
  assert.match(renderFooter(summarize(r({ status: 'fixed', exit: 1 }), none, [])), /stop check failed \(exit 1\), sent back; a check passed after the fix/)
  assert.match(renderFooter(summarize(r({ status: 'timeout' }), none, [])), /stop check timed out/)
})

test('auto mode trust: remotes normalized; a new list starts with $defaults; removal takes only our line', () => {
  assert.equal(normalizeRemote('git@github.com:Acme/app.git\n'), 'github.com/Acme/app')
  assert.equal(normalizeRemote('https://github.com/Acme/app'), 'github.com/Acme/app')
  assert.equal(normalizeRemote('ssh://git@git.corp.example.com:2222/team/app.git'), 'git.corp.example.com/team/app')
  assert.equal(normalizeRemote('/srv/repos/app.git'), null)
  assert.equal(normalizeRemote(''), null)
  const line = trustLine('github.com/Acme/app')
  const a = addTrust({ model: 'opus' }, line)
  assert.deepEqual(a.settings, { model: 'opus', autoMode: { environment: ['$defaults', line] } })
  assert.equal(a.created, true)
  assert.ok(isTrusted(a.settings, 'github.com/acme/app'))
  assert.deepEqual(removeTrust(a.settings, line, true).settings, { model: 'opus' })
  const own = { autoMode: { environment: ['Trusted internal domains: *.corp.example.com'], soft_deny: ['$defaults'] } }
  const b = addTrust(own, line)
  assert.deepEqual(b.settings.autoMode.environment, ['Trusted internal domains: *.corp.example.com', line], 'a list the user wrote keeps its shape')
  assert.deepEqual(removeTrust(b.settings, line, false).settings, own)
  assert.equal(addTrust(b.settings, line).added, false)
})
