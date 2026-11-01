// Fallback reconciler. Claude Code transcripts are NOT a documented interface, so everything
// derived here is labeled best-effort. Used only for what documented events cannot show:
// third-party hook failures (hook_non_blocking_error) and per-hook corroboration (hook_success).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { attributeCommand, short } from '../plugins/workspace-core/lib/events.mjs'

export const transcriptPath = (configDir, root, sid) => join(configDir, 'projects', String(root).replace(/[^A-Za-z0-9]/g, '-'), `${sid}.jsonl`)

const TYPES = new Set(['hook_success', 'hook_non_blocking_error', 'hook_blocking_error', 'async_hook_response'])

export function readTranscriptHooks(path) {
  let text
  try { text = readFileSync(path, 'utf8') } catch { return null }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.includes('"attachment"')) continue
    let d; try { d = JSON.parse(line) } catch { continue }
    const a = d.attachment
    if (!a || !TYPES.has(a.type)) continue
    const failed = a.type !== 'hook_success' && a.type !== 'async_hook_response' ? true : (a.exitCode ?? 0) !== 0
    out.push({
      t: Date.parse(d.timestamp) || null,
      type: a.type,
      hookEvent: a.hookEvent ?? null,
      command: short(a.command ?? '', 120),
      capability: (a.pluginId && attributeCommand(a.pluginId)) || attributeCommand(a.command),
      exitCode: a.exitCode ?? null,
      failed,
      detail: failed ? short(a.stderr || a.stdout || '', 200) : undefined,
    })
  }
  return out
}
