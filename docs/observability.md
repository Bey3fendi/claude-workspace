# Workspace Usage reporting

The workspace answers one question per task: **which installed capabilities did Claude actually use, and can that be checked?** The answer is a short report, not a dashboard. No server runs, and there are no extra model calls.

## The two layers

1. **Model-written section (self-reported).**
   - `workspace-core` adds one short system-prompt section (`workspace-core:usage-report`, about 400 characters, roughly 100 tokens, cached per session).
   - It asks Claude to end substantive development replies with this section:
     ```
     Workspace Usage
     - Applied: superpowers:systematic-debugging (root cause before fix)
     - Active: Caveman (lite)
     - Not used: test-driven-development (no new code)
     ```
   - Trivial questions get no section.
2. **Engine footer (observed).**
   - The mod's `turn.complete` hook returns a single line, which is shown beneath the main-loop answer. For example:
     ```
     Verified by engine: activated superpowers:systematic-debugging · denied caveman:lean-build ·
     self-reported only (no engine event): superpowers:writing-plans (activation = instructions loaded, not proof they were followed)
     ```
   - The footer is never sent to the model. It is stored as a transcript notice row, and the model does not see it when the session resumes (verified 2026-11-02).
   - It appears only when a skill event happened or the reply has a Workspace Usage section.
   - `claude -p` does not print it. Use `claude-workspace usage` there.

## What counts as evidence

| Footer term | Engine signal | What it does *not* prove |
|---|---|---|
| activated | `skill.prompt` (the skill's instructions entered the context) | that they were followed |
| denied | Skill `tool.call` refused by a permission rule | — |
| failed | `PostToolUseFailure` for the Skill tool, or a non-permission error | — |
| context injected this session | content markers in hook-injected context (`session.append`, door `hook-context`) | that the integration shaped this task |
| self-reported only | a skill named on the model's `Applied:` line with no `skill.prompt` this request | — |
| activated but not reported | `skill.prompt` with no matching `Applied:` entry | — |

Installed or enabled is never reported as used.

## On demand

```bash
claude-workspace usage                 # latest session for this project
claude-workspace usage --session <id>  # or an id prefix; --json for the full evidence
```

## Storage and privacy

- Events go to `${XDG_STATE_HOME:-~/.local/state}/claude-workspace/events/<projectKey>/<session>.<run>.<seg>.jsonl`. `CW_EVENTS_DIR` overrides the base directory.
- The files are local and user-level, never inside the project.
- Rows are redacted for common secret shapes.
- Prompt text is not stored.
- What is recorded:
  - skill loads and outcomes;
  - injected-context sizes and markers;
  - request boundaries;
  - main-loop model and effort;
  - token usage;
  - the router's view (Phase 5);
  - the parsed `Applied:` claims;
  - the footer text.

## Limits

- **The parsing is heuristic.** Claims are read only from the `Applied:` line of a section headed "Workspace Usage". Full skill ids are recognised, plus a fixed list of bare Superpowers and Karpathy names.
- **Ambient integrations are visible only as injected context.** This covers Caveman, Ponytail and memory. Caveman injects only in interactive sessions.
- **Workflow compliance needs separate checks.** Whether Claude actually followed a workflow (for example, root cause before fix) is checked by the Phase 3 outcome evaluations, not by this report.
