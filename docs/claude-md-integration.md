# Spec: CLAUDE.md integration for claude-workspace

Status: implemented in 0.10.0 (2026-11-11; the user lifted the 19 Nov hold). Deviations and live results: docs/PLAN.md item 11.

## Goal

When `claude-workspace install` runs in a project, the model should learn the workspace's conventions (md-memory, workflow contracts, secrets) through the project's CLAUDE.md, without the installer ever rewriting text the user wrote.

## Design in one paragraph

The installer writes a file it fully owns, `.claude/workspace/CLAUDE.workspace.md`, and adds one **managed block** to the user's CLAUDE.md that imports it with Claude Code's `@path` syntax. Updates rewrite only the owned file. Uninstall removes only the block. Content outside the block is never read for meaning, reordered or changed.

## Files

| Path | Owner | Written by | Committed |
|---|---|---|---|
| `.claude/workspace/CLAUDE.workspace.md` | workspace | `install`, overwritten on every install/update | yes |
| `CLAUDE.md` (project root) | user | `install` adds or refreshes the managed block only | yes |
| `CLAUDE.local.md` | user | only with `--claude-md=local` | no (gitignored by Claude Code convention) |

## The managed block

Exactly these three lines, with the file's existing line endings (reuse the EOL handling in `cli/lib/gitignore.mjs`):

```md
<!-- >>> claude-workspace (managed) >>> -->
@.claude/workspace/CLAUDE.workspace.md
<!-- <<< claude-workspace (managed) <<< -->
```

HTML comments, not `#` lines: in Markdown a `#` line is a heading and would show up in the rendered file and in the model's context as one.

## Install behaviour

| Situation | Action | Report line |
|---|---|---|
| No `CLAUDE.md` | Create it containing only the block plus a trailing newline | `created CLAUDE.md with workspace import` |
| `CLAUDE.md` without the block | Append a blank line and the block at the end | `added workspace import to CLAUDE.md` |
| Block present and identical | Nothing | — |
| Block present but its import line was edited | Replace the block body with the canonical line; keep the position | `restored workspace import in CLAUDE.md` |
| Two or more blocks | Keep the first, remove the rest | `removed duplicate workspace import from CLAUDE.md` |
| Start marker without end marker (or the reverse) | **Do not write.** Exit non-zero with a message pointing at the line | — |
| `--no-claude-md` | Skip CLAUDE.md entirely; still write the owned file | `skipped CLAUDE.md (--no-claude-md)` |
| `--claude-md=local` | Same rules, target `CLAUDE.local.md` | as above, with the file name |
| `--dry-run` (if supported) | Print the actions, write nothing | as above, prefixed `would` |

Always write `.claude/workspace/CLAUDE.workspace.md` from the template, composed from the features that are actually installed (see the template's conditional sections).

## Uninstall behaviour

- Remove the managed block and at most one blank line directly before it.
- If the file is then empty or whitespace only **and** install had created it (record this in `.claude/workspace.json` as `claudeMdCreated: true`), delete it. Otherwise leave it.
- Delete `.claude/workspace/CLAUDE.workspace.md`.
- Never touch anything outside the markers.

## `doctor` checks

| Check | Result |
|---|---|
| Owned file exists and matches the template for the installed features | ok / `drift: CLAUDE.workspace.md differs from template` |
| Exactly one well-formed managed block in the target file | ok / missing / duplicate / malformed |
| Import line inside the block is canonical | ok / `edited` |
| Owned file length | warn above 100 lines with Karpathy, 40 without (token cost: CLAUDE.md is loaded every session) |
| Vendored Karpathy file | sha256 matches the lock |

`repair` fixes the first three the same way `install` would.

## Template: `.claude/workspace/CLAUDE.workspace.md`

Lines between `{{#if feature}}` and `{{/if}}` are included only when that feature is installed. The rendered file has no template markers left. Keep the workspace's own sections at or under about 25 lines; the vendored Karpathy guidelines add about 60 lines (about 600 tokens, cached after the first request).

```md
# Workspace defaults (claude-workspace {{version}}, managed file: do not edit)

These are defaults from claude-workspace. Where the project's own instructions say otherwise, follow the project.

{{#if mdMemory}}
## Memory
- `.claude/memory/session.md` is loaded at session start and after /clear and /compact; do not re-read it unless asked.
- After each verified unit of work, append a block to the bottom of session.md: goal, done (verified), decisions, ruled out, next step, files. Keep it short; the file is capped at 150 lines.
- A durable fact about a module goes in `.claude/memory/context.md`; a decision and its reason in `.claude/memory/decisions.md`. Every section needs `<!-- paths: glob, glob -->` or it is never loaded. Do not read these files in full; hooks inject the relevant sections.
- When the context-pressure note asks for a handoff, write it to session.md, not to the chat.
{{/if}}
{{#if contracts}}
## Workflow contracts
- Some requests carry a hidden workspace contract naming a skill to invoke first. Follow it unless it plainly does not fit; if you skip it, say why in Workspace Usage.
- Request classification reads English keywords only. If the user writes in another language and the request is clearly debugging, a new feature, a design question, tests or a review, invoke the skill the matching contract would name.
{{/if}}
## Secrets
- Never print, log or commit secrets. Keys live in `.env`, which must stay gitignored.
{{#if karpathy}}

## Coding guidelines (Karpathy)
<!-- Vendored from forrestchang/andrej-karpathy-skills@{{karpathyCommit}} CLAUDE.md, MIT License. Do not edit here; update the pin instead. -->
{{karpathyGuidelines}}
{{/if}}
```

What deliberately stays out, because something else already delivers it:
- The Workspace Usage reporting rule: workspace-core injects it into the system prompt.
- Skill descriptions and when to use them: that is `docs/CHEATSHEET.md`, for people only.
- Project-specific rules: those belong to the user's own CLAUDE.md.

## Karpathy guidelines: vendored instead of a plugin

The Karpathy guidelines move from a plugin skill (`andrej-karpathy-skills:karpathy-guidelines`) into the owned file, as upstream's README suggests ("Option B: CLAUDE.md").

**Why:**
- **Always applied.** As a skill they have to be invoked; in the workspace's own runs the skill never self-activated (0 of 45), and contracts only *suggest* it as a "then" step. In CLAUDE.md they are in every session without any call.
- **One fewer plugin** to pin, install and deny-list.

**Cost and trade-offs:**
- About 600 tokens per session, cached after the first request.
- They are always on, including for trivial tasks; upstream's own note says "for trivial tasks, use judgment", which is kept.
- **Observability changes.** There is no Skill call to observe any more, so "Applied: karpathy-guidelines" can no longer be verified per request. The footer can only say the guidelines were loaded. Judge their effect by outcomes (diff size, rewrites, questions asked before code), not by activation.
- **Overlap with Ponytail.** Both push toward minimal, surgical changes; they agree, so keep both. If you ever see conflicting advice, Ponytail's level setting should win for verbosity and Karpathy's sections for process (assumptions, success criteria).

**How to vendor:**
1. Pin the upstream commit in `workspace.lock.json` as a vendored file, not a plugin: `{ "name": "karpathy-guidelines", "kind": "vendored", "source": "github:forrestchang/andrej-karpathy-skills", "commit": "2c60614…", "path": "CLAUDE.md", "sha256": "…" }`.
2. Store the file in the workspace repo as `vendor/karpathy/CLAUDE.md` plus upstream's `LICENSE` text (MIT requires the notice to travel with the copy; upstream states MIT in its README and plugin manifest).
3. When rendering, drop upstream's `# CLAUDE.md` title line and demote its `##` headings to `###` so they nest under "Coding guidelines (Karpathy)". Keep the wording otherwise verbatim.
4. `doctor` verifies the vendored file's sha256 against the lock, like any other pin.

**Workspace changes this requires:**

| File | Change |
|---|---|
| `workspace.lock.json` | Remove the `andrej-karpathy-skills` plugin entry; add the vendored entry above |
| `plugins/workspace-core/lib/contracts.mjs` | Remove `KARPATHY` from the `then` lists of `debug` and `feature` (it no longer exists as a skill; the cheatsheet check would flag it) |
| `plugins/workspace-core/lib/usage.mjs` | Drop `karpathy-guidelines` from `KNOWN_BARE`; keep `Karpathy` in `INTEGRATIONS` but report it as "loaded via CLAUDE.md" |
| `plugins/workspace-core/lib/events.mjs` | The `/karpathy/gi` marker only scans hook-injected context, so CLAUDE.md content will not trigger it. Either detect the managed import at session start or accept that Karpathy shows as configured, not observed |
| `docs/cheatsheet.annotations.json` | Remove the `andrej-karpathy-skills:karpathy-guidelines` entry and its pair; add a one-line note that the guidelines are always on via CLAUDE.md |
| Tests | Template renders the vendored text with demoted headings and the attribution comment; contracts no longer reference the skill |

## Implementation notes

1. Generalise `cli/lib/gitignore.mjs` into a small `managed-block.mjs` with `upsert(text, body, {begin, end})`, `remove(text, {begin, end})` and `inspect(text) -> {count, wellFormed, body}`. Keep `gitignore.mjs` as a thin wrapper so its tests stay valid.
2. Add `cli/lib/claude-md.mjs`: render the template from the installed feature set (including the vendored Karpathy text, with demoted headings), and apply the install/uninstall tables above through `managed-block.mjs`.
3. Call it from `install.mjs` after the workspace marker (`.claude/workspace.json`) is written; record `claudeMdCreated` and the target file there.
4. Flags: `--no-claude-md`, `--claude-md=local`.
5. Write files only when the content changed (same pattern as `writeJsonIfChanged`), so re-running install is a no-op.

## Tests

- Every row of the install table, including CRLF files and a file without a trailing newline.
- Uninstall restores the original file byte for byte when install had appended the block.
- Uninstall deletes CLAUDE.md only when install created it and it is now empty.
- Malformed markers: install refuses and writes nothing.
- Template: each feature combination renders without leftover markers; rendered length stays within the limit.
- Idempotence: install twice gives the same bytes and no report lines on the second run.

## Acceptance check (manual, once)

On a fresh project, run install, start Claude Code and ask "what are the md-memory rules here?". The answer must come from the imported file. Also confirm whether Claude Code asks to approve the import the first time. If it does, document it in the README; it may only apply to imports outside the project.

## Open questions

- Should the import be added at the top of CLAUDE.md instead of the end? End is less intrusive; precedence is stated in the template's first line either way.
- Should `--claude-md=local` be the default for installs into repos the user does not own? Probably a prompt in interactive installs.
