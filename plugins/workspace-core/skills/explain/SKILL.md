---
name: explain
description: Explain a change to the developer, grounded in a change record captured by code. Run by the developer only.
argument-hint: "[commit, e.g. HEAD]  (default: the uncommitted changes)"
disable-model-invocation: true
---

# Explain a change

Target: $ARGUMENTS

workspace-core appends a **change record** below: the files and changed line ranges, the commands that ran with their exit codes, the skills used, and new decisions. Write the explanation from that record and from reading the changed code. Do not add facts the record or the code does not show.

If the record says there are no changes, say so in one line and write no file.

## Steps
1. Read the changed ranges that matter. You don't need every line.
2. Write the explanation to the path the record names (`.explain/units/<unit>.md`) with the template below.
3. A mechanical check runs when you save. If it reports failures, fix them in one pass.
4. In the chat, show **only** the "In short" text and the file path. Never paste the whole explanation.

## Template
```md
# <unit> · <what changed, in a few words>

**In short:** At most 3 sentences, 60 words. What changed and why it matters.

## What changed
- **<purpose>:** one line → `path/to/file.ext:41-78`

## Why
The request and the decisions behind it, in the developer's words where possible.

## How it works now
Up to 5 numbered steps. One Mermaid diagram at most, and only if the flow is not obvious.

## Not done / not tested
Always present. Write "nothing known" if so.

## Verify yourself
Exact commands, ready to copy.

## Start reading at
`path/to/file.ext:41`

<details><summary>Details</summary>
Anything else: alternatives, edge cases, follow-ups, "also touched: <files>".
</details>
```

## Writing rules (a colleague at the whiteboard)
The reader is a busy engineer who did not watch the session.
- Most important first. One idea per sentence, at most 25 words. Active voice.
- Name things concretely: "`decide()` in decide.cpp:41", not "the decision logic".
- Define a term the first time, in a clause: "taint (a flag meaning ...)".
- Numbers instead of adjectives: "4 new tests, all pass", not "thorough tests".
- Show one input and its output when behaviour changed.
- Group "What changed" by purpose, not by file.
- At most 300 words outside `<details>` and code blocks.
- Never use: robust, seamless(ly), leverage, comprehensive, various, enhance(d), streamline, "it should be noted", "in order to", "as mentioned". No marketing tone, no apologies.

## Evidence rules (checked mechanically)
- Every `path:line` or `path:a-b` you cite must fall in a changed range of the record (3 lines of slack). If you cite unchanged code for background, end that line with `(context)`.
- Write "ran `<command>` (exit N)" only for a command in the record, with its recorded exit code.
- Don't say "tested", "passes" or "verified" unless a command in the record succeeded. If `verifiedAfterLastEdit` is false, list that under "Not done / not tested".
- Name every changed file at least once. Minor ones can go in Details as "also touched".
