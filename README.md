# claude-workspace

A portable Claude Code workspace that is pinned, reversible and project-local. It installs these tools:
- [Superpowers](https://github.com/obra/superpowers)
- [Ponytail](https://github.com/DietrichGebert/ponytail)

It also writes a **default CLAUDE.md** for the project: one managed file, `.claude/workspace/CLAUDE.workspace.md`, imported from your `CLAUDE.md` with a three-line block. It holds the workspace's rules (memory, contracts, secrets) and the [Karpathy coding guidelines](https://github.com/multica-ai/andrej-karpathy-skills), vendored at a pinned commit (since 0.10.0 they are always loaded, no longer a skill to invoke).

Session-to-session memory is **md-memory**, built into workspace-core: plain Markdown files in `.memory/`, with no database, worker process or background model calls. It replaces claude-mem (0.8.0).

On request, **`/explain`** writes a short explanation of a change, built from facts the workspace records itself and checked mechanically (0.12.0). Every subagent, including Superpowers' final reviewer, runs on at most **Opus 5.5 at high effort** (0.11.0).

It also includes an optional, disabled-by-default model router.

**Status: Phase 6 (hardening) done; released on GitHub.** Phases 0–4 and 6 are done; Phase 5 (router) and the macOS run are deferred. See `docs/PLAN.md`.

**Start here:** [`WORKSPACE_DEVELOPER_GUIDE.md`](WORKSPACE_DEVELOPER_GUIDE.md) is the step-by-step playbook for new and existing projects, with every flag and switch. [`WORKSPACE_TEST_REPORT.md`](WORKSPACE_TEST_REPORT.md) is the latest validation round (2026-11-11: ready with limitations).

## What workspace-core adds to every session
- **Workflow contracts:** a local keyword classifier attaches a short contract to each request (debug → systematic-debugging, feature → brainstorming, tests → TDD or verification, …). Measured: activation 20/20 vs 0/51 without.
- **Root-cause gate:** in a debug request, the first source edit is held until Claude states a root cause (max 2 holds per request; tests and docs are never held).
- **Compaction restore:** after a compaction, the request's contract is re-attached (noting what is already done).
- **Context pressure:** past 300K tokens of context, Claude is asked to recommend **CLEAR** or **COMPACT** at the next natural stopping point, and to append a cold-start handoff to `.memory/session.md` first. Nothing has to be pasted back: the next session loads it.
- **md-memory:**
  - `.memory/session.md` is a rolling log, loaded at every session start (startup, resume, `/clear`, compaction) and trimmed to its newest 150 lines.
  - `context.md` and `decisions.md` hold `## ` sections tagged `<!-- paths: src/cart/** -->`. A section is injected once per session, the first time Claude reads or edits a matching file.
  - Before an automatic compaction, a git snapshot (last commit and changed files) is appended to the log.
  - Claude writes the notes itself, following short rules given at session start. The files are yours to read, edit and commit.
- **Plan execution:** plans run in Superpowers' **Native** mode (`superpowers:executing-plans`): every task inline in the current session, then one fresh review of the whole branch. `superpowers:subagent-driven-development` is denied, and the method is stated at session start, so the plan handoff doesn't ask.
- **Explain (`/explain`):** you ask for it, it writes a short explanation of a change for a reader who didn't watch the session. Nothing runs unless you type it, and nothing ever blocks.
  - `/explain` explains the uncommitted changes; `/explain HEAD` (or any commit) explains a commit. After a commit, the footer suggests it.
  - workspace-core builds a **change record** by code: the changed files and line ranges (git), the commands that ran with their exit codes, the skills used, new decisions in `.memory/decisions.md`. The model writes `.explain/units/u-NNNN.md` from it and shows you only the "In short" part.
  - A mechanical check runs when the file is saved: structure, cited `path:line`s inside the change, cited commands as recorded, every changed file named, no "tested" without a passing command, banned filler words, at most one diagram, at most 300 words outside `<details>`. Failures go back to the model at most twice; the footer shows the result (e.g. `explain u-0002: 8/8 checks`).
  - Local only: `.explain/` is gitignored. Commands are remembered in memory for the running session, so after a restart or `--resume` the record has no earlier commands (and says the change wasn't verified).
  - The checks prove the explanation points at the right places, not that its reasoning is correct.
- **Subagent cap:** every subagent request runs on at most **Opus 5.5 at high effort**. Superpowers sends its final whole-branch review to "the most capable available model" (Fable here), and a subagent may ask for `xhigh` or `max` effort; both are lowered. Cheaper choices (Sonnet, Haiku, lower effort) are kept, and the main conversation is never changed.
- **CLAUDE.md:**
  - `install` writes `.claude/workspace/CLAUDE.workspace.md` (owned by the workspace, rewritten on every install or repair, committed) and adds this block to `CLAUDE.md`, creating the file if needed:
    ```md
    <!-- >>> claude-workspace (managed) >>> -->
    @.claude/workspace/CLAUDE.workspace.md
    <!-- <<< claude-workspace (managed) <<< -->
    ```
  - Nothing outside the block is ever changed. Uninstall removes only the block (and deletes `CLAUDE.md` if install created it and nothing else is left). Broken markers stop the install with nothing written.
  - `--claude-md=local` puts the block in `CLAUDE.local.md` instead (not committed); `--no-claude-md` leaves your CLAUDE.md alone. Repair keeps the choice; `--claude-md=project` switches back.
  - The file is about 80 lines (roughly 1,000 tokens), loaded every session and cached after the first request. When it is imported, workspace-core does not repeat the md-memory rules at session start.
  - The guidelines have no skill call to observe, so the footer can only say they were loaded ("Karpathy guidelines (loaded via CLAUDE.md)"). Judge them by outcomes: diff size, rewrites, questions before code.
- **Workspace Usage footer:** an engine-verified line under each answer (skills activated, gate holds, pressure advice, Explain checks), shown to you, never sent to the model.

| Switch (environment) | Effect |
|---|---|
| `CW_CONTRACTS=0` | no contracts (and no compaction restore) |
| `CW_GATES=0` | no root-cause gate |
| `CW_CONTEXT_PRESSURE=0` | no context-pressure note |
| `CW_CONTEXT_PRESSURE_TOKENS=250000` | pressure threshold (default 300000) |
| `CW_LISTING_TRIM=0` | keep denied skills in the model-facing listing |
| `CW_MEMORY=0` | no md-memory (nothing loaded, injected, snapshotted or trimmed) |
| `CW_MEMORY_MAX_LINES=300` | session.md cap (default 150) |
| `CW_EXPLAIN=0` | no Explain (no command capture, `/explain` writes nothing) |
| `CW_EXPLAIN_WORDS=500` | Explain word budget outside `<details>` (default 300) |
| `CW_SUBAGENT_CAP=0` | no subagent cap (subagents may run on Fable or at xhigh/max effort) |
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
npx -y github:Bey3fendi/claude-workspace#v0.12.1 install --yes --marketplace Bey3fendi/claude-workspace#v0.12.1

# a project already on an older version: move it to this one
npx -y github:Bey3fendi/claude-workspace#v0.12.1 repair --marketplace Bey3fendi/claude-workspace#v0.12.1

# or from a checkout of this repo
node /path/to/claude-workspace/cli/bin/claude-workspace.mjs install --yes      # in your project
node /path/to/claude-workspace/cli/bin/claude-workspace.mjs doctor
node /path/to/claude-workspace/cli/bin/claude-workspace.mjs uninstall
```
For a team, install with `--marketplace Bey3fendi/claude-workspace#<tag>` (or your fork). Otherwise the committed `.claude/settings.json` holds this checkout's absolute path.

| Command | What it does |
|---|---|
| `install` | Idempotent. A second run makes zero changes. Refuses if files it would touch have uncommitted changes (override with `--allow-dirty`), or if a same-named plugin would load twice |
| `doctor` | Verifies pins, duplicates, deny rules, the memory files, the CLAUDE.md import and the allow rules for `.memory/` and `.explain/`, and warns if a leftover claude-mem is installed. Never writes. Exits 1 on any failure |
| `repair` | Re-applies everything `install` does: refreshes the marketplace, updates workspace-core, reinstalls drifted pins, restores missing memory files, removes what older versions added (deny rules, the Caveman plugin and an untouched `.caveman.json`), and records the previous versions. `--marketplace <owner>/<repo>#<tag>` re-points to another release (update or rollback) |
| `uninstall` | Removes what the workspace added. A touched file nobody edited since install is restored **byte-for-byte**. An edited file loses only the workspace's own keys. Other projects on the machine are never affected: the marketplace stays registered while another project uses it |
| `usage` | Prints the engine-verified Workspace Usage evidence for the latest session in this project (`--session <id>` for another). Reads local files only |
| `canary` | Read-only (network): compares every pin with upstream's latest release |
| `remove-claude-mem` | For projects set up before 0.8.0. Asks first (`--yes` to skip), then runs claude-mem's own uninstaller. That removes claude-mem at **user level** (every project). Its data in `~/.claude-mem` is kept |
| `rollback` | Prints the exact steps back to the previous recorded version (the pins live in that version's lock, so its own `repair` restores them) |

### Update and rollback
- **Update:** get the new workspace version (`git pull` in the checkout, or the new `Bey3fendi/claude-workspace#<tag>`), then run its `repair` in each project. The previous versions are recorded in `.claude/workspace/manifest.json`.
- **Rollback:** `claude-workspace rollback` prints the steps, e.g. `git -C <checkout> checkout <commit>` then `repair`, or `npx -y github:<owner>/<repo>#<old-tag> repair --marketplace <owner>/<repo>#<old-tag>`.
- **Before bumping pins:** `claude-workspace canary` shows what changed upstream; re-run the live suites (`tests/live/`) after a bump.

### Devcontainer

The devcontainer feature in [`devcontainer/`](devcontainer/README.md) installs the CLI into the image. When the container is created, it installs Claude Code and the workspace into the project folder. Build its payload with `npm run build:feature`.

## What it changes

**Project files** are the only files it touches:
- `.claude/settings.json`: Claude Code's own `extraKnownMarketplaces` and `enabledPlugins` entries, plus 1 `permissions.deny` skill rule from `policies/skill-denies.json`.
- `CLAUDE.md` (or `CLAUDE.local.md`): the managed import block only. `.claude/workspace/CLAUDE.workspace.md`: the owned file it imports.
- `.memory/session.md`, `context.md`, `decisions.md`: created as templates if missing; existing ones are never overwritten. Uninstall removes only the templates nobody wrote in. The folder is not under `.claude/`, because Claude Code asks before every edit there (and a headless run cannot write there at all).
- `.claude/settings.local.json` (per user, gitignored): two `permissions.allow` rules, `Edit(.memory/**)` and `Edit(.explain/**)` (each covers every file-editing tool), so Claude updates the memory files and writes `/explain` files without asking. It is not in `settings.json`, because Claude Code ignores allow rules in the shared, committed settings.
- `.claude/workspace.json`: a marker file meant to be committed.
- If claude-mem is still installed at user level, `enabledPlugins["claude-mem@thedotmack"]: false` in this project, so two memory systems never run together. Uninstall removes that key.
- `.explain/`: created only when you run `/explain` (`records/` and `units/`); never committed.
- `.gitignore`: one managed block that ignores `.claude/workspace/*` except `CLAUDE.workspace.md` (your committed CLAUDE.md imports it), `.claude/settings.local.json` and `.explain/`.

Backups and the manifest live in `.claude/workspace/`, which is gitignored.

**User level:** nothing. `install` no longer touches `~/`. Only `remove-claude-mem`, after you confirm it, runs claude-mem's uninstaller; its output goes to `~/.local/state/claude-workspace/logs/`.

## Development
```bash
npm test                    # node:test, hermetic (fake claude/npx), runs on Linux/WSL/macOS
npm run gen:marketplace     # regenerate .claude-plugin/marketplace.json from workspace.lock.json
claude plugin validate .    # marketplace; plugins/workspace-core with --strict
```

## License

MIT, see [LICENSE](LICENSE). The plugins it installs (Superpowers, Ponytail, the router) are separate projects under their own licenses; this repo pins them by commit and does not copy their code. The one exception is the Karpathy guidelines, copied unmodified into `vendor/karpathy/` under their MIT license (notice in `vendor/karpathy/LICENSE`).
