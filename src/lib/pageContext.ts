/**
 * Which page the assistant was opened from.
 *
 * Until this existed the agent could not tell a question asked from a note
 * apart from the same question asked from the calendar: a turn carried the
 * message, an optional project scope and nothing else. So "help me with this"
 * — the most natural thing to say to an assistant floating over a page — named
 * nothing the model could see.
 *
 * The context is derived from the URL rather than registered by each page.
 * Every page that has something worth pointing at already says which thing it
 * is in its address, so no page has to remember to opt in, and a page that is
 * added later works the day its route exists.
 *
 * This file is shared: the client derives a context from where it is, and the
 * server re-parses whatever arrives, because the body of a request is the
 * caller's to write. Only ids cross the wire — titles and contents are looked
 * up on the server, after the access check, never taken from the client.
 */

export type PageContextKind =
  | "note"
  | "project"
  | "notes"
  | "projects"
  | "tasks"
  | "calendar"
  | "dashboard"
  | "events";

export type PageContext =
  | { kind: "note"; id: number }
  /**
   * A note as its URL names it. Notes are routed by `publicId` — the numeric
   * id only survives in old links — so this is the form a note page actually
   * produces. The server resolves it to the note, owner only, like the id.
   */
  | { kind: "note"; publicId: string }
  | { kind: "project"; id: number }
  | { kind: Exclude<PageContextKind, "note" | "project"> };

/** A nanoid-shaped public id. Anything else is not a note this app minted. */
const PUBLIC_ID = /^[A-Za-z0-9_-]{6,32}$/;

/** One string per distinct page, for "is this still the same page". */
export function pageContextKey(page: PageContext): string {
  if ("publicId" in page) return `${page.kind}:${page.publicId}`;
  if ("id" in page) return `${page.kind}:${String(page.id)}`;
  return page.kind;
}

/** Pages with a context, but no single thing on them. */
const SECTIONS: Record<string, Exclude<PageContextKind, "note" | "project">> = {
  "/notes": "notes",
  "/projects": "projects",
  "/progress": "tasks",
  "/calendar": "calendar",
  "/dashboard": "dashboard",
  "/publish": "events",
};

function positiveInt(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The context for a URL, or null where there is nothing to point at
 * (settings, a chat thread, the marketing pages).
 *
 * `search` is the query string, with or without its `?` — projects open by
 * `?projectId=` on the list page rather than by a route of their own.
 */
export function pageContextFromPath(
  pathname: string,
  search: string | URLSearchParams = "",
): PageContext | null {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const path = pathname.replace(/\/+$/, "") || "/";

  const noteMatch = /^\/notes\/([^/]+)$/.exec(path);
  if (noteMatch && noteMatch[1] !== "new") {
    const segment = noteMatch[1]!;
    const id = positiveInt(segment);
    if (id) return { kind: "note", id };
    if (PUBLIC_ID.test(segment)) return { kind: "note", publicId: segment };
  }

  if (path === "/notes") {
    // Citations link a note as `/notes?note=12`.
    const id = positiveInt(params.get("note"));
    if (id) return { kind: "note", id };
  }

  if (path === "/projects") {
    const id = positiveInt(params.get("projectId"));
    if (id) return { kind: "project", id };
  }

  const section = SECTIONS[path];
  return section ? { kind: section } : null;
}

/**
 * Whatever a request body said, narrowed to a context or `undefined`.
 *
 * Lenient on purpose, like the agent id beside it: the context is a hint about
 * what the user means, and a malformed one should cost the hint, not the turn.
 */
export function parsePageContext(raw: unknown): PageContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { kind, id, publicId } = raw as { kind?: unknown; id?: unknown; publicId?: unknown };

  if (kind === "note" && typeof publicId === "string") {
    return PUBLIC_ID.test(publicId) ? { kind, publicId } : undefined;
  }

  if (kind === "note" || kind === "project") {
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return undefined;
    return kind === "note" ? { kind, id } : { kind, id };
  }

  return typeof kind === "string" &&
    (Object.values(SECTIONS) as string[]).includes(kind)
    ? { kind: kind as Exclude<PageContextKind, "note" | "project"> }
    : undefined;
}
