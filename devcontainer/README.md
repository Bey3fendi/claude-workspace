# claude-workspace devcontainer feature

This feature installs the pinned workspace into a Linux devcontainer, so every new container starts with the workspace installed.

## What it does

**While the image builds (root):**
- Installs the `claude-workspace` CLI at `/usr/local/bin`.
- Requires Node ≥ 22.13, git and curl. `mcr.microsoft.com/devcontainers/javascript-node:22` has all three.

**After the container is created (the remote user, in the workspace folder):**
1. Installs Claude Code with the native installer, unless `claude` is already on PATH. The default version is the one the lock was tested with.
2. Runs `claude-workspace install` in the workspace folder.
3. Leaves you to run `claude-workspace doctor` to verify.

This step never fails container creation. If something goes wrong, it says so; fix it and run `claude-workspace repair`.

## Options

| Option | Default | Meaning |
|---|---|---|
| `source` | `bundled` | `bundled`: the CLI copy packaged with this feature. Anything else is an npx spec, e.g. `github:<owner>/<repo>#v0.12.1` |
| `marketplace` | empty | The marketplace source written to `.claude/settings.json`. **Set this for a team-shared repo** (e.g. `<owner>/<repo>#v0.12.1`). If left empty, the source is a container-only path. |
| `installClaudeCode` | `true` | Install Claude Code when it is missing |
| `claudeCodeVersion` | `tested` | `tested`, `latest`, or an exact version |
| `installOnCreate` | `true` | `false` installs the CLI only |

## Use

You can use the feature without a registry by copying it into the project's `.devcontainer/`. First build the payload with `npm run build:feature`, then copy `devcontainer/src/claude-workspace` to `.devcontainer/claude-workspace`:

```json
{
  "image": "mcr.microsoft.com/devcontainers/javascript-node:22",
  "remoteUser": "node",
  "features": { "./claude-workspace": { "marketplace": "Bey3fendi/claude-workspace#v0.12.1" } }
}
```

Once the feature is published to GHCR, reference it as `ghcr.io/bey3fendi/claude-workspace/claude-workspace:0` instead of the local path. A `v*` tag push publishes it (`.github/workflows/publish-feature.yml`).

### Logins and the host project

**Logins:** Claude Code's login is not part of the image. Run `claude` once inside the container to sign in.

**Files written to the host project:** the install writes `.claude/settings.json`, `.claude/settings.local.json`, the `.memory/` files and a `.gitignore` block in the mounted project. These are the same files a host install writes, and `claude-workspace uninstall` restores them.

## Test

```
npm run build:feature && tests/live/devcontainer/run.sh
```

The test needs Docker and uses no Claude model usage. It builds the image, runs the post-create step, then checks `doctor` and that a second install makes 0 changes.
