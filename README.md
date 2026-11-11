# claude-workspace

A portable Claude Code workspace that is pinned, reversible and project-local. It installs these tools:
- [Superpowers](https://github.com/obra/superpowers)
- [Caveman](https://github.com/JuliusBrussee/caveman) (lite mode, plugin only)
- [claude-mem](https://github.com/thedotmack/claude-mem) (telemetry forced OFF)
- [Ponytail](https://github.com/DietrichGebert/ponytail)
- [Karpathy skills](https://github.com/multica-ai/andrej-karpathy-skills)

It also includes an optional, disabled-by-default model router.

**Status: Phase 6 (hardening) done; released on GitHub.** Phases 0–4 and 6 are done; Phase 5 (router) and the macOS run are deferred. See `docs/PLAN.md`.

## What workspace-core adds to every session
- **Workflow contracts:** a local keyword classifier attaches a short contract to each request (debug → systematic-debugging, feature → brainstorming, tests → TDD or verification, …). Measured: activation 20/20 vs 0/51 without.
- **Root-cause gate:** in a debug request, the first source edit is held until Claude states a root cause (max 2 holds per request; tests and docs are never held).
- **Compaction restore:** after a compaction, the request's contract is re-attached (noting what is already done).
- **Context pressure:** past 300K tokens of context, Claude is asked to recommend **CLEAR** or **COMPACT** at the next natural stopping point, with a cold-start handoff note to paste back. claude-mem re-injects recent memories after `/clear`.
- **Plan execution:** plans run in Superpowers' **Native** mode (`superpowers:executing-plans`): every task inline in the current session, then one fresh review of the whole branch. `superpowers:subagent-driven-development` is denied, and the method is stated at session start, so the plan handoff doesn't ask.
- **Workspace Usage footer:** an engine-verified line under each answer (skills activated, gate holds, pressure advice), shown to you, never sent to the model.

| Switch (environment) | Effect |
|---|---|
| `CW_CONTRACTS=0` | no contracts (and no compaction restore) |
| `CW_GATES=0` | no root-cause gate |
| `CW_CONTEXT_PRESSURE=0` | no context-pressure note |
| `CW_CONTEXT_PRESSURE_TOKENS=250000` | pressure threshold (default 300000) |
| `CW_LISTING_TRIM=0` | keep denied skills in the model-facing listing |
| `CW_PLAN_EXECUTION=0` | no plan-execution note (subagent mode stays denied; remove its rule in `policies/skill-denies.json` to allow it) |

A user-level hook command containing `context-pressure` (e.g. `~/.claude/hooks/context-pressure.sh`) takes precedence: workspace-core then adds no second note.

## Requirements
- Linux, macOS, WSL2, or a Linux devcontainer. Native Windows is not supported; use WSL.
- Node ≥ 22.13.
- Claude Code ≥ 2.1.290 (tested: 2.1.316, 2.1.317).
- git.

## Use
```bash
# straight from GitHub (pinned release; no checkout needed)
npx -y github:Bey3fendi/claude-workspace#v0.7.4 install --yes --marketplace Bey3fendi/claude-workspace#v0.7.4

# or from a checkout of this repo
node /path/to/claude-workspace/cli/bin/claude-workspace.mjs install --yes      # in your project
node /path/to/claude-workspace/cli/bin/claude-workspace.mjs doctor
node /path/to/claude-workspace/cli/bin/claude-workspace.mjs uninstall
```
For a team, install with `--marketplace Bey3fendi/claude-workspace#<tag>` (or your fork). Otherwise the committed `.claude/settings.json` holds this checkout's absolute path.

| Command | What it does |
|---|---|
| `install` | Idempotent. A second run makes zero changes. Refuses if files it would touch have uncommitted changes (override with `--allow-dirty`), or if a same-named plugin would load twice |
| `doctor` | Verifies pins, duplicates, deny rules, Caveman mode, the claude-mem runtime and worker health, and **claude-mem telemetry OFF**. Exits 1 on any failure |
| `repair` | Re-applies everything `install` does: refreshes the marketplace, updates workspace-core, reinstalls drifted pins, repairs the claude-mem runtime, and records the previous versions. `--marketplace <owner>/<repo>#<tag>` re-points to another release (update or rollback) |
| `uninstall` | Removes what the workspace added. A touched file nobody edited since install is restored **byte-for-byte**. An edited file loses only the workspace's own keys |
| `usage` | Prints the engine-verified Workspace Usage evidence for the latest session in this project (`--session <id>` for another). Reads local files only |
| `canary` | Read-only (network): compares every pin with upstream's latest release and npm, and reports local claude-mem drift |
| `rollback` | Prints the exact steps back to the previous recorded version (the pins live in that version's lock, so its own `repair` restores them) |

### Update and rollback
- **Update:** get the new workspace version (`git pull` in the checkout, or the new `Bey3fendi/claude-workspace#<tag>`), then run its `repair` in each project. The previous versions are recorded in `.claude/workspace/manifest.json`.
- **Rollback:** `claude-workspace rollback` prints the steps, e.g. `git -C <checkout> checkout <commit>` then `repair`, or `npx -y github:<owner>/<repo>#<old-tag> repair --marketplace <owner>/<repo>#<old-tag>`.
- **Before bumping pins:** `claude-workspace canary` shows what changed upstream; re-run the live suites (`tests/live/`) after a bump.

### Devcontainer

The devcontainer feature in [`devcontainer/`](devcontainer/README.md) installs the CLI into the image. When the container is created, it installs Claude Code and the workspace into the project folder. Build its payload with `npm run build:feature`.

## What it changes

**Project files** are the only files it touches:
- `.claude/settings.json`: Claude Code's own `extraKnownMarketplaces` and `enabledPlugins` entries, plus 37 `permissions.deny` skill rules from `policies/skill-denies.json`.
- `.caveman.json`: `{"defaultMode":"lite"}`. An existing file is never overwritten.
- `.claude/workspace.json`: a marker file meant to be committed.
- `.gitignore`: one managed block for `.claude/workspace/`.

Backups and the manifest live in `.claude/workspace/`, which is gitignored.

**User level**, only after consent (`--yes` or the interactive prompt):
- claude-mem, installed by its official pinned installer (`npx claude-mem@15.9.0 install --provider claude --no-auto-start`). It enables the plugin in `~/.claude/settings.json`, puts a launcher in `~/.local/bin`, and installs Bun (adding a PATH line to `~/.bashrc`) and uv.
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

## License

MIT, see [LICENSE](LICENSE). The plugins it installs (Superpowers, Caveman, Ponytail, Karpathy skills, claude-mem, the router) are separate projects under their own licenses; this repo pins them by commit and does not copy their code.
