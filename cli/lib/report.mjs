import { createInterface } from 'node:readline/promises'

/** Collects results; prints human lines (or one JSON document with --json). */
export class Reporter {
  constructor({ json = false, quiet = false, stream = process.stdout } = {}) {
    this.json = json; this.quiet = quiet; this.stream = stream
    this.changes = []; this.warnings = []; this.failures = []; this.events = []
  }
  #emit(kind, msg) {
    this.events.push({ kind, msg })
    if (this.json || (this.quiet && kind === 'info')) return
    const tag = { change: '+', warn: '!', fail: 'x', info: '-', ok: '✓', step: '>' }[kind] || '-'
    this.stream.write(`${tag} ${msg}\n`)
  }
  step(msg) { this.#emit('step', msg) }
  info(msg) { this.#emit('info', msg) }
  ok(msg) { this.#emit('ok', msg) }
  change(msg) { this.changes.push(msg); this.#emit('change', msg) }
  warn(msg) { this.warnings.push(msg); this.#emit('warn', msg) }
  fail(msg) { this.failures.push(msg); this.#emit('fail', msg) }
  summary(extra = {}) {
    return { changes: this.changes, warnings: this.warnings, failures: this.failures, ...extra }
  }
}

export async function confirm(question, { yes = false, env = process.env } = {}) {
  if (yes) return true
  if (!process.stdin.isTTY || !process.stdout.isTTY || env.CI) return false
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
    return a === 'y' || a === 'yes'
  } finally { rl.close() }
}
