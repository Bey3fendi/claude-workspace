// Opt-in check hooks (0.19.0), from the "verification points" advice: a check that must run is a hook, not a
// prompt. Set with `install --stop-check "npm test"` / `--edit-check "npx eslint {file}"`, kept in the committed
// .claude/workspace.json so the team shares them. Pure logic; hooks/register.mjs runs the commands.
//   stop check: at the end of a request that changed code and ran no passing check after its last code edit,
//               run it once; a failure goes back to Claude (the Stop hook's block), at most twice per request.
//   edit check: after each source edit, run it on that file; a failure is added next to the tool result.
import { checkAfter } from './explain.mjs'

const MAX_CMD = 500
const cmdOf = (v) => (typeof v === 'string' && v.trim() && v.length <= MAX_CMD ? v.trim() : null)

/** The `checks` block of .claude/workspace.json (text or parsed) → { stop, edit } (null when unset or invalid). */
export function checksConfig(marker) {
  let m = marker
  if (typeof m === 'string') { try { m = JSON.parse(m) } catch { m = null } }
  const c = m && typeof m === 'object' ? m.checks : null
  return { stop: cmdOf(c?.stop), edit: cmdOf(c?.edit) }
}

/** POSIX single-quoting, for the path put in place of {file}. */
export const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
/** The edit check for one file: {file} becomes the quoted path; a command without it runs as is. */
export const fillFile = (cmd, rel) => (cmd.includes('{file}') ? cmd.split('{file}').join(shq(rel)) : cmd)

/** The last `lines` lines of a command's output (stdout and stderr), ANSI colours removed, at most `chars` characters. */
export function outputTail(stdout, stderr, lines = 40, chars = 4000) {
  const text = [stdout, stderr].filter((s) => s && String(s).trim()).join('\n')
  const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')
  let out = clean.split('\n').map((l) => (l.length > 300 ? `${l.slice(0, 300)}…` : l)).slice(-lines).join('\n').trim()
  if (out.length > chars) out = `…${out.slice(-chars)}`
  return out
}

/** Run the stop check now? Only for an unchecked code edit with no passing check after it, at most twice per request. */
export function shouldStopCheck({ cmd, codeEditAt, checkedAt = 0, blocks = 0, commands = [] }) {
  if (!cmd || !codeEditAt || checkedAt >= codeEditAt || blocks >= 2) return false
  return checkAfter(commands, codeEditAt) !== null
}

export const stopBlockText = (cmd, exit, tail) =>
  `[workspace · stop check] \`${cmd}\` failed (exit ${exit}) after your last code edit. This is the project's own check, set with \`install --stop-check\`.` +
  `${tail ? `\nOutput (last lines):\n${tail}` : ''}\nFix the cause (not the check), run it again, then finish.`

export const editCheckText = (cmd, rel, exit, tail) =>
  `[workspace · edit check] \`${cmd}\` failed on ${rel} (exit ${exit}).${tail ? `\n${tail}` : ''}`
