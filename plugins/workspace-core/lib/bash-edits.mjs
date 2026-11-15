// Edits made through Bash (0.18.1). In AgentBridge one request changed 8 files with `python3 - <<'EOF' … open(p,'w')`
// and the workspace saw none of them: no Ponytail rule after the first edit, no memory record, no check note.
// A command that may write is bracketed by two snapshots of the dirty files (git status, then each file's blob
// hash); a path whose entry changed was edited by that command. Pure logic; hooks/register.mjs runs git.
import { simpleCommands } from './safety.mjs'

const base = (w) => String(w ?? '').split('/').pop()
// Commands that only read. Anything else (python, node, npm, make, cp, mv, …) may write and gets the snapshots.
const READ_ONLY = new Set(['cat', 'tac', 'head', 'tail', 'less', 'more', 'bat', 'nl', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ls', 'tree',
  'wc', 'pwd', 'echo', 'printf', 'which', 'type', 'file', 'stat', 'du', 'df', 'sort', 'uniq', 'cut', 'tr', 'awk', 'jq', 'yq', 'diff', 'cmp',
  'date', 'basename', 'dirname', 'realpath', 'readlink', 'true', 'false', 'test', '[', 'sleep', 'cd', 'export', 'set', 'xxd', 'od', 'strings'])
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'branch', 'rev-parse', 'ls-files', 'blame', 'grep', 'remote', 'describe', 'shortlog', 'reflog', 'fetch', 'config'])
// Git commands that change the working tree without anyone editing a file: not counted as edits.
const GIT_MOVES = new Set(['checkout', 'switch', 'stash', 'pull', 'merge', 'rebase', 'reset', 'restore', 'cherry-pick', 'revert', 'am', 'clone', 'worktree'])

const gitSub = (ws) => { let j = 1; while (j < ws.length && ws[j].startsWith('-')) j += /^-[Cc]$/.test(ws[j]) ? 2 : 1; return ws[j] ?? '' }
const readOnly = (ws) => {
  const c = base(ws[0])
  if (c === 'git') return GIT_READ.has(gitSub(ws))
  if (c === 'gh') return !(ws[1] === 'pr' && ws[2] === 'checkout')
  if (c === 'sed') return !ws.some((w) => /^-[^-]*i/.test(w) || w.startsWith('--in-place'))
  if (c === 'find') return !ws.some((w) => /^-(delete|exec|execdir|ok|fprint)/.test(w))
  return READ_ONLY.has(c)
}

/** 'yes': snapshot around it · 'vcs': git moved the working tree (not an edit) · 'no': reads only. */
export function mayWrite(command) {
  const cmd = String(command ?? '')
  const cmds = simpleCommands(cmd)
  if (cmds.some((ws) => base(ws[0]) === 'git' && GIT_MOVES.has(gitSub(ws)))) return 'vcs'
  if (cmds.some((ws) => base(ws[0]) === 'gh' && ws[1] === 'pr' && ws[2] === 'checkout')) return 'vcs'
  const redirect = />/.test(cmd.replace(/'[^']*'|"[^"]*"/g, '').replace(/\d?>&\d|&?>>?\s*\/dev\/null/g, ''))
  return redirect || !cmds.every(readOnly) ? 'yes' : 'no'
}

/** path → blob hash (or the status line, for a deleted file or one git could not hash). */
export function snapshotMap(entries, hashedPaths, hashes) {
  const m = new Map(entries)
  if (hashes.length === hashedPaths.length) hashedPaths.forEach((p, i) => m.set(p, hashes[i]))
  return m
}

/** Paths whose snapshot entry differs: new, changed, deleted, or restored to clean. */
export function changedPaths(before, after) {
  const out = []
  for (const p of new Set([...before.keys(), ...after.keys()])) if (before.get(p) !== after.get(p)) out.push(p)
  return out.filter((p) => !/^\.(memory|explain|claude)\//.test(p))
}
