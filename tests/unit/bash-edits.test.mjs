import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changedPaths, mayWrite, snapshotMap } from '../../plugins/workspace-core/lib/bash-edits.mjs'
import { isFollowUp, restoreText } from '../../plugins/workspace-core/lib/contracts.mjs'

test('mayWrite: scripts, builds and redirects get snapshots; reads do not; git moves are not edits', () => {
  for (const c of ["python3 - <<'EOF'\nopen(p,'w').write(s)\nEOF", 'node scripts/fix.js', "sed -i 's/a/b/' src/x.ts", 'echo x > src/a.ts', 'cat a >> b',
    'npm test', 'cp a b', 'find . -name "*.tmp" -delete', 'cd src && perl -pi -e s/a/b/ x.c'])
    assert.equal(mayWrite(c), 'yes', c)
  for (const c of ['cat src/a.ts', 'grep -rn foo src | head -5', 'git status --short && git log --oneline -3', "sed -n '1,20p' a.ts",
    'ls -la 2>&1', 'wc -l a 2>&1 >/dev/null', 'gh run view 1 --log-failed | tail -n 150', 'echo "a > b"'])
    assert.equal(mayWrite(c), 'no', c)
  for (const c of ['git switch -c fix/x', 'git checkout main', 'git stash pop', 'git -C . pull', 'gh pr checkout 3']) assert.equal(mayWrite(c), 'vcs', c)
})

test('changedPaths: new, changed, deleted and restored files; memory and workspace files are left out', () => {
  const before = snapshotMap([['src/a.ts', ' M src/a.ts'], ['src/b.ts', ' M src/b.ts'], ['src/c.ts', ' M src/c.ts']], ['src/a.ts', 'src/b.ts', 'src/c.ts'], ['h1', 'h2', 'h3'])
  const after = snapshotMap([['src/a.ts', ' M src/a.ts'], ['src/b.ts', ' M src/b.ts'], ['src/new.ts', '?? src/new.ts'], ['.memory/session.md', ' M .memory/session.md']],
    ['src/a.ts', 'src/b.ts', 'src/new.ts', '.memory/session.md'], ['h1', 'h2x', 'h4', 'h5'])
  assert.deepEqual(changedPaths(before, after).sort(), ['src/b.ts', 'src/c.ts', 'src/new.ts'])
  assert.deepEqual(changedPaths(before, before), [])
  // a hash list that does not line up keeps the status lines (a further edit to an already-modified file is then missed, not invented)
  assert.equal(snapshotMap([['a', ' M a']], ['a'], []).get('a'), ' M a')
})

test('follow-ups: short confirmations continue the previous request; questions and new requests do not', () => {
  for (const t of ['yes lets do all three.', 'ok go ahead', 'Yes, keep going with Task 3', 'do it', 'sounds good, proceed', 'continue with the next one', "let's do that"])
    assert.ok(isFollowUp(t), t)
  for (const t of ['what about the webhook?', 'add a pause menu', 'yes '.repeat(50), '', 'the yes button is broken'])
    assert.ok(!isFollowUp(t), t)
})

test('a follow-up contract says it continues the previous work and does not ask for skills again', () => {
  const t = restoreText('feature', { invoked: ['superpowers:brainstorming'], followUp: true })
  assert.match(t, /^\[workspace contract: feature, follow-up\] This message continues the previous request's work/)
  assert.match(t, /You already invoked superpowers:brainstorming for this request; keep following it\./)
  assert.match(restoreText('debug', { rootCauseStated: true, followUp: true }), /root cause already stated/)
  assert.match(restoreText('debug', {}), /restored after compaction/, 'the compaction wording is unchanged')
})
