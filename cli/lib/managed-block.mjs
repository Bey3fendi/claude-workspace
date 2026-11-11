// A block of lines the workspace owns inside a file someone else owns (.gitignore, CLAUDE.md).
// Line based: a marker is a line that equals `begin` or `end` (surrounding whitespace ignored).
// The file's line endings are kept; nothing outside the markers is ever changed.

export const eolOf = (text) => (String(text ?? '').includes('\r\n') ? '\r\n' : '\n')

/** Every block in the text, plus whether the markers pair up. Lines are 1-based. */
export function inspect(text, { begin, end }) {
  const lines = String(text ?? '').split(/\r?\n/)
  const blocks = []
  let open = null, bad = null
  lines.forEach((l, i) => {
    const t = l.trim()
    if (t === begin) {
      if (open != null) bad ??= { line: i + 1, problem: `second "${begin}" before "${end}"` }
      open = i
    } else if (t === end) {
      if (open == null) bad ??= { line: i + 1, problem: `"${end}" without "${begin}"` }
      else { blocks.push({ start: open + 1, end: i + 1, body: lines.slice(open + 1, i).join('\n') }); open = null }
    }
  })
  if (open != null) bad ??= { line: open + 1, problem: `"${begin}" without "${end}"` }
  return { count: blocks.length, wellFormed: !bad, problem: bad, blocks, body: blocks[0]?.body ?? null }
}

/** Character ranges [from, to) of each block, including the line break after the end marker. */
function ranges(text, markers) {
  const out = []
  const re = /[^\r\n]*(\r\n|\n|$)/g
  let m, pos = 0, open = null
  while ((m = re.exec(text)) && m[0] !== '') {
    const t = m[0].replace(/\r?\n$/, '').trim()
    const lineEnd = pos + m[0].length
    if (t === markers.begin) open = pos
    else if (t === markers.end && open != null) { out.push([open, lineEnd]); open = null }
    pos = lineEnd
  }
  return out
}

/**
 * Insert or refresh the block. Returns { text, action } where action is null (no change),
 * 'created', 'appended', 'restored' (body differed) or 'deduplicated'. Throws on malformed markers.
 * `blankLineBefore` puts one empty line between existing content and an appended block.
 */
export function upsert(text, bodyLines, markers, { blankLineBefore = false } = {}) {
  const src = String(text ?? '')
  const info = inspect(src, markers)
  if (!info.wellFormed) {
    const e = new Error(`malformed managed block at line ${info.problem.line}: ${info.problem.problem}`)
    e.code = 'MALFORMED_BLOCK'; e.line = info.problem.line
    throw e
  }
  const eol = eolOf(src)
  const block = [markers.begin, ...bodyLines, markers.end].join(eol)
  if (!info.count) {
    if (!src) return { text: block + eol, action: 'created' }
    const sep = src.endsWith('\n') ? '' : eol
    return { text: src + sep + (blankLineBefore ? eol : '') + block + eol, action: 'appended' }
  }
  const rs = ranges(src, markers)
  let out = src, action = null
  // drop every block after the first (from the end, so earlier offsets stay valid)
  for (const [a, b] of rs.slice(1).reverse()) { out = out.slice(0, a) + out.slice(b); action = 'deduplicated' }
  const [a, b] = rs[0]
  const tail = out.slice(a, b).match(/\r?\n$/)?.[0] ?? ''
  const replaced = out.slice(0, a) + block + tail + out.slice(b)
  if (replaced !== out) action ??= 'restored'
  return { text: replaced, action }
}

/**
 * Remove every block and its line break. With `blankLineBefore`, also one empty line directly
 * before a block (the one `upsert` added). Malformed markers: the text is returned unchanged.
 */
export function remove(text, markers, { blankLineBefore = false } = {}) {
  const src = String(text ?? '')
  if (!src || !inspect(src, markers).wellFormed) return src
  let out = src
  for (const [a, b] of ranges(src, markers).reverse()) {
    let from = a
    if (blankLineBefore) {
      const before = out.slice(0, a)
      const m = before.match(/(\r?\n)(\r?\n)$/)
      if (m) from = a - m[2].length
    }
    out = out.slice(0, from) + out.slice(b)
  }
  return out
}
