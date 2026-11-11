// Install manifest + byte-exact backups, kept in <project>/.claude/workspace/ (gitignored).
// The FIRST install records the pristine state of every touched file; later runs never
// overwrite those backups, so uninstall can always return to the pre-workspace bytes.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { WORKSPACE_DIR, TOUCHED } from './context.mjs'
import { hashFile, readJsonFile, writeJsonIfChanged, exists } from './util.mjs'

export const manifestPath = (ctx) => ctx.p(join(WORKSPACE_DIR, 'manifest.json'))
const backupPath = (ctx, rel) => ctx.p(join(WORKSPACE_DIR, 'backups', rel))

export function loadManifest(ctx) {
  const m = readJsonFile(manifestPath(ctx), { missing: null })
  return m
}

export function newManifest(ctx) {
  return {
    schema: 1,
    workspaceVersion: ctx.lock.workspaceVersion,
    project: ctx.projectRoot,
    installedAt: new Date().toISOString(),
    claudeDirExisted: exists(ctx.p('.claude')),
    files: {},
    addedDenies: [],
    addedAllows: [],
    marketplace: { name: ctx.marketplaceName, source: null },
    plugins: [],
    memoryFiles: {},
    disabledPlugins: [],
  }
}

/** Record pre-install state of each touched file once. */
export function snapshot(ctx, m) {
  for (const rel of TOUCHED) {
    if (m.files[rel]) continue
    const abs = ctx.p(rel)
    const preHash = hashFile(abs)
    const rec = { existedBefore: preHash != null, preHash, postHash: null, backup: null }
    if (preHash != null) {
      const b = backupPath(ctx, rel)
      mkdirSync(dirname(b), { recursive: true })
      copyFileSync(abs, b)
      if (hashFile(b) !== preHash) throw new Error(`backup verification failed for ${rel}`)
      rec.backup = join(WORKSPACE_DIR, 'backups', rel)
    }
    m.files[rel] = rec
  }
}

export function finalize(ctx, m) {
  for (const rel of Object.keys(m.files)) m.files[rel].postHash = hashFile(ctx.p(rel))
  m.updatedAt = m.updatedAt ?? m.installedAt
  return m
}

/** Write manifest; returns true when content changed. updatedAt only moves on real changes. */
export function saveManifest(ctx, m) {
  const prev = loadManifest(ctx)
  const strip = (x) => x && JSON.stringify({ ...x, updatedAt: undefined })
  if (prev && strip(prev) === strip(m)) return false
  m.updatedAt = new Date().toISOString()
  return writeJsonIfChanged(manifestPath(ctx), m)
}
