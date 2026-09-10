/**
 * The rule that lets a write agent answer a question.
 *
 * A2–A6 are drafting agents: they take a message and emit a plan. That made
 * "what can you do?" a dead end. The agent had nothing to propose, so it
 * returned empty arrays, and the chat — which renders a plan by counting its
 * operations — had nothing to show and said "I couldn't generate a response for
 * that". The user asked a perfectly clear question and was told to rephrase it.
 *
 * Nothing about a drafting agent stops it from answering. It knows its own
 * scope, and its context pack already describes the workspace it can act on.
 * What was missing was permission to answer in prose, and one field to answer
 * in — which is why this is a prompt rule rather than a new code path: the plan
 * shape does not change, only what the agent is allowed to put in it.
 *
 * Shared rather than copied into five prompts because the wording is the
 * contract the chat renderer relies on: the answer is in the prose field, and
 * the operation arrays stay empty.
 *
 * @param field - The plan's prose field for this agent. A2 has `summary` only
 *   since the field was added for exactly this; A3–A6 have carried one all along.
 */
export function answerableRule(field = "summary"): string {
  return `## When the message asks rather than instructs
"What can you do?", "what's in scope for you?", "hi" — these are questions, not
instructions, and a question deserves an answer. Answer it in \`${field}\`, in the
user's language, and leave every operation array empty. Say what you can
actually do, in your own terms, and name the agent that handles anything you
cannot.

Do not put the answer in a questions array: that is for what *you* need to know
before you can draft. An empty plan whose \`${field}\` answers the question is a
good turn; an empty plan with nothing to read is a dead end.`;
}
