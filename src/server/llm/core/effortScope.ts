/**
 * The reasoning effort the *user* asked for, scoped to one turn.
 *
 * A chat turn is not one model call: A1 routes, runs tools, hands off to up to
 * three sub-agents, and each of those makes calls of its own. Threading an
 * effort argument through every one of those signatures would touch the whole
 * orchestrator for the sake of one value that is the same everywhere in the
 * turn, so the route sets it once and `modelClient` reads it.
 *
 * It replaces `LLM_REASONING_EFFORT` for the **strong tier only**. Fast-tier
 * work — titles, summaries, JSON repair — is mechanical and stays cheap whatever
 * the user picked; paying "max" to repair a stray brace buys them nothing.
 */

import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

export const USER_REASONING_EFFORTS = ["low", "medium", "high", "max"] as const;
export type UserReasoningEffort = (typeof USER_REASONING_EFFORTS)[number];

export function isUserReasoningEffort(
  value: unknown,
): value is UserReasoningEffort {
  return (
    typeof value === "string" &&
    (USER_REASONING_EFFORTS as readonly string[]).includes(value)
  );
}

const storage = new AsyncLocalStorage<UserReasoningEffort>();

/** Run `fn` with the user's effort in force for every model call it makes. */
export function withUserReasoningEffort<T>(
  effort: UserReasoningEffort | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return effort ? storage.run(effort, fn) : fn();
}

/** The effort in force for the current turn, or undefined for the default. */
export function currentUserReasoningEffort(): UserReasoningEffort | undefined {
  return storage.getStore();
}
