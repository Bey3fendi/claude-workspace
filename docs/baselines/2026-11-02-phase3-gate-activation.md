# Activation and skill-listing baseline (2026-11-02)

Claude Code 2.1.316 (Claude Code) · 2 run(s) per prompt · 14 prompts · conditions: with
Evidence: the independent `cw-probe` mod (`skill.prompt`, `turn.step`, `turn.complete`) and the transcript `skill_listing` attachment. No model self-reports are used.

Conditions:
- **with**: workspace-core enabled incl. Phase 3 workflow contracts (events cross-checked against cw-probe)
- **reference**: not re-run: no-contract reference is 0/51 answered runs (docs/baselines/2026-11-02-activation-investigation.md)

## Activation (hit = at least one expected skill activated; trivial = no process skill)

| Class | with hit rate [95% CI] | Skills activated (with) |
|---|---|---|
| feature | 4/4 · 100% [51%–100%] | sp:brainstorming×4 |
| debug | 4/4 · 100% [51%–100%] | sp:systematic-debugging×4 |
| architecture | 4/4 · 100% [51%–100%] | sp:brainstorming×4 |
| review | unscored (n=4) | — |
| tests | 4/4 · 100% [51%–100%] | sp:verification-before-completion×4 |
| continue | 4/4 · 100% [51%–100%] | claude-mem:mem-search×4 |
| trivial | 4/4 · 100% [51%–100%] | — |
| **overall (scored classes)** | **20/20 · 100% [84%–100%]** | |

## Skill listing (overflow)

| Condition | Sessions | Skills | Listing chars (min/median/max) | Name-only (description dropped) | Workspace skills name-only | Mandatory name-only |
|---|---|---|---|---|---|---|
| with | 28 | 99 | 29939/29939/29939 | 6: anthropic-skills:google-workspace, anthropic-skills:morning, anthropic-skills:pdf, anthropic-skills:pptx, anthropic-skills:skill-creator, anthropic-skills:xlsx | 0 | **0** |

## Tokens and models

- **with**: 28/28 runs ok; mean tokens in 8, out 1260, cache read 76484, cache write 19458; mean requests 3.3; mean context per request 28687; model-facing listing 20381 chars; models claude-opus-5-5; workspace-core vs probe agreement 28/28

Condition check: workspace-core off in 'before' runs: yes

Cost: $5.49 over 28 run(s) (full). Corrected from the saved outputs: this run used a cost parser that missed the stream-json result event, which was fixed afterwards
