/**
 * What a note password may be: digits, and nothing else.
 *
 * Shared by the router, which refuses anything else when a password is *set*,
 * and by the fields that set one, which drop non-digits as they are typed so
 * the refusal is never what a user actually sees. Checking a password — unlock,
 * remove — is deliberately left unconstrained: notes locked before this rule
 * existed may have letters in theirs, and they must still open.
 */

export const NOTE_PASSWORD_PATTERN = /^\d+$/;

export const NOTE_PASSWORD_MESSAGE = "Note passwords can only contain numbers.";

/** The input as a note password field keeps it: every non-digit dropped. */
export function toNotePassword(input: string): string {
  return input.replace(/\D/g, "");
}
