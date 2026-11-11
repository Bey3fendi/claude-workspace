# claude-workspace: developer guide

A practical playbook for using claude-workspace 0.13.0 in a new project (Section A) or in an existing one (Section B). Everything here was run on WSL2 against 0.12.0 plus the fixes released as 0.13.0, with Claude Code 2.1.317 (see `WORKSPACE_TEST_REPORT.md`). Steps that were not run are marked **(not validated)**.

**What you get:** pinned Superpowers and Ponytail plugins, plus `workspace-core`. workspace-core adds:
- workflow contracts and a root-cause gate;
- md-memory in `.memory/` and a context-pressure note;
- `/explain`;
- a cap that holds every subagent to Opus 5.5 at high effort;
- an engine-verified footer under each answer.

It also adds a managed `CLAUDE.md` import that brings in the vendored Karpathy guidelines.

---

## Section A: a new project

### A1. Prerequisites

| Need | Check |
|---|---|
| Linux, WSL2 or a Linux devcontainer (native Windows is not supported) | `uname -a` |
| Node ≥ 22.13 | `node -v` (older versions are refused with a message; Node < 14 crashes before it can print one) |
| Claude Code ≥ 2.1.290, signed in | `claude --version` |
| git | `git --version` |

### A2. Create the project and install

```bash
mkdir my-app && cd my-app
git init && git commit --allow-empty -m init      # install refuses to overwrite uncommitted files, so start clean
npx -y github:Bey3fendi/claude-workspace#v0.13.0 install --yes --marketplace Bey3fendi/claude-workspace#v0.13.0
```

Use the same tag in both places. `--marketplace` writes a GitHub source into `.claude/settings.json`, so teammates who clone the repo get the same pinned plugins. Without it, the file stores the absolute path of the CLI's checkout, which is fine only for a solo setup.

**Expected:** about 13 `+` lines and `doctor: all required checks passed`.

### A3. What was created (commit it)

| Path | Commit? | Purpose |
|---|---|---|
| `.claude/settings.json` | yes | enables the 3 plugins, declares the marketplace, 1 deny rule |
| `.claude/workspace.json` | yes | marker (version, CLAUDE.md target) |
| `CLAUDE.md` | yes | 3-line managed block importing the file below |
| `.claude/workspace/CLAUDE.workspace.md` | yes | the workspace rules plus the Karpathy guidelines (about 80 lines, owned by the workspace: don't edit it) |
| `.memory/session.md`, `context.md`, `decisions.md` | yes | project memory (plain Markdown) |
| `.gitignore` block | yes | ignores `.claude/workspace/*` except the file above, `.claude/settings.local.json` and `.explain/` |
| `.claude/settings.local.json` | no (ignored) | allow rules `Edit(.memory/**)` and `Edit(.explain/**)` |

```bash
git add -A && git commit -m "Add claude-workspace"
npx -y github:Bey3fendi/claude-workspace#v0.13.0 doctor     # exit 0 = healthy
```

### A4. Daily workflow

Start `claude` in the project folder and work normally. The behaviours below were all observed live.

| You do | The workspace does |
|---|---|
| Ask for a feature ("Add a bulk discount…") | attaches a contract; Claude loads `superpowers:brainstorming` and asks before coding |
| Report a failing test ("The test X fails. Fix it.") | attaches a contract; Claude loads `superpowers:systematic-debugging`; the first source edit is held until Claude states a root cause |
| Start or resume a session, or run `/clear` or `/compact` | `.memory/session.md` is loaded; sections of `context.md` and `decisions.md` tagged `<!-- paths: src/** -->` are injected when a matching file is touched |
| Work for a long time (more than 300K tokens of context) | Claude is told to recommend CLEAR or COMPACT and to write a handoff to `session.md` first |
| Execute a written plan | Native mode: tasks run inline, then one review. `subagent-driven-development` is denied **(not re-validated in this run)** |
| Any subagent (including the final reviewer) | runs on at most Opus 5.5 at `high` effort; Fable and `xhigh`/`max` are lowered |
| `/explain` | writes `.explain/units/u-NNNN.md` from a record captured by code (diff, commands and exit codes) and shows you the "In short" part |
| `/explain HEAD` (or any commit) | the same for a commit; the footer suggests it after Claude commits |

Read the **footer** under each answer ("Verified by engine: …"). It lists what really loaded, holds and checks, and flags claims the model made that no engine event backs up.

**Memory etiquette:** keep `session.md` short (it is capped at 150 lines; the oldest blocks are dropped). Most of it fills itself: a request that changes files and leaves no block gets a facts-only one from the workspace, and a designed change is asked once to record its decisions. Claude's own blocks are better (only Claude knows the next step), so ask for a handoff before you stop. Put durable facts in `context.md` and choices in `decisions.md`, each section with a `<!-- paths: … -->` tag, or it is never loaded.

### A5. Test, debug, deliver

- Run your project's own test command as usual. Explain counts a test run only if it happened after the last edit, and it flags piped commands (`npm test | tail`), whose exit code belongs to the last stage.
- Before a PR: `/explain HEAD`, then read `.explain/units/…`. A failed check shows in the footer, for example `explain u-0002: 6/8 checks (failed: coverage)`.
- `npx -y github:Bey3fendi/claude-workspace#v0.13.0 usage` replays the engine evidence of the latest session.

### A6. Troubleshooting

| Symptom | Fix |
|---|---|
| `doctor` shows `x` or `!` | `npx -y github:Bey3fendi/claude-workspace#v0.13.0 repair` (restores memory files, allow rules, the owned file and the pins) |
| install: "uncommitted changes in files the workspace would modify" | commit or stash them, or add `--allow-dirty` (your text is kept and backed up) |
| install: "… is not valid JSON" | fix the JSON in `.claude/settings.json` or `settings.local.json` (nothing is written until it parses) |
| install: "line N: …" about CLAUDE.md markers | repair or delete the half-written `claude-workspace (managed)` block |
| Claude asks before every `.memory/` or `/explain` write | `.claude/settings.local.json` is missing its rules: run `repair` |
| No context-pressure note | expected if you have a user-level `context-pressure` hook: yours takes precedence |
| Switch something off | set an environment variable before starting `claude` (all of them: Section C2) |

### A7. Do and don't

- **Do** commit `.claude/settings.json`, `CLAUDE.md`, `.claude/workspace/CLAUDE.workspace.md` and `.memory/`.
- **Do** pin a tag in `--marketplace`, and use the same tag for every command.
- **Don't** edit `CLAUDE.workspace.md`: `repair` rewrites it. Put your rules in `CLAUDE.md` outside the managed block.
- **Don't** commit `.claude/settings.local.json` or `.explain/`. They are per-developer.

---

## Section B: an existing project

The workflow is the same as in Section A. What differs is safety: the workspace has to fit around files you already have.

### B1. Assess first

```bash
git status                      # must be clean for the files the workspace touches
ls CLAUDE.md CLAUDE.local.md .claude/settings.json .claude/settings.local.json .gitignore 2>/dev/null
claude plugin list              # a plugin with the same name installed at user scope blocks install (doctor names it)
```

Decide where the import goes:

| You want | Flag |
|---|---|
| shared with the team (default) | none (`CLAUDE.md`) |
| only on your machine | `--claude-md=local` (`CLAUDE.local.md`, not committed) |
| leave your CLAUDE.md alone | `--no-claude-md`, then add `@.claude/workspace/CLAUDE.workspace.md` to it yourself |

### B2. Install

```bash
git switch -c add-claude-workspace       # optional: review the diff before merging
npx -y github:Bey3fendi/claude-workspace#v0.13.0 install --yes --marketplace Bey3fendi/claude-workspace#v0.13.0
git diff                                  # review
```

Verified guarantees:
- Your `CLAUDE.md` text (including CRLF line endings) is kept, and the block is appended after it.
- Your keys in `settings.json` (`model`, `permissions`, `hooks`, …) and in `settings.local.json` stay, with the workspace keys added.
- Your `.gitignore` lines stay, with the managed block appended.
- Source files are never touched. Existing `.memory/` files are never overwritten.
- Paths with spaces work.

### B3. Fit it to your tools

- **Your own `CLAUDE.md` rules** stay in force. The workspace file is imported alongside them.
- **Your own hooks** in `settings.json` are kept. A user-level `context-pressure` hook replaces the built-in note.
- **A memory plugin you already use** (claude-mem): doctor warns. The project switches it off so that two memory systems never run together. `remove-claude-mem` removes it for the user **(not validated: changes user-level state)**.
- **Devcontainer:** add the feature to `.devcontainer/devcontainer.json`. The live test used the feature from a local folder; the GHCR copy was published but not exercised **(not validated)**:
  ```json
  "features": { "ghcr.io/bey3fendi/claude-workspace/claude-workspace:0": { "marketplace": "Bey3fendi/claude-workspace#v0.13.0" } }
  ```

### B4. Validate the integration

```bash
npx -y github:Bey3fendi/claude-workspace#v0.13.0 doctor      # exit 0
claude -p "What is the next step in the project session log?"   # md-memory is loaded (once you have written a block)
```

Then make one real change with Claude and confirm that the footer appears under the answer.

### B5. Keep going, update, roll back

```bash
# update to a newer release (moves the marketplace, adds new rules, keeps your files)
npx -y github:Bey3fendi/claude-workspace#<new-tag> repair --marketplace Bey3fendi/claude-workspace#<new-tag>
# see the exact way back
npx -y github:Bey3fendi/claude-workspace#<new-tag> rollback
# remove everything the workspace added (your notes in .memory/ and .explain/ are kept)
npx -y github:Bey3fendi/claude-workspace#<tag> uninstall
```

Verified:
- 0.11.0 → 0.12.0 → back to 0.11.0, with doctor OK at each step.
- `uninstall` restores untouched files byte-for-byte.
- On edited files, uninstall removes only the workspace's keys and block.
- Uninstalling one project never affects another project on the same machine.

### B6. Mistakes to avoid

| Mistake | Effect | Instead |
|---|---|---|
| installing on a dirty tree with `--allow-dirty` by reflex | your uncommitted text ends up mixed with the install diff | commit first |
| different tags in `npx …#tag` and `--marketplace …#tag` | the plugins come from a different release than the CLI that installed them (not tested) | use one tag |
| no `--marketplace` in a team repo | `settings.json` holds your local path | always pass `--marketplace owner/repo#tag` |
| expecting `/explain` to prove correctness | its checks prove citations and recorded commands, not the reasoning | read the "Not done / not tested" section |
| re-pointing back and forth | `settings.json` key order changes (content is the same) | commit after each re-point, or ignore the diff |

---

## Section C: every flag and switch

"Tested" says how each item was checked: **live** (a real run in this test round), **auto** (the automated npm or engine tests), or **no** (not validated).

### C1. CLI options

Use them with the CLI, e.g. `npx -y github:Bey3fendi/claude-workspace#v0.13.0 <command> [options]`, or `node <checkout>/cli/bin/claude-workspace.mjs <command> [options]`.

| Option | Used by | Effect | Tested |
|---|---|---|---|
| `--project <dir>` | every command | the project folder (default: the current directory); a missing folder is an error | live |
| `--marketplace <src>` | `install`, `repair` | the marketplace written to `.claude/settings.json`: `owner/repo#tag`, a git or https URL, or a local path (default: the CLI's own checkout). On `repair`, a different source re-points the project (update or rollback) | live (`owner/repo#tag`, default path); URL form: no |
| `--yes`, `-y` | `install`, `remove-claude-mem` | answer yes to confirmations | live (`install`) |
| `--allow-dirty` | `install`, `repair` | proceed although files the workspace touches have uncommitted changes; a byte-exact backup is still taken | live |
| `--claude-md=project` / `--claude-md project` | `install`, `repair` | put the import block in `CLAUDE.md` (the default); also moves it back from `CLAUDE.local.md` | live |
| `--claude-md=local` / `--claude-md local` | `install`, `repair` | put the import block in `CLAUDE.local.md` (not committed); `repair` keeps the choice | live |
| `--no-claude-md` | `install`, `repair` | leave `CLAUDE.md` alone; the workspace file is still written, and doctor reminds you to import it | live |
| `--session <id>` | `usage` | show one session (an id or a prefix) instead of the latest | no |
| `--json` | every command | print one JSON document (`changes`, `warnings`, `failures`, `ok`) instead of lines | auto |
| `--version`, `-v` | (no command) | print the workspace version (0.12.0 printed the help text instead; fixed in 0.12.1) | live (after the fix) |
| `--help`, `-h` | (no command) | print commands and options | live |
| `--no-claude-mem`, `--remove-claude-mem`, `--no-fix` | – | accepted and ignored since 0.8.0, so older scripts keep working | no |

Commands: `install`, `doctor`, `repair`, `uninstall`, `usage`, `canary`, `rollback`, `remove-claude-mem` (Section A and B show each in use; `remove-claude-mem` was not validated).

Exit codes (live):
- `0`: success.
- `1`: a check or step failed (doctor failures, refusals such as a dirty tree or invalid JSON, nothing to uninstall, an unknown command).
- `2`: an option error (unknown option, a bad `--claude-md` value, an option missing its value) or no command at all.

### C2. Session switches (workspace-core)

Set these in the shell that starts `claude` (e.g. `CW_GATES=0 claude`). Each takes effect for that session. Setting them in the `env` key of `settings.json` was not validated.

| Variable | Default | Effect | Tested |
|---|---|---|---|
| `CW_CONTRACTS=0` | on | no workflow contracts, and so no compaction restore | no |
| `CW_GATES=0` | on | no root-cause gate in debug requests | no |
| `CW_CONTEXT_PRESSURE=0` | on | no context-pressure note | no |
| `CW_CONTEXT_PRESSURE_TOKENS=<n>` | 300000 | the context size (tokens) at which the pressure note is attached; `CONTEXT_PRESSURE_TOKENS` is read when this is unset | live (1000) |
| `CW_LISTING_TRIM=0` | on | keep denied skills in the skill listing Claude sees | no |
| `CW_MEMORY=0` | on | no md-memory: nothing is loaded, injected, snapshotted or trimmed | auto |
| `CW_MEMORY_MAX_LINES=<n>` | 150 | the `session.md` cap (the oldest blocks are dropped); `MD_MEMORY_MAX_LINES` is read when this is unset | auto |
| `CW_MEMORY_PREEDIT=0` | on | notes for a file arrive only with a read; the first edit of a file with unseen notes is no longer held | live |
| `CW_MEMORY_AUTOLOG=0` | on | no facts-only `session.md` block at the end of a request that changed files | live |
| `CW_MEMORY_NUDGE=0` | on | no end-of-request request to record the decisions of a designed change | live |
| `CW_EXPLAIN=0` | on | no Explain: no command capture, and `/explain` writes nothing | auto |
| `CW_EXPLAIN_WORDS=<n>` | 300 | the `/explain` word budget outside `<details>` (100–2000; other values fall back to 300) | auto |
| `CW_SUBAGENT_CAP=0` | on | no subagent cap: subagents may run on Fable or at `xhigh`/`max` effort | auto |
| `CW_PLAN_EXECUTION=0` | on | no plan-execution note (subagent mode stays denied; remove its rule in `policies/skill-denies.json` to allow it) | auto |
| `CW_EVENTS_DIR=<dir>` | `$XDG_STATE_HOME/claude-workspace/events`, else `~/.local/state/claude-workspace/events` | where workspace-core writes its local event log; `usage` reads the same variable | live |

A user-level hook whose command contains `context-pressure` (e.g. `~/.claude/hooks/context-pressure.sh`) takes precedence over the built-in note (live).

### C3. CLI environment (advanced)

| Variable | Default | Effect | Tested |
|---|---|---|---|
| `CLAUDE_CONFIG_DIR` | `~/.claude` | the Claude Code config the CLI reads and changes (plugin registry, marketplaces); point it at a scratch folder to try the workspace in isolation | live |
| `XDG_STATE_HOME` | `~/.local/state` | base folder for the CLI's state and the default event log | no |
| `CW_MANAGED_SETTINGS_DIR` | `/etc/claude-code` (macOS: `/Library/Application Support/ClaudeCode`) | where managed (organization) settings are looked for when checking for duplicate plugins | auto |
| `CW_CLAUDE_BIN`, `CW_NPX_BIN` | `claude`, `npx` | the binaries the CLI runs (the test suite points them at fakes) | auto |

When `ANTHROPIC_BASE_URL` is set, `install` warns that a proxy may already route models (this is a check, not a switch).

### C4. Devcontainer feature options

Set them in `.devcontainer/devcontainer.json` under the feature, e.g. `{ "marketplace": "Bey3fendi/claude-workspace#v0.13.0", "installOnCreate": true }`.

| Option | Default | Effect | Tested |
|---|---|---|---|
| `source` | `bundled` | where the CLI comes from: the copy packaged with the feature, or an npx spec such as `github:Bey3fendi/claude-workspace#v0.13.0` | live (default) |
| `marketplace` | empty | the marketplace written to the project's `.claude/settings.json`; set it for a team repo (empty means a container-only path) | live (default) |
| `installClaudeCode` | `true` | install Claude Code with the native installer when `claude` is not on PATH | live (default) |
| `claudeCodeVersion` | `tested` | `tested` (the version in the lock), `latest`, or an exact version | live (default: 2.1.317) |
| `installOnCreate` | `true` | run `claude-workspace install` on the workspace folder when the container is created; `false` installs only the CLI | live (default) |
