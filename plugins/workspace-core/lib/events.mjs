// Pure helpers shared by the workspace-core mod (engine side) and the observability tools
// (Node side). No Node or engine APIs here: this file must load in both.

export const SCHEMA = 1
export const SEGMENT_LINES = 500
export const PREVIEW_CHARS = 80

// ---------------------------------------------------------------- redaction

const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED:private-key]'],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, '[REDACTED:anthropic-key]'],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, '[REDACTED:api-key]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED:github-token]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED:github-token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:aws-key]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED:slack-token]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED:jwt]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{16,}=*/gi, '$1 [REDACTED]'],
  [/\b([A-Za-z0-9_]*(?:api[_-]?key|token|secret|passw(?:or)?d)[A-Za-z0-9_]*)(\s*[=:]\s*)["']?[^\s"',;]{6,}["']?/gi, '$1$2[REDACTED]'],
  [/\b(https?:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[REDACTED]@'],
]

export function redact(text) {
  if (typeof text !== 'string' || !text) return text
  let t = text
  for (const [re, rep] of SECRET_PATTERNS) t = t.replace(re, rep)
  return t
}

/** Deep-redact every string in a JSON-able value. */
export function redactDeep(v) {
  if (typeof v === 'string') return redact(v)
  if (Array.isArray(v)) return v.map(redactDeep)
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = redactDeep(v[k]); return o }
  return v
}

// ---------------------------------------------------------------- hashing / ids

/** 64-bit FNV-1a as hex (two 32-bit lanes). Grouping only; not a security hash. */
export function fnv64(str) {
  let h1 = 0x811c9dc5, h2 = 0xcbf29ce4
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x01000193 ^ 0x5bd1e995) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/** Stable, filesystem-safe directory name for a project root. */
export function projectKey(root) {
  const base = String(root).split(/[\\/]/).filter(Boolean).pop() || 'root'
  return `${base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40)}-${fnv64(String(root)).slice(0, 10)}`
}

// ---------------------------------------------------------------- attribution

/** Content markers that attribute injected hook context to a workspace capability. */
export const MARKERS = {
  superpowers: [/You have superpowers/g, /using-superpowers/g],
  caveman: [/caveman/gi],
  ponytail: [/ponytail/gi],
  claudeMem: [/claude-mem/gi, /<claude-mem-context>/gi],
  karpathy: [/karpathy/gi],
}

export function markerCounts(content) {
  if (content == null) return {}
  const text = typeof content === 'string' ? content : safeStringify(content)
  const out = {}
  for (const [k, res] of Object.entries(MARKERS)) {
    let n = 0
    for (const re of res) n += (text.match(new RegExp(re.source, re.flags)) || []).length
    if (n) out[k] = n
  }
  return out
}

function safeStringify(v) { try { return JSON.stringify(v) } catch { return String(v) } }

export const short = (s, n = 160) => (typeof s === 'string' ? redact(s).slice(0, n) : s)
