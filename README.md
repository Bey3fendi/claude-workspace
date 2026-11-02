# claude-workspace

A portable Claude Code workspace that is pinned, reversible and project-local. It installs these tools:
- [Superpowers](https://github.com/obra/superpowers)
- [Caveman](https://github.com/JuliusBrussee/caveman) (lite mode, plugin only)
- [claude-mem](https://github.com/thedotmack/claude-mem) (telemetry forced OFF)
- [Ponytail](https://github.com/DietrichGebert/ponytail)
- [Karpathy skills](https://github.com/multica-ai/andrej-karpathy-skills)

It also includes an optional, disabled-by-default model router.

**Status: Phase 2R (Workspace Usage reporting).** Phases 0–1 are done. See `docs/PLAN.md` and `docs/observability.md`.

## Requirements
- Linux, macOS, WSL2, or a Linux devcontainer. Native Windows is not supported; use WSL.
- Node ≥ 22.13.
- Claude Code ≥ 2.1.290 (tested: 2.1.316).
- git.

## Use
```bash
# from a checkout of this repo
node /path/to/claude-workspace/cli/bin/claude-workspace.mjs install --yes      # in your project
node /path/to/claude-workspace/cli/bin/claude-workspace.mjs doctor
node /path/to/claude-workspace/cli/bin/claude-workspace.mjs uninstall
```
For a team, publish this repo and install with `--marketplace <owner>/<repo>#<tag>`. Otherwise the committed `.claude/settings.json` holds this checkout's absolute path.

| Command | What it does |
|---|---|
| `install` | Idempotent. A second run makes zero changes. Refuses if files it would touch have uncommitted changes (override with `--allow-dirty`), or if a same-named plugin would load twice |
| `doctor` | Verifies pins, duplicates, deny rules, Caveman mode, the claude-mem runtime and worker health, and **claude-mem telemetry OFF**. Exits 1 on any failure |
| `repair` | Re-applies everything `install` does, reinstalls drifted pins, and repairs the claude-mem runtime |
| `uninstall` | Removes what the workspace added. A touched file nobody edited since install is restored **byte-for-byte**. An edited file loses only the workspace's own keys |
| `usage` | Prints the engine-verified Workspace Usage evidence for the latest session in this project (`--session <id>` for another). Reads local files only |

## What it changes

**Project files** are the only files it touches:
- `.claude/settings.json`: Claude Code's own `extraKnownMarketplaces` and `enabledPlugins` entries, plus 36 `permissions.deny` skill rules from `policies/skill-denies.json`.
- `.caveman.json`: `{"defaultMode":"lite"}`. An existing file is never overwritten.
- `.claude/workspace.json`: a marker file meant to be committed.
- `.gitignore`: one managed block for `.claude/workspace/`.

Backups and the manifest live in `.claude/workspace/`, which is gitignored.

**User level**, only after consent (`--yes` or the interactive prompt):
- claude-mem, installed by its official pinned installer (`npx claude-mem@15.8.0 install --provider claude --no-auto-start`). It enables the plugin in `~/.claude/settings.json`, puts a launcher in `~/.local/bin`, and installs Bun (adding a PATH line to `~/.bashrc`) and uv.
- The installer's output goes to `~/.local/state/claude-workspace/logs/` and is never shown. Upstream output contains agent-directed instructions.

**Telemetry:**
- `claude-mem telemetry disable` runs during install and is re-checked by every `doctor` run.
- This is a **user-level** setting: it applies to every project that uses claude-mem.
- `doctor` fails if `CLAUDE_MEM_TELEMETRY=1|true|on` is set in any of these places: the environment, any Claude Code settings `env` block (managed, user, project, local), or a shell rc file. It reports where; it never edits those files.
- We never set `DO_NOT_TRACK`.

## Development
```bash
npm test                    # node:test, hermetic (fake claude/npx), runs on Linux/WSL/macOS
npm run gen:marketplace     # regenerate .claude-plugin/marketplace.json from workspace.lock.json
claude plugin validate .    # marketplace; plugins/workspace-core with --strict
```
