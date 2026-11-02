// Phase 3 (advise): deterministic task classification + short per-class workflow contracts.
// No model calls. The classification is a heuristic over the prompt text; the contract says so and
// lets Claude proceed normally when it does not fit. Enforcement (gates) is Phase 4.

/** Ordered: the first class whose rule matches wins (more specific first). */
const RULES = [
  ['continue', /\b(continue|pick up|resume|carry on)\b.{0,40}\b(where|from|last|previous|yesterday)\b|\b(last|previous) (session|time)\b|\bwhat did we (decide|do|agree)\b|\bwe (decided|agreed) (earlier|before|previously)\b/i],
  ['review', /\b(code[- ]?review|review (this|the|my|our|src\/|[\w./-]+\.\w+)|audit (this|the) code|look over (this|the|my) (code|diff|pr|changes)|review (pr|pull request|diff|changes))\b/i],
  ['tests', /\b(write|add|create|improve|increase|missing)\b.{0,40}\b(tests?|test cases?|test coverage|unit tests?|specs?)\b|\btest coverage\b|\b(with|and|plus|including) (unit )?tests\b|\btest[- ]first\b|\bTDD\b/i],
  ['debug', /\b(bug|fails?|failing|failed|broken|crash(es|ed|ing)?|error|exception|stack ?trace|regression|wrong (result|output|amount|value)|doesn'?t work|not working|why (does|is|did)|what'?s going on|negative amount|flaky|intermittent|segfault|hangs?)\b/i],
  ['architecture', /\b(architect(ure)?|design (a|an|the)|propose (a|an) design|restructure|refactor (the|this) (whole|entire|library|module|codebase)|pluggable|how should we (structure|organi[sz]e|design|restructure)|support multiple)\b/i],
  ['feature', /\b(add|implement|build|create|introduce|support for|let'?s add|we need|i want)\b.{0,60}\b(feature|support|option|command|endpoint|function|promotion|mode|button|page|screen|gift cards?|setting|level|block|power-?up|\w+)\b/i],
]

const QUESTION = /^\s*(what|which|where|who|when|how (many|much|do i|does)|does|do|is|are|can you (tell|explain|show)|explain|show me)\b/i
const ACTION = /\b(add|implement|fix|change|refactor|write|create|update|remove|delete|rename|migrate|design|review|debug|investigate)\b/i

/**
 * Classify a user prompt. Returns { class, rule } or { class: null } when no contract applies.
 * Trivial = a short informational question with no action verb; never gets a contract.
 */
export function classify(text) {
  const t = String(text ?? '').trim()
  if (!t || t.startsWith('/')) return { class: null, reason: 'empty-or-command' }
  if (t.length < 12) return { class: null, reason: 'too-short' }
  if (RULES[0][1].test(t)) return { class: 'continue', reason: "keyword" }
  if (QUESTION.test(t) && !ACTION.test(t) && !RULES.find(([k]) => k === 'debug')[1].test(t) && t.length < 200) return { class: 'trivial', reason: 'question' }
  for (const [cls, re] of RULES) if (re.test(t)) return { class: cls, reason: 'keyword' }
  return { class: null, reason: 'no-match' }
}

const KARPATHY = 'andrej-karpathy-skills:karpathy-guidelines'

/**
 * Per-class contract. `skills`: invoke one of these first (empty = no skill fits; outcome only).
 * `pick`: when the right skill depends on the request, the rule the model applies instead.
 */
export const CONTRACTS = {
  debug: { skills: ['superpowers:systematic-debugging'], then: [KARPATHY], outcome: 'before your first edit, write the root cause (file:line and why) in your reply; then make the minimal fix' },
  feature: { skills: ['superpowers:brainstorming'], then: ['superpowers:writing-plans', KARPATHY], outcome: 'agree the design before editing code; minimal diff' },
  architecture: { skills: ['superpowers:brainstorming'], then: ['superpowers:writing-plans'], outcome: 'explore options and trade-offs before proposing code' },
  // No Superpowers skill reviews code the user points at (requesting-code-review is for one's own work).
  review: { skills: [], then: [], outcome: 'read the code and its tests, then report findings by severity with file:line evidence; say what you did not check' },
  tests: {
    skills: ['superpowers:test-driven-development', 'superpowers:verification-before-completion'], then: [],
    pick: 'superpowers:test-driven-development for new or changed behaviour; superpowers:verification-before-completion for coverage of existing code',
    outcome: 'run the tests; show each new test fails when the behaviour it covers is broken',
  },
  continue: { skills: ['claude-mem:mem-search'], then: [], outcome: 'retrieve prior context before answering; say so if none is found' },
}

/**
 * Phase 4 compaction restore: the request's contract, re-attached after the conversation is compacted
 * (the contract rode on the prompt, which the summary may drop). `invoked` = skills already loaded this request.
 * `rootCauseStated` keeps the debug step from being asked for twice.
 */
export function restoreText(cls, { invoked = [], rootCauseStated = false } = {}) {
  const c = CONTRACTS[cls]
  if (!c) return null
  const done = invoked.filter((s) => c.skills.includes(s) || c.then.includes(s))
  const skillLine = done.length ? `You already invoked ${done.join(', ')} for this request; keep following it.`
    : c.pick ? `If not yet done, invoke the Skill tool with ${c.pick}.`
    : c.skills.length ? `If not yet done, invoke the Skill tool with ${c.skills.join(' or ')}.` : ''
  const outcome = cls === 'debug' && rootCauseStated ? 'root cause already stated; any fix stays minimal and is verified' : c.outcome
  return `[workspace contract: ${cls}, restored after compaction] Applies to the latest user request until a new one arrives; the user's own instructions take precedence. ${skillLine}${skillLine ? ' ' : ''}Expected: ${outcome}.`
}

/** The context block attached to the prompt (never shown to the user). Kept short. */
export function contractText(cls) {
  const c = CONTRACTS[cls]
  if (!c) return null
  const first = c.pick ? `invoke the Skill tool with ${c.pick}, and follow it.`
    : c.skills.length ? `invoke the Skill tool with ${c.skills.join(' or ')} and follow it.` : null
  const then = c.then.length ? ` Then, where relevant: ${c.then.join(', ')}.` : ''
  const head = first ? `Before other work, ${first}${then} Expected: ${c.outcome}.` : `Expected: ${c.outcome}.`
  return `[workspace contract: ${cls}] ${head} (Keyword heuristic: if it plainly does not fit, say so and proceed normally.)`
}
