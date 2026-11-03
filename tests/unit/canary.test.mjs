import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSemver, cmpSemver, parseLsRemote, latestTag, judgePlugin, judgeClaudeMem, checkUpstream } from '../../cli/lib/canary.mjs'

const LS = [
  'aaaa000000000000000000000000000000000000\tHEAD',
  'aaaa000000000000000000000000000000000000\trefs/heads/main',
  '1111111111111111111111111111111111111111\trefs/tags/v7.0.1',
  'bbbb000000000000000000000000000000000000\trefs/tags/v7.1.0',
  'cccc000000000000000000000000000000000000\trefs/tags/v7.1.0^{}',
  'dddd000000000000000000000000000000000000\trefs/tags/v8.0.0-beta.1',
  'eeee000000000000000000000000000000000000\trefs/tags/nightly',
].join('\n')

test('semver parse/compare: pre-release ranks below its release', () => {
  assert.equal(parseSemver('v7.1.0').minor, 1)
  assert.equal(parseSemver('nightly'), null)
  assert.ok(cmpSemver(parseSemver('7.1.0'), parseSemver('7.0.9')) > 0)
  assert.ok(cmpSemver(parseSemver('8.0.0-beta.1'), parseSemver('8.0.0')) < 0)
})

test('ls-remote: HEAD, tags, peeled sha preferred; latest stable ignores pre-releases', () => {
  const r = parseLsRemote(LS)
  assert.equal(r.head.slice(0, 4), 'aaaa')
  assert.equal(r.tags.find((t) => t.name === 'v7.1.0').sha.slice(0, 4), 'cccc')
  assert.equal(latestTag(r.tags).name, 'v7.1.0')
  assert.equal(latestTag([]), null)
})

const pin = (v, sha) => ({ name: 'superpowers', upstreamVersion: v, source: { url: 'u', sha } })
test('plugin verdicts: update / current / ahead / unknown / error', () => {
  const r = parseLsRemote(LS)
  assert.equal(judgePlugin(pin('7.0.1', '1'.repeat(40)), r).status, 'update')
  const cur = judgePlugin(pin('7.1.0', 'cccc000000000000000000000000000000000000'), r)
  assert.equal(cur.status, 'current'); assert.equal(cur.pinnedTag, 'v7.1.0'); assert.equal(cur.note, 'up to date')
  assert.match(judgePlugin(pin('7.1.0', 'f'.repeat(40)), r).note, /not the tagged one/)
  assert.equal(judgePlugin(pin('9.0.0', 'f'.repeat(40)), r).status, 'ahead')
  assert.equal(judgePlugin(pin('7.0.1', 'x'), { head: 'h', tags: [] }).status, 'unknown')
  assert.equal(judgePlugin(pin('7.0.1', 'x'), null).status, 'error')
})

test('claude-mem: npm update, local drift, unreachable', () => {
  assert.equal(judgeClaudeMem({ version: '15.8.0' }, '15.9.1', '15.8.0').status, 'update')
  const d = judgeClaudeMem({ version: '15.8.0' }, '15.8.0', '15.9.0')
  assert.equal(d.status, 'drift'); assert.match(d.note, /auto-updates/)
  assert.equal(judgeClaudeMem({ version: '15.8.0' }, '15.8.0', '15.8.0').status, 'current')
  assert.match(judgeClaudeMem({ version: '15.8.0' }, null, null).note, /npm not reachable/)
})

test('checkUpstream: only url-pinned plugins; runner failures become error rows; never throws', () => {
  const lock = { plugins: [{ name: 'core', source: './p' }, { ...pin('7.0.1', '1'.repeat(40)) }, { name: 'r', upstreamVersion: '1.0.0', source: { url: 'bad', sha: 's' }, enabled: false }],
    claudeMem: { npmPackage: 'claude-mem', version: '15.8.0' } }
  const calls = []
  const runner = (cmd, args) => { calls.push([cmd, ...args].join(' ')); return cmd === 'git' && args.includes('bad') ? { code: 128, stdout: '' } : cmd === 'git' ? { code: 0, stdout: LS } : { code: 0, stdout: '15.8.0\n' } }
  const rows = checkUpstream(lock, { runner, installedClaudeMem: '15.8.0' })
  assert.deepEqual(rows.map((r) => [r.name, r.status]), [['superpowers', 'update'], ['r', 'error'], ['claude-mem', 'current']])
  assert.equal(rows[1].enabled, false)
  assert.ok(calls.every((c) => !/install|add|update/.test(c)), 'read-only commands only')
})
