# Workspace defaults (claude-workspace {{version}}, managed file: do not edit)

These are defaults from claude-workspace. Where the project's own instructions say otherwise, follow the project.

{{#if mdMemory}}
## Memory
- `.memory/session.md` is loaded at session start and after /clear and /compact; do not re-read it unless asked.
- After each verified unit of work, append a block to the bottom of session.md: goal, done (verified), decisions, ruled out, next step, files. Keep it short; the file is capped at 150 lines. If a request changes files and you write no block, the workspace appends a facts-only one; yours is better (only you know the goal and next step).
- A durable fact about a module goes in `.memory/context.md`; a decision and its reason in `.memory/decisions.md`. Every section needs `<!-- paths: glob, glob -->` or it is never loaded. Do not read these files in full: the relevant sections arrive when you read a matching file, or in place of your first edit to it.
- When the context-pressure note asks for a handoff, write it to session.md, not to the chat.
{{/if}}
{{#if contracts}}
## Workflow contracts
- Some requests carry a hidden workspace contract naming a skill to invoke first. Follow it unless it plainly does not fit; if you skip it, say why in Workspace Usage.
- Request classification reads English keywords only. If the user writes in another language and the request is clearly debugging, a new feature, a design question, tests or a review, invoke the skill the matching contract would name.
{{/if}}
## Secrets
- Never print, log or commit secrets. Keys live in `.env`, which must stay gitignored.
{{#if responseStyle}}
## Response style (ADHD-friendly)
- First line: the answer or result. Details after.
- Short sentences, one idea each. Paragraphs of at most 3 sentences.
- Anything with more than two parts: bullets or numbered steps, one action per step.
- Bold only the key word or decision of a section.
- Commands the user must run go in one copy-paste block.
- End with what the user does next (or "nothing to do"). Ask at most one question.
- No preamble, no restating the question, no filler.
- Applies to chat replies only, not to code, commits or files.
{{/if}}
{{#if karpathy}}

## Coding guidelines (Karpathy)
<!-- Vendored from multica-ai/andrej-karpathy-skills@{{karpathyCommit}} CLAUDE.md, MIT License. Do not edit here; update the pin instead. -->
{{karpathyGuidelines}}
{{/if}}
