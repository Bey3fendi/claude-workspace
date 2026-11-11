# Workspace defaults (claude-workspace {{version}}, managed file: do not edit)

These are defaults from claude-workspace. Where the project's own instructions say otherwise, follow the project.

{{#if mdMemory}}
## Memory
- `.memory/session.md` is loaded at session start and after /clear and /compact; do not re-read it unless asked.
- After each verified unit of work, append a block to the bottom of session.md: goal, done (verified), decisions, ruled out, next step, files. Keep it short; the file is capped at 150 lines.
- A durable fact about a module goes in `.memory/context.md`; a decision and its reason in `.memory/decisions.md`. Every section needs `<!-- paths: glob, glob -->` or it is never loaded. Do not read these files in full; hooks inject the relevant sections.
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
<!-- Vendored from multica-ai/andrej-karpathy-skills@{{karpathyCommit}} CLAUDE.md, MIT License. Do not edit here; update the pin instead. -->
{{karpathyGuidelines}}
{{/if}}
