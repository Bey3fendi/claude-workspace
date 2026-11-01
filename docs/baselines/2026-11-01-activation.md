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
| feature | 0/6 · 0% [0%–39%] | 0/6 · 0% [0%–39%] | — / — |
| debug | 0/6 · 0% [0%–39%] | 0/6 · 0% [0%–39%] | — / — |
| architecture | 0/6 · 0% [0%–39%] | 0/6 · 0% [0%–39%] | — / — |
| review | 0/6 · 0% [0%–39%] | 0/6 · 0% [0%–39%] | — / — |
| tests | 0/6 · 0% [0%–39%] | 0/6 · 0% [0%–39%] | — / — |
| continue | 0/6 · 0% [0%–39%] | 0/6 · 0% [0%–39%] | — / — |
| trivial | 6/6 · 100% [61%–100%] | 6/6 · 100% [61%–100%] | — / — |
| **overall (scored classes)** | **0/36 · 0% [0%–10%]** | **0/36 · 0% [0%–10%]** | |

## Before vs with Phase 2

- Activation difference (with − before): 0.0 pts, 95% CI [-9.6, 9.6]
- Mean context per model request delta (input + cache read + cache write, divided by requests): -196 tokens
- Skill-listing median size delta: 0 chars

## Skill listing (overflow)

| Condition | Sessions | Skills | Listing chars (min/median/max) | Name-only (description dropped) | Workspace skills name-only | Mandatory name-only |
|---|---|---|---|---|---|---|
| with | 42 | 99 | 29939/29939/29939 | 6: anthropic-skills:google-workspace, anthropic-skills:morning, anthropic-skills:pdf, anthropic-skills:pptx, anthropic-skills:skill-creator, anthropic-skills:xlsx | 0 | **0** |
| before | 42 | 99 | 29939/29939/29939 | 6: anthropic-skills:google-workspace, anthropic-skills:morning, anthropic-skills:pdf, anthropic-skills:pptx, anthropic-skills:skill-creator, anthropic-skills:xlsx | 0 | **0** |
| bare | 1 | 26 | 16099/16099/16099 | 0: — | 0 | **0** |

## Tokens and models

- **with**: 42/42 runs ok; mean tokens in 3, out 595, cache read 38224, cache write 6485; mean requests 2.0; mean context per request 15329; models claude-opus-5-5; workspace-core vs probe agreement 42/42
- **before**: 42/42 runs ok; mean tokens in 3, out 588, cache read 33864, cache write 10928; mean requests 2.0; mean context per request 15525; models claude-opus-5-5
- **bare**: 1/1 runs ok; mean tokens in 0, out 0, cache read 0, cache write 0; mean requests 1.0; mean context per request 0; models claude-opus-5-5

Condition check: workspace-core off in 'before' runs: yes
