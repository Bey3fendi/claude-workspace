# Activation and skill-listing baseline (2026-11-02)

Claude Code 2.1.316 (Claude Code) · 1 run(s) per prompt · 14 prompts · conditions: with, nocontract
Evidence: the independent `cw-probe` mod (`skill.prompt`, `turn.step`, `turn.complete`) and the transcript `skill_listing` attachment. No model self-reports are used.

Conditions:
- **nocontract**: workspace-core enabled, Phase 3 contracts off (CW_CONTRACTS=0)
- **with**: workspace-core enabled incl. Phase 3 workflow contracts (events cross-checked against cw-probe)

## Activation (hit = at least one expected skill activated; trivial = no process skill)

| Class | with hit rate [95% CI] | nocontract hit rate [95% CI] | Skills activated (with / nocontract) |
|---|---|---|---|
| feature | 2/2 · 100% [34%–100%] | 0/2 · 0% [0%–66%] | sp:brainstorming×2 / — |
| debug | 2/2 · 100% [34%–100%] | 0/2 · 0% [0%–66%] | sp:systematic-debugging×2 / — |
| architecture | 1/2 · 50% [9%–91%] | 0/2 · 0% [0%–66%] | sp:brainstorming×1 / — |
| review | 0/2 · 0% [0%–66%] | 0/2 · 0% [0%–66%] | — / — |
| tests | 0/2 · 0% [0%–66%] | 0/2 · 0% [0%–66%] | — / — |
| continue | 1/2 · 50% [9%–91%] | 0/2 · 0% [0%–66%] | claude-mem:mem-search×1 / — |
| trivial | 2/2 · 100% [34%–100%] | 2/2 · 100% [34%–100%] | — / — |
| **overall (scored classes)** | **6/12 · 50% [25%–75%]** | **0/12 · 0% [0%–24%]** | |

## nocontract vs with

- Activation difference (with − nocontract):50.0 pts, 95% CI [15.4, 74.6]
- Mean context per model request delta (input + cache read + cache write, divided by requests): -51 tokens
- Skill-listing median size delta: 0 chars

## Skill listing (overflow)

| Condition | Sessions | Skills | Listing chars (min/median/max) | Name-only (description dropped) | Workspace skills name-only | Mandatory name-only |
|---|---|---|---|---|---|---|
| with | 14 | 99 | 29939/29939/29939 | 6: anthropic-skills:google-workspace, anthropic-skills:morning, anthropic-skills:pdf, anthropic-skills:pptx, anthropic-skills:skill-creator, anthropic-skills:xlsx | 0 | **0** |
| nocontract | 14 | 99 | 29939/29939/29939 | 6: anthropic-skills:google-workspace, anthropic-skills:morning, anthropic-skills:pdf, anthropic-skills:pptx, anthropic-skills:skill-creator, anthropic-skills:xlsx | 0 | **0** |

## Tokens and models

- **with**: 14/14 runs ok; mean tokens in 5, out 1206, cache read 55747, cache write 19273; mean requests 2.4; mean context per request 31599; models claude-opus-5-5; workspace-core vs probe agreement 14/14
- **nocontract**: 14/14 runs ok; mean tokens in 5, out 1287, cache read 59425, cache write 22458; mean requests 2.6; mean context per request 31650; models claude-opus-5-5; workspace-core vs probe agreement 14/14

Condition check: workspace-core off in 'before' runs: yes

## Reading the misses (from each run's own Workspace Usage section)

Every skipped contract was disclosed in the reply. None was silently ignored.

| Run | Why no expected skill | Action taken |
|---|---|---|
| review-1, review-2 | "`requesting-code-review` is for getting your own work reviewed by a subagent, not for reviewing a file you point me at". Correct | The review contract is outcome-only (findings by severity, with file:line). The suite marks review as unscored |
| tests-1, tests-2 | "TDD is for new behavior; this is coverage for existing code". A fair reading | The tests contract picks TDD for new or changed behavior and `verification-before-completion` for coverage. The suite accepts either |
| arch-2 | "skipped brainstorming because the session budget is small". The model was shown `--max-budget-usd` as a "USD budget" reminder | `--budget` is now opt-in in the runner |
| cont-1 | It answered from the memory context claude-mem had already injected, without calling `mem-search` | No change (reasonable) |

The contract changes above are re-checked by the smoke run (`2026-11-02-phase3-smoke`).
