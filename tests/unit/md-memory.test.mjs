import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TEMPLATES, globToRegex, splitGlobs, parseSections, relPath, matchSections, trimSession, snapshotBlock, appendBlock, maxLinesFrom, sessionStartText, requestTitle, headingsOf, autoBlock, shouldNudge, preEditText, changedFiles, checkLine } from '../../plugins/workspace-core/lib/md-memory.mjs'

test('globs: **, *, ?, {a,b}', () => {
  const m = (g, p) => globToRegex(g).test(p)
  assert.ok(m('src/**', 'src/a/b/c.ts')); assert.ok(m('src/**/x.ts', 'src/x.ts')); assert.ok(m('src/**/x.ts', 'src/a/b/x.ts'))
  assert.ok(m('src/*.ts', 'src/a.ts')); assert.ok(!m('src/*.ts', 'src/a/b.ts'))
  assert.ok(m('src/?.js', 'src/a.js')); assert.ok(!m('src/?.js', 'src/ab.js'))
  assert.ok(m('src/{cart,tax}.js', 'src/tax.js')); assert.ok(!m('src/{cart,tax}.js', 'src/coupons.js'))
  assert.ok(m('./README.md', 'README.md')); assert.ok(!m('a.b', 'aXb'), 'dots are literal')
})

test('paths line: commas inside braces do not split (POC fix)', () => {
  assert.deepEqual(splitGlobs('src/{a,b}.ts, lib/**,  x.md'), ['src/{a,b}.ts', 'lib/**', 'x.md'])
})

test('sections need a paths line; ids carry file and title', () => {
  const s = parseSections('# T\n\n## One\n<!-- paths: a/** -->\n- x\n\n## Two\n- no paths\n', 'context.md')
  assert.deepEqual(s.map((x) => x.id), ['context.md#One'])
  assert.match(s[0].body, /^## One/)
})

test('templates contain no injectable sections (their examples are indented)', () => {
  for (const [k, t] of Object.entries(TEMPLATES)) assert.equal(parseSections(t, k).length, 0, k)
  assert.equal(trimSession(TEMPLATES.session, 150), TEMPLATES.session)
})

test('relPath: inside the project only, never the memory dir', () => {
  assert.equal(relPath('/p', '/p/src/a.js'), 'src/a.js')
  assert.equal(relPath('/p/', 'src/a.js'), 'src/a.js')
  assert.equal(relPath('/p', '/other/a.js'), null)
  assert.equal(relPath('/p', '/p2/a.js'), null, 'prefix of another folder is not inside')
  assert.equal(relPath('/p', '/p/.memory/context.md'), null)
  assert.equal(relPath('C:\\w\\p', 'C:\\w\\p\\src\\a.js'), 'src/a.js')
  assert.equal(relPath('/p', null), null)
})

test('match once per session', () => {
  const s = parseSections('## A\n<!-- paths: src/** -->\n- a\n', 'decisions.md')
  const seen = new Set()
  assert.equal(matchSections(s, 'src/x.js', seen).length, 1)
  seen.add(s[0].id)
  assert.equal(matchSections(s, 'src/x.js', seen).length, 0)
})

test('trim keeps the header and the newest blocks within the cap', () => {
  const blocks = Array.from({ length: 20 }, (_, i) => `## b${i}\n- l\n- l\n`).join('\n')
  const out = trimSession('# H\n\nheader\n\n' + blocks, 25)
  assert.ok(out.split('\n').length - 1 <= 25)
  assert.ok(out.startsWith('# H\n')); assert.match(out, /## b19/); assert.doesNotMatch(out, /## b0\n/)
  assert.equal(trimSession('', 10), '')
})

test('snapshot block and append', () => {
  const b = snapshotBlock({ stamp: '2026-11-11 10:00', trigger: 'auto', lastCommit: 'abc fix', porcelain: ' M a.js\n?? b.js\n' })
  assert.match(b, /^## 2026-11-11 10:00 · auto-snapshot \(auto\)/)
  assert.match(b, /- Uncommitted:\n {2}- M a\.js\n {2}- \?\? b\.js/)
  assert.match(snapshotBlock({ stamp: 's' }), /Working tree clean/)
  assert.equal(appendBlock('x', 'B'), 'x\n\nB\n')
  assert.equal(appendBlock('', 'B'), '\nB\n')
})

test('max lines and session-start text', () => {
  assert.equal(maxLinesFrom('80'), 80); assert.equal(maxLinesFrom('0'), 150); assert.equal(maxLinesFrom('x'), 150); assert.equal(maxLinesFrom(undefined), 150)
  assert.doesNotMatch(sessionStartText('  '), /Project session log/)
  assert.match(sessionStartText('## a'), /Project session log[\s\S]*## a$/)
})

test('automatic memory: request title, headings, the auto block and the nudge rule', () => {
  const redact = (s) => s.replace(/token=\S+/, 'token=[REDACTED]')
  assert.equal(requestTitle('\n  Fix   the cart token=abc123\nsecond line', redact), 'Fix the cart token=[REDACTED]')
  assert.equal(requestTitle('x'.repeat(100)).length, 72)
  assert.deepEqual(headingsOf('# D\n\n## A\n- a\n## B\n'), ['A', 'B'])
  const b = autoBlock({ stamp: '2026-11-11 10:00', cls: 'feature', title: 'Add X', files: Array.from({ length: 10 }, (_, i) => `f${i}.js`), check: { cmd: 'npm test', exit: 1 }, added: { decisions: ['Use cents'] } })
  assert.match(b, /^## 2026-11-11 10:00 · feature: Add X\n/)
  assert.match(b, /- Files changed: f0\.js, .*f7\.js and 2 more/)
  assert.match(b, /`npm test` → exit 1/)
  assert.match(b, /- Recorded: decisions\.md "Use cents"/)
  assert.match(autoBlock({ stamp: 's', cls: null, title: '', files: ['a'], check: null }), /## s · changes\n[\s\S]*none run[\s\S]*nothing new/)
  assert.equal(parseSections(b, 'session.md').length, 0) // never injectable
  assert.ok(shouldNudge({ cls: 'feature', edited: true, designed: true, recorded: false, nudged: false }))
  assert.ok(shouldNudge({ cls: 'architecture', edited: true, designed: false, recorded: false, nudged: false }))
  for (const o of [{ cls: 'feature', designed: false }, { cls: 'debug', designed: true }, { recorded: true }, { nudged: true }, { edited: false }])
    assert.ok(!shouldNudge({ cls: 'feature', edited: true, designed: true, recorded: false, nudged: false, ...o }))
  assert.match(preEditText('src/a.js', [{ id: 'decisions.md#X', body: '## X\n- y' }]), /Notes that apply to src\/a\.js[\s\S]*## X[\s\S]*not applied/)
})

test('changedFiles: tool edits plus new or changed git entries, memory files excluded; checkLine', () => {
  const before = ' M src/a.js\n?? notes.txt\n'
  const after = ' M src/a.js\nMM notes.txt\n?? src/new.js\nR  src/x.js -> src/y.js\n?? .memory/session.md\n'
  assert.deepEqual(changedFiles(['src/t.js'], before, after), ['src/t.js', 'notes.txt', 'src/new.js', 'src/y.js'])
  assert.deepEqual(changedFiles([], null, ''), [])
  assert.equal(checkLine("cat >> .memory/session.md <<'EOF'\nnode --test\nEOF"), 'cat >> .memory/session.md <<\'EOF\'')
})
