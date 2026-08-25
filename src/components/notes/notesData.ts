/**
 * Everything the notes surface knows how to work out for itself.
 *
 * A note arrives from two different endpoints — `getAll` for your own and
 * `getSharedWithMe` for other people's — with different shapes and different
 * omissions. Downstream code works on the single `NoteItem` below instead, so a
 * row, a page header and a menu do not each need to know which query a note
 * came from.
 *
 * Kept free of React so the rules that decide what is on screen — which notes,
 * in what order, under which heading — can be tested without rendering
 * anything.
 */

export type NoteKind = "own" | "shared";
export type NotePermission = "read" | "write";

export interface NoteUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  permission?: string;
}

export interface NoteItem {
  id: number;
  title: string | null;
  /** Null whenever the note is encrypted and has not been unlocked this session. */
  content: string | null;
  createdAt: Date;
  updatedAt: Date;
  notebookId: number | null;
  calendarDate: Date | null;
  isPasswordProtected: boolean;
  kind: NoteKind;
  /** Who your own note is shared with. Empty for notes shared *with* you. */
  sharedWith: NoteUser[];
  /** Your permission on someone else's note. Null on your own. */
  permission: NotePermission | null;
  ownerName: string | null;
  ownerEmail: string | null;
}

/** Which rail entry is selected. Notebooks are `notebook:<id>`. */
export type NoteView = "all" | "shared" | "calendar" | `notebook:${number}`;

export type NoteFilter = "all" | "locked" | "shared" | "unfiled";

export type NoteSort = "edited" | "created" | "title";

export type DateBucket = "today" | "yesterday" | "week" | "month" | "older";

/** Decrypted bodies, by note id, for notes unlocked this session. */
export type UnlockedContent = Record<number, string>;

export function notebookIdOfView(view: NoteView): number | null {
  return view.startsWith("notebook:") ? Number(view.slice("notebook:".length)) : null;
}

/** The body to read a note by — the decrypted copy if we have one. */
export function bodyOf(note: NoteItem, unlocked: UnlockedContent): string {
  return unlocked[note.id] ?? note.content ?? "";
}

/**
 * The title to show for a note.
 *
 * Notes have always been allowed to exist without one, so the first line of the
 * body stands in — except on a locked note, where there is no body to borrow
 * from and the placeholder has to say why.
 */
export function noteTitle(
  note: NoteItem,
  unlockedContent: string | undefined,
  labels: { untitled: string; encrypted: string },
): string {
  if (note.title?.trim()) return note.title;

  const body = unlockedContent ?? note.content;
  if (body === null || body === undefined) return labels.encrypted;

  const firstLine = body.split("\n").find((line) => line.trim().length > 0);
  return firstLine?.trim().slice(0, 80) ?? labels.untitled;
}

/** The second line of a list row: the body, minus whatever the title already used. */
export function notePreview(
  note: NoteItem,
  unlockedContent: string | undefined,
  labels: { locked: string; empty: string },
): string {
  const body = unlockedContent ?? note.content;
  if (body === null || body === undefined) return labels.locked;

  const lines = body.split("\n").filter((line) => line.trim().length > 0);
  /* Without a stored title the first line became the title, so the preview
     starts at the second one — otherwise both lines say the same thing. */
  const rest = note.title?.trim() ? lines : lines.slice(1);
  const text = rest.join(" ").trim();
  return text.length > 0 ? text.slice(0, 160) : labels.empty;
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * List timestamps: a clock time today, "Yesterday", a weekday within the week,
 * then a date — so the column stays narrow whatever the age of the note.
 */
export function formatListTimestamp(
  date: Date,
  locale: string,
  labels: { yesterday: string },
  now: Date = new Date(),
): string {
  if (isSameDay(date, now)) {
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return labels.yesterday;

  const daysAgo = (now.getTime() - date.getTime()) / 86_400_000;
  if (daysAgo < 7) return date.toLocaleDateString(locale, { weekday: "short" });

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Which heading a note sits under when the list is sorted by date. */
export function bucketOf(date: Date, now: Date = new Date()): DateBucket {
  if (isSameDay(date, now)) return "today";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return "yesterday";

  const daysAgo = (now.getTime() - date.getTime()) / 86_400_000;
  if (daysAgo < 7) return "week";
  if (daysAgo < 31) return "month";
  return "older";
}

/** `<input type="date">` wants a local `YYYY-MM-DD`, not a UTC ISO slice. */
export function toDateInputValue(date: Date | null): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Parse a date input back to midday local time.
 *
 * Midday rather than midnight because a note pinned to the 3rd should stay on
 * the 3rd for a reader a few timezones away, and midnight is one hour of drift
 * from being the 2nd.
 */
export function fromDateInputValue(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0);
}

/**
 * The list, as the rail, the filter chips, the search box and the sort control
 * between them have asked for it.
 *
 * Search runs over the decrypted body when we have one and the stored body
 * otherwise, which means an encrypted note can only ever match on its title —
 * see `countLockedExcluded`.
 */
export function selectNotes({
  notes,
  view,
  filter,
  query,
  sort,
  unlocked,
  locale,
}: {
  notes: NoteItem[];
  view: NoteView;
  filter: NoteFilter;
  query: string;
  sort: NoteSort;
  unlocked: UnlockedContent;
  locale: string;
}): NoteItem[] {
  const notebookId = notebookIdOfView(view);
  const needle = query.trim().toLowerCase();

  const filtered = notes
    .filter((note) => (view === "calendar" ? note.calendarDate !== null : true))
    .filter((note) => (notebookId === null ? true : note.notebookId === notebookId))
    .filter((note) => {
      if (filter === "locked") return note.isPasswordProtected;
      if (filter === "shared") return note.kind === "shared" || note.sharedWith.length > 0;
      if (filter === "unfiled") return note.notebookId === null;
      return true;
    })
    .filter((note) => {
      if (!needle) return true;
      return (
        (note.title?.toLowerCase() ?? "").includes(needle) ||
        bodyOf(note, unlocked).toLowerCase().includes(needle)
      );
    });

  return [...filtered].sort((a, b) => {
    if (sort === "title") {
      const left = (a.title ?? bodyOf(a, unlocked)).trim().toLowerCase();
      const right = (b.title ?? bodyOf(b, unlocked)).trim().toLowerCase();
      return left.localeCompare(right, locale);
    }
    const field = sort === "created" ? "createdAt" : "updatedAt";
    return b[field].getTime() - a[field].getTime();
  });
}

/**
 * How many notes the search could not look inside.
 *
 * Their text only exists as ciphertext on the server, so they can never match
 * on content. Silence would read as "no such note", which is a different and
 * wrong answer.
 */
export function countLockedExcluded(
  notes: NoteItem[],
  query: string,
  unlocked: UnlockedContent,
): number {
  if (!query.trim()) return 0;
  return notes.filter((note) => note.isPasswordProtected && unlocked[note.id] === undefined).length;
}

const BUCKET_ORDER: DateBucket[] = ["today", "yesterday", "week", "month", "older"];

/** Date headings only make sense while the list is in date order. */
export function groupNotes(
  notes: NoteItem[],
  sort: NoteSort,
  now: Date = new Date(),
): Array<{ key: string; label: DateBucket | null; notes: NoteItem[] }> {
  if (sort === "title") return [{ key: "all", label: null, notes }];

  const buckets = new Map<DateBucket, NoteItem[]>();
  for (const note of notes) {
    const bucket = bucketOf(sort === "created" ? note.createdAt : note.updatedAt, now);
    const list = buckets.get(bucket);
    if (list) list.push(note);
    else buckets.set(bucket, [note]);
  }

  return BUCKET_ORDER.filter((bucket) => buckets.has(bucket)).map((bucket) => ({
    key: bucket,
    label: bucket,
    notes: buckets.get(bucket)!,
  }));
}
