import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { UserError } from './util.mjs'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function loadLock(root = REPO_ROOT) {
  return JSON.parse(readFileSync(join(root, 'workspace.lock.json'), 'utf8'))
}
export function loadDenies(root = REPO_ROOT) {
  return JSON.parse(readFileSync(join(root, 'policies', 'skill-denies.json'), 'utf8')).rules
}

/** Files in the project that the workspace may modify. Everything else is off limits. */
export const TOUCHED = ['.claude/settings.json', '.caveman.json', '.claude/workspace.json', '.gitignore']
export const WORKSPACE_DIR = '.claude/workspace'

export function createContext(opts = {}, env = process.env) {
  const projectRoot = realpathSafe(resolve(opts.project || process.cwd()))
  const home = env.HOME || homedir()
  const lock = loadLock()
  return {
    opts,
    env,
    lock,
    denies: loadDenies(),
    repoRoot: REPO_ROOT,
    projectRoot,
    home,
    configDir: env.CLAUDE_CONFIG_DIR || join(home, '.claude'),
    stateDir: join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'claude-workspace'),
    claudeBin: env.CW_CLAUDE_BIN || 'claude',
    npxBin: env.CW_NPX_BIN || 'npx',
    managedDirs: env.CW_MANAGED_SETTINGS_DIR
      ? [env.CW_MANAGED_SETTINGS_DIR]
      : process.platform === 'darwin' ? ['/Library/Application Support/ClaudeCode'] : ['/etc/claude-code'],
    marketplaceName: lock.marketplace.name,
    pluginIds: lock.plugins.filter((p) => p.enabled).map((p) => `${p.name}@${lock.marketplace.name}`),
    p: (rel) => join(projectRoot, rel),
  }
}

function realpathSafe(p) {
  try { return realpathSync(p) } catch { throw new UserError(`project directory does not exist: ${p}`) }
}
