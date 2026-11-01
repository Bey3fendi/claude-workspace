import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, rmSync, readdirSync, rmdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** Read a file as a Buffer, or null when it does not exist. */
export function readMaybe(path) {
  try { return readFileSync(path) } catch (err) { if (err.code === 'ENOENT') return null; throw err }
}

export const hashFile = (path) => { const b = readMaybe(path); return b == null ? null : sha256(b) }

/** Atomic write: temp file in the same directory, then rename. */
export function writeAtomic(path, data, mode) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.cw-tmp-${process.pid}`
  writeFileSync(tmp, data, mode ? { mode } : undefined)
  renameSync(tmp, path)
}

export class UserError extends Error {
  constructor(message, code = 2) { super(message); this.code = code }
}

/** Parse JSON settings. Missing -> {}. Malformed -> UserError (we never rewrite a file we cannot parse). */
export function readJsonFile(path, { missing = {} } = {}) {
  const buf = readMaybe(path)
  if (buf == null) return missing
  const text = buf.toString('utf8').replace(/^﻿/, '')
  if (text.trim() === '') return missing
  try { return JSON.parse(text) } catch (err) {
    throw new UserError(`refusing to modify ${path}: it is not valid JSON (${err.message})`)
  }
}

export const toJson = (obj) => JSON.stringify(obj, null, 2) + '\n'

/** Write JSON only if the serialized content changes. Returns true when written. */
export function writeJsonIfChanged(path, obj) {
  const next = toJson(obj)
  const cur = readMaybe(path)
  if (cur != null && cur.toString('utf8') === next) return false
  writeAtomic(path, next)
  return true
}

export const exists = (p) => existsSync(p)
export const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
export const rmrf = (p) => rmSync(p, { recursive: true, force: true })

/** Remove dir and empty parents up to (not including) stopAt. */
export function removeEmptyDirs(dir, stopAt) {
  let d = dir
  while (d.startsWith(stopAt) && d !== stopAt) {
    try { if (readdirSync(d).length) return; rmdirSync(d) } catch { return }
    d = dirname(d)
  }
}

/** Compare dotted versions numerically. */
export function cmpVersion(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

export const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')

export function relFrom(root, abs) { return abs.startsWith(root + '/') ? abs.slice(root.length + 1) : abs }

export { join, dirname }
