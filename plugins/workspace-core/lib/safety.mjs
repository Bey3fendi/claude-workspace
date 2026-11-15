// Safety check for Bash commands (0.17.0). The deny rules in policies/safety-denies.json match a command's text
// from its start, so `git -C . push -f`, `sh -c 'git reset --hard'` or `cat .env` inside $(...) get past them.
// This reads the command the way a shell splits it (separators, quotes, $(...), sh -c '...') and refuses:
//   force-push (--force, -f, --force-with-lease, +refspec) · git reset --hard · git clean -f
//   rm -r -f on /, ~, $HOME, ., .., *, .git · reading .env / key files with cat, grep, source, < and the like.
// It is a guard against mistakes, not a security boundary: a script or program that opens .env itself is not seen
// (only the sandbox stops that). Heredoc bodies and quoted text are data, so a commit message may name these commands.

const SECRET_NAME = /^\.env(\.(local|development|production|staging|test|[\w-]+\.local))?$/
const KEY_NAME = /^(id_(rsa|ecdsa|ed25519|dsa)|.*\.pem)$/
const DANGER_RM = new Set(['/', '/*', '~', '~/*', '$HOME', '${HOME}', '$HOME/*', '.', './*', '..', '../*', '*', '.git'])
const READERS = new Set(['cat', 'tac', 'head', 'tail', 'less', 'more', 'bat', 'nl', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'awk', 'gawk',
  'sed', 'cut', 'sort', 'uniq', 'diff', 'cmp', 'xxd', 'hexdump', 'od', 'strings', 'base64', 'jq', 'yq', 'source', '.', 'type'])
const SENDERS = new Set(['curl', 'wget', 'scp', 'rsync', 'nc'])
const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nohup', 'time', 'nice', 'xargs', 'builtin'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash'])

const base = (t) => t.replace(/\/+$/, '').split('/').pop()
/** True for .env files (not .env.example and other templates), private keys, ~/.ssh/ and ~/.aws/credentials. */
export function isSecret(path) {
  const p = String(path)
  if (/(^|\/)\.ssh\/./.test(p) || /(^|\/)\.aws\/credentials$/.test(p)) return true
  const n = base(p)
  if (/[*?]/.test(n)) return /^\.env/.test(n) || /\.pem$/.test(n) || /^id_/.test(n)
  return SECRET_NAME.test(n) || KEY_NAME.test(n)
}

const dropHeredocs = (s) => s.replace(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, (m) => m.slice(0, m.indexOf('\n')))

// Splits a command into simple commands (arrays of words). $(...) and backticks become their own commands.
function parse(src, out = []) {
  let words = [], w = '', has = false, q = null
  const end = () => { if (has) words.push(w); w = ''; has = false }
  const cut = () => { end(); if (words.length) out.push(words); words = [] }
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q === "'") { if (c === "'") q = null; else w += c; continue }
    if (c === '\\' && i + 1 < src.length) { w += src[++i]; has = true; continue }
    if ((c === '$' && src[i + 1] === '(') || c === '`') {
      const close = c === '`' ? src.indexOf('`', i + 1) : matchParen(src, i + 1)
      const stop = close < 0 ? src.length : close
      parse(src.slice(i + (c === '`' ? 1 : 2), stop), out)
      w += '$SUB'; has = true; i = stop; continue
    }
    if (q === '"') { if (c === '"') q = null; else w += c; continue }
    if (c === "'" || c === '"') { q = c; has = true; continue }
    if (c === '<' || c === '>') { end(); words.push(c); while (src[i + 1] === c || src[i + 1] === '&') i++; continue }
    if (/[;&|\n()]/.test(c)) { cut(); continue }
    if (/\s/.test(c)) { end(); continue }
    w += c; has = true
  }
  cut()
  return out
}
function matchParen(s, open) {
  let d = 0
  for (let i = open; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) return i }
  return -1
}

const shortHas = (a, f) => /^-[^-]/.test(a) && a.slice(1).includes(f)

function checkWords(ws) {
  // input redirect from a secret file, whatever the command
  for (let i = 0; i + 1 < ws.length; i++) if (ws[i] === '<' && isSecret(ws[i + 1])) return { rule: 'secret-read', target: ws[i + 1] }
  let i = 0
  for (;;) {
    if (i < ws.length && /^[A-Za-z_]\w*=/.test(ws[i])) i++
    else if (i < ws.length && WRAPPERS.has(base(ws[i]))) { i++; while (i < ws.length && ws[i].startsWith('-')) i++ }
    else break
  }
  const cmd = base(ws[i] ?? ''), args = ws.slice(i + 1).filter((a) => a !== '<' && a !== '>')
  if (SHELLS.has(cmd)) { const c = args.findIndex((a) => shortHas(a, 'c')); if (c >= 0 && args[c + 1]) return checkCommand(args[c + 1]) }
  if (cmd === 'git') {
    let j = 0
    while (j < args.length && args[j].startsWith('-')) j += /^-[Cc]$/.test(args[j]) ? 2 : 1
    const sub = args[j], rest = args.slice(j + 1)
    if (sub === 'push' && rest.some((a) => /^--force(-with-lease)?(=|$)/.test(a) || shortHas(a, 'f') || /^\+./.test(a))) return { rule: 'force-push' }
    if (sub === 'reset' && rest.includes('--hard')) return { rule: 'reset-hard' }
    if (sub === 'clean' && rest.some((a) => a === '--force' || shortHas(a, 'f'))) return { rule: 'clean-force' }
  }
  if (cmd === 'rm') {
    const r = args.some((a) => a === '--recursive' || shortHas(a, 'r') || shortHas(a, 'R'))
    const f = args.some((a) => a === '--force' || shortHas(a, 'f'))
    const t = args.find((a) => !a.startsWith('-') && DANGER_RM.has(a.length > 1 ? a.replace(/\/+$/, '') : a))
    if (r && f && t) return { rule: 'rm-rf', target: t }
  }
  if (READERS.has(cmd)) { const s = args.find((a) => !a.startsWith('-') && isSecret(a)); if (s) return { rule: 'secret-read', target: s } }
  if (SENDERS.has(cmd)) { const s = args.find((a) => isSecret(a.split(/[@=]/).pop())); if (s) return { rule: 'secret-read', target: s.split(/[@=]/).pop() } }
  return null
}

/** The first thing this command must not do, or null. */
export function checkCommand(command) {
  for (const ws of parse(dropHeredocs(String(command ?? '')))) { const hit = checkWords(ws); if (hit) return hit }
  return null
}

const WHAT = {
  'force-push': ['a force push', 'it can overwrite commits on the remote that others rely on'],
  'reset-hard': ['git reset --hard', 'it throws away uncommitted work, with no undo'],
  'clean-force': ['git clean -f', 'it deletes untracked files, with no undo'],
  'rm-rf': ['rm -rf on that path', 'it deletes a whole directory tree, with no undo'],
  'secret-read': ['reading that file', 'it holds secrets (keys, tokens, passwords) that must not enter the conversation'],
}
/** The refusal Claude sees. */
export function safetyText(hit) {
  const [what, why] = WHAT[hit.rule]
  return `[workspace · safety] Blocked ${what}${hit.target ? ` (${hit.target})` : ''}: ${why}. ` +
    'If the user wants it, ask them to run it themselves (in this session they can type "! <command>"). ' +
    'Do not try another command that does the same thing. To turn this check off: CW_SAFETY=0.'
}
