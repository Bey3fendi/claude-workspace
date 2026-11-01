# workspace-core

The core mod of claude-workspace. In Phase 1 it is a pass-through placeholder that proves the plugin loads; it changes nothing.

Phase 2 adds the evidence pipeline:
- It records documented engine events (`turn.step`, `skill.prompt`, `session.append`, `state.set`, `tool.call`, `classic.*`) as local JSONL under `~/.local/state/claude-workspace/`.
- It shows status through `$.ui.status`.

Nothing is sent over the network.
