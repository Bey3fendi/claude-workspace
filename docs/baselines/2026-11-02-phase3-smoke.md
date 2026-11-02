# Activation and skill-listing baseline (2026-11-02)

Claude Code 2.1.316 (Claude Code) · 1 run(s) per prompt · 7 prompts · conditions: with
Evidence: the independent `cw-probe` mod (`skill.prompt`, `turn.step`, `turn.complete`) and the transcript `skill_listing` attachment. No model self-reports are used.

Conditions:
- **with**: workspace-core enabled incl. Phase 3 workflow contracts (events cross-checked against cw-probe)
- **reference**: not re-run: no-contract reference is 0/51 answered runs (docs/baselines/2026-11-02-activation-investigation.md)

## Activation (hit = at least one expected skill activated; trivial = no process skill)

| Class | with hit rate [95% CI] | Skills activated (with) |
|---|---|---|
| feature | 1/1 · 100% [21%–100%] | sp:brainstorming×1 |
| debug | 1/1 · 100% [21%–100%] | sp:systematic-debugging×1 |
| architecture | 1/1 · 100% [21%–100%] | sp:brainstorming×1 |
| review | unscored (n=1) | — |
| tests | 1/1 · 100% [21%–100%] | sp:verification-before-completion×1 |
| continue | 1/1 · 100% [21%–100%] | claude-mem:mem-search×1 |
| trivial | 1/1 · 100% [21%–100%] | — |
| **overall (scored classes)** | **5/5 · 100% [57%–100%]** | |

## Skill listing (overflow)

| Condition | Sessions | Skills | Listing chars (min/median/max) | Name-only (description dropped) | Workspace skills name-only | Mandatory name-only |
|---|---|---|---|---|---|---|
| with | 7 | 99 | 29939/29939/29939 | 6: anthropic-skills:google-workspace, anthropic-skills:morning, anthropic-skills:pdf, anthropic-skills:pptx, anthropic-skills:skill-creator, anthropic-skills:xlsx | 0 | **0** |

## Tokens and models

- **with**: 7/7 runs ok; mean tokens in 7, out 1225, cache read 64479, cache write 23771; mean requests 2.7; mean context per request 32235; models claude-opus-5-5; workspace-core vs probe agreement 7/7

Condition check: workspace-core off in 'before' runs: yes

Cost: $1.59 over 7 run(s) (smoke)

## Notes

- **Every revised contract worked once each.** review was outcome-only and the model chose no skill; tests picked `verification-before-completion` for coverage of existing code.
- **feat-1 has no Workspace Usage section.** Brainstorming ended the turn with a clarifying question, so the turn wasn't the end of a substantive task. This is acceptable, but should be watched.
- **Harness limits** were stated honestly in each run's report:
  - `mem-search` loaded but its MCP search tool isn't in `--allowedTools`;
  - tests couldn't be run read-only.
  The outcome checks (§6) need a write-enabled harness.
- **This is a smoke check only:** n=1 per class.
