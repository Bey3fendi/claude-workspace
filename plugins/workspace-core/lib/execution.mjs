// Plan execution method (workspace choice): Superpowers' "Native" mode, superpowers:executing-plans.
// Every plan task is implemented inline in this session, then ONE fresh review of the whole branch.
// superpowers:subagent-driven-development is denied in policies/skill-denies.json. This note supplies the
// method up front, so writing-plans' handoff uses it instead of asking. CW_PLAN_EXECUTION=0 drops the note.

export const EXECUTION_NOTE = [
  '[workspace: plan execution] The user has already chosen the execution method for implementation plans: **Native**.',
  'Use superpowers:executing-plans: implement every task yourself, inline in this session (no implementer or reviewer subagent per task),',
  'then dispatch one fresh review of the whole branch at the end (superpowers:requesting-code-review).',
  'At the writing-plans handoff this is the supplied method: ask only whether the plan captures what they want.',
  'superpowers:subagent-driven-development is disabled in this workspace.',
].join(' ')

/** The SessionStart note, or null. Main conversation only; every source (startup, resume, clear, compact). */
export function executionNote({ disabled = false, agent = false } = {}) {
  return disabled || agent ? null : EXECUTION_NOTE
}
