/**
 * The audit trail of a session.
 *
 * The chat stream already reports every lookup and every handoff; until now
 * those frames were spent on a progress label that the next frame overwrote.
 * Collecting them turns the same data into a record of what the answer was
 * actually based on — which is the only thing that makes an agent's reasoning
 * checkable after the fact.
 *
 * The trail spans the whole thread rather than the latest turn: a user
 * checking an answer usually wants to know what the assistant read three
 * questions ago too, and throwing that away the moment the next message was
 * sent made the panel useless for exactly the case it exists for. Events carry
 * the turn they belong to so the timeline can still be read turn by turn.
 *
 * Every field here is observed, not invented. `elapsedMs` is measured on the
 * client from the moment *its own* turn was sent, so it includes network time
 * and is labelled as time-since-start rather than as a server-side duration.
 * It is deliberately not cumulative across the session: an idle user who came
 * back an hour later would otherwise push every later node past any useful
 * scale.
 */

export type TrailKind =
  | "start"
  | "tool"
  | "handoff"
  | "draft"
  | "done"
  | "error";

export interface TrailEvent {
  /** Stable within a session; the list is rendered keyed by it. */
  id: string;
  kind: TrailKind;
  /** Which turn of the session this belongs to. 1-based. */
  turnIndex: number;
  /** The message that opened the turn, for the group heading. */
  turnPrompt?: string;
  /** Human-readable headline, already localised by the emitter. */
  label: string;
  /** Secondary line — a tool name, a draft id, a count. Optional. */
  detail?: string;
  /** Raw identifier (tool name, agent id) rendered in mono. Optional. */
  code?: string;
  /** Milliseconds since this event's own turn was sent. */
  elapsedMs: number;
  /** Wall-clock time the frame arrived. */
  at: Date;
}

/**
 * `listProjects` → `List projects`.
 *
 * The stream carries the tool's identifier and nothing else. Rather than keep a
 * second table of display names that drifts the moment a tool is renamed, the
 * identifier is split on its own camel-case boundaries. The raw name is still
 * shown beside it, so a user who wants to grep the logs has the exact string.
 */
export function humanizeToolName(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
