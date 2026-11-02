# Activation and skill-listing baseline (2026-11-02)

Claude Code 2.1.316 (Claude Code) · 1 run(s) per prompt · 7 prompts · conditions: with, notrim
Evidence: the independent `cw-probe` mod (`skill.prompt`, `turn.step`, `turn.complete`) and the transcript `skill_listing` attachment. No model self-reports are used.

Conditions:
- **notrim**: workspace-core enabled, Phase 3 listing trim off (CW_LISTING_TRIM=0)
- **with**: workspace-core enabled incl. Phase 3 workflow contracts (events cross-checked against cw-probe)
- **reference**: not re-run: no-contract reference is 0/51 answered runs (docs/baselines/2026-11-02-activation-investigation.md)

## Activation (hit = at least one expected skill activated; trivial = no process skill)

| Class | with hit rate [95% CI] | notrim hit rate [95% CI] | Skills activated (with / notrim) |
|---|---|---|---|
| feature | 1/1 · 100% [21%–100%] | 1/1 · 100% [21%–100%] | sp:brainstorming×1 / sp:brainstorming×1 |
| debug | 1/1 · 100% [21%–100%] | 1/1 · 100% [21%–100%] | sp:systematic-debugging×1 / sp:systematic-debugging×1 |
| architecture | 1/1 · 100% [21%–100%] | 1/1 · 100% [21%–100%] | sp:brainstorming×1 / sp:brainstorming×1 |
| review | unscored (n=1) | unscored (n=1) | — / — |
| tests | 1/1 · 100% [21%–100%] | 1/1 · 100% [21%–100%] | sp:verification-before-completion×1 / sp:verification-before-completion×1 |
| continue | 1/1 · 100% [21%–100%] | 1/1 · 100% [21%–100%] | claude-mem:mem-search×1 / claude-mem:mem-search×1 |
| trivial | 1/1 · 100% [21%–100%] | 1/1 · 100% [21%–100%] | — / — |
| **overall (scored classes)** | **5/5 · 100% [57%–100%]** | **5/5 · 100% [57%–100%]** | |

## notrim vs with

- Activation difference (with − notrim):0.0 pts, 95% CI [-43.4, 43.4]
- Mean context per model request delta (input + cache read + cache write, divided by requests): -3118 tokens
- Skill-listing median size delta: 0 chars

## Skill listing (overflow)

| Condition | Sessions | Skills | Listing chars (min/median/max) | Name-only (description dropped) | Workspace skills name-only | Mandatory name-only |
|---|---|---|---|---|---|---|
| with | 7 | 99 | 29939/29939/29939 | 6: anthropic-skills:google-workspace, anthropic-skills:morning, anthropic-skills:pdf, anthropic-skills:pptx, anthropic-skills:skill-creator, anthropic-skills:xlsx | 0 | **0** |
| notrim | 7 | 99 | 29939/29939/29939 | 6: anthropic-skills:google-workspace, anthropic-skills:morning, anthropic-skills:pdf, anthropic-skills:pptx, anthropic-skills:skill-creator, anthropic-skills:xlsx | 0 | **0** |

## Tokens and models

- **with**: 7/7 runs ok; mean tokens in 9, out 1486, cache read 84725, cache write 21153; mean requests 3.6; mean context per request 28935; model-facing listing 20381 chars; models claude-opus-5-5; workspace-core vs probe agreement 7/7
- **notrim**: 7/7 runs ok; mean tokens in 9, out 1381, cache read 87215, cache write 23253; mean requests 3.4; mean context per request 32053; models claude-opus-5-5; workspace-core vs probe agreement 7/7

Condition check: workspace-core off in 'before' runs: yes

Cost: $3.13 over 14 run(s) (smoke)

## Reading (listing trim: denied skills removed from the model-facing listing)

- **Activation is unchanged:** 5/5 scored with trim and 5/5 without, with the same skill chosen for every prompt. The trivial prompt had no over-activation either way.
- **Model-facing listing:** 30,004 → 20,381 characters (−32%, 36 entries). That size comes from workspace-core's `listing` event; the transcript keeps the engine's full record. In the `notrim` runs the trim hook returns early and records nothing, so their size is the spike's 30,004.
- **Context per model request:** −3,118 tokens (28,935 vs 32,053). This is larger than the ~2.4k listing tokens alone, so part of it is run-to-run variation at n=7.
- **Cost:** mean $0.216 vs $0.231 per run (−6.5%).
- **Discoverability:** only skills that `permissions.deny` blocks were removed, and none of them can be invoked. All contract skills stay listed (unit-tested).
- **Limits:** this is a smoke-sized A/B (n=1 per class). The non-inferiority CI is wide (±43 points), but every activation matched exactly. The Phase 3 gate run (`--full --runs 2`) will re-measure with the trim on.
