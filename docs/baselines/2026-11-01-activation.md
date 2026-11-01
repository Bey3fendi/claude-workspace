# Activation and skill-listing baseline (2026-11-01)

Claude Code 2.1.316 (Claude Code) · 3 run(s) per prompt · 14 prompts · conditions: with, before, bare
Evidence: the independent `cw-probe` mod (`skill.prompt`, `turn.step`, `turn.complete`) and the transcript `skill_listing` attachment. No model self-reports are used.

Conditions:
- **before**: Phase 1 install; workspace-core disabled via --settings
- **with**: Phase 2: workspace-core enabled (events cross-checked against cw-probe)
- **bare**: listing reference: empty dir, no workspace plugins, claude-mem disabled (1 trivial prompt)

## Activation (hit = at least one expected skill activated; trivial = no process skill)

| Class | with hit rate [95% CI] | before hit rate [95% CI] | Skills activated (with / before) |
|---|---|---|---|
| feature | 0/4 · 0% [0%–49%] | 0/4 · 0% [0%–49%] | — / — |
| debug | 0/4 · 0% [0%–49%] | 0/4 · 0% [0%–49%] | — / — |
| architecture | 0/4 · 0% [0%–49%] | 0/4 · 0% [0%–49%] | — / — |
| review | 0/3 · 0% [0%–56%] | 0/3 · 0% [0%–56%] | — / — |
| tests | 0/2 · 0% [0%–66%] | 0/2 · 0% [0%–66%] | — / — |
| continue | 0/2 · 0% [0%–66%] | 0/2 · 0% [0%–66%] | — / — |
| trivial | 2/2 · 100% [34%–100%] | 2/2 · 100% [34%–100%] | — / — |
| **overall (scored classes)** | **0/19 · 0% [0%–17%]** | **0/19 · 0% [0%–17%]** | |

## Before vs with Phase 2

- Activation difference (with − before): 0.0 pts, 95% CI [-16.8, 16.8]
- Mean context per model request delta (input + cache read + cache write, divided by requests): 292 tokens
- Skill-listing median size delta: 0 chars

## Skill listing (overflow)

| Condition | Sessions | Skills | Listing chars (min/median/max) | Name-only (description dropped) | Workspace skills name-only | Mandatory name-only |
|---|---|---|---|---|---|---|
| with | 21 | 99 | 29939/29939/29939 | 6: anthropic-skills:google-workspace, anthropic-skills:morning, anthropic-skills:pdf, anthropic-skills:pptx, anthropic-skills:skill-creator, anthropic-skills:xlsx | 0 | **0** |
| before | 21 | 99 | 29939/29939/29939 | 6: anthropic-skills:google-workspace, anthropic-skills:morning, anthropic-skills:pdf, anthropic-skills:pptx, anthropic-skills:skill-creator, anthropic-skills:xlsx | 0 | **0** |
| bare | 0 | — | — | — | — | — |

## Tokens and models

- **with**: 21/42 runs ok; mean tokens in 6, out 1182, cache read 75931, cache write 12117; mean requests 2.9; mean context per request 29973; models claude-opus-5-5; workspace-core vs probe agreement 21/21; failed runs: review-2 (request ended: error (usage limit reached)); tests-1 (request ended: error (usage limit reached)); tests-2 (request ended: error (usage limit reached)); cont-1 (request ended: error (usage limit reached)); cont-2 (request ended: error (usage limit reached)); triv-1 (request ended: error (usage limit reached)); triv-2 (request ended: error (usage limit reached)); feat-1 (request ended: error (usage limit reached)); feat-2 (request ended: error (usage limit reached)); debug-1 (request ended: error (usage limit reached)); debug-2 (request ended: error (usage limit reached)); arch-1 (request ended: error (usage limit reached)); arch-2 (request ended: error (usage limit reached)); review-1 (request ended: error (usage limit reached)); review-2 (request ended: error (usage limit reached)); tests-1 (request ended: error (usage limit reached)); tests-2 (request ended: error (usage limit reached)); cont-1 (request ended: error (usage limit reached)); cont-2 (request ended: error (usage limit reached)); triv-1 (request ended: error (usage limit reached)); triv-2 (request ended: error (usage limit reached))
- **before**: 21/42 runs ok; mean tokens in 6, out 1158, cache read 66696, cache write 20150; mean requests 2.9; mean context per request 29682; models claude-opus-5-5; failed runs: tests-1 (request ended: error (usage limit reached)); review-2 (request ended: error (usage limit reached)); tests-2 (request ended: error (usage limit reached)); cont-1 (request ended: error (usage limit reached)); cont-2 (request ended: error (usage limit reached)); triv-1 (request ended: error (usage limit reached)); triv-2 (request ended: error (usage limit reached)); feat-1 (request ended: error (usage limit reached)); feat-2 (request ended: error (usage limit reached)); debug-1 (request ended: error (usage limit reached)); debug-2 (request ended: error (usage limit reached)); arch-1 (request ended: error (usage limit reached)); arch-2 (request ended: error (usage limit reached)); review-1 (request ended: error (usage limit reached)); review-2 (request ended: error (usage limit reached)); tests-1 (request ended: error (usage limit reached)); tests-2 (request ended: error (usage limit reached)); cont-1 (request ended: error (usage limit reached)); cont-2 (request ended: error (usage limit reached)); triv-1 (request ended: error (usage limit reached)); triv-2 (request ended: error (usage limit reached))
- **bare**: 0/1 runs ok; mean tokens in 0, out 0, cache read 0, cache write 0; mean requests 0.0; mean context per request 0; models ; failed runs: bare-1 (request ended: error (usage limit reached))

Condition check: workspace-core off in 'before' runs: yes

**Correction (2026-11-02).** 2026-11-02: runs whose request ended with reason=error (5-hour usage limit) were wrongly counted as ok; re-aggregated from the saved results. Half of the runs (42/84, including the bare run) hit the usage limit; the figures above use only the 42 answered runs.
