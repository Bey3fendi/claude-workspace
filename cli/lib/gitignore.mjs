export const BEGIN = '# >>> claude-workspace (managed) >>>'
export const END = '# <<< claude-workspace (managed) <<<'
export const ENTRIES = ['.claude/workspace/', '.claude/settings.local.json']

const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n')

/** Insert or update the managed block. Returns the new text (identical text means no change). */
export function upsertBlock(text, entries = ENTRIES) {
  const eol = eolOf(text || '')
  const block = [BEGIN, ...entries, END].join(eol)
  const re = blockRe()
  if (re.test(text)) return text.replace(blockRe(), block)
  if (!text) return block + eol
  const sep = text.endsWith(eol) ? '' : eol
  return text + sep + block + eol
}

/** Remove the managed block (and the newline that followed it). */
export function removeBlock(text) {
  if (!text) return text
  return text.replace(new RegExp(`${esc(BEGIN)}[\\s\\S]*?${esc(END)}\\r?\\n?`), '')
}

export const hasBlock = (text) => blockRe().test(text || '')

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const blockRe = () => new RegExp(`${esc(BEGIN)}[\\s\\S]*?${esc(END)}`)
