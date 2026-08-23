/**
 * Turning a user's workspace into a file they can keep.
 *
 * Pure functions over already-fetched rows, so the escaping rules — which are
 * where every bug in an exporter lives — can be tested without a database.
 *
 * Three formats, because they answer three different questions. CSV is for
 * putting tasks in a spreadsheet, Markdown is for reading prose somewhere else,
 * and ICS is for getting dates into a calendar. A single "export" format would
 * serve none of them.
 *
 * On the general principle: an export path is a retention feature, not a churn
 * risk. The easiest product to adopt is the one that is visibly easy to leave,
 * and "can I get my data out" is a question a buyer asks before they commit.
 */

import "server-only";

// ---------------------------------------------------------------------------
// Row shapes — the minimum each format needs
// ---------------------------------------------------------------------------

export interface ExportTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  projectTitle: string;
  assignee: string | null;
}

export interface ExportNote {
  id: number;
  title: string | null;
  /** Null when the note is locked — see {@link toMarkdown}. */
  content: string | null;
  locked: boolean;
  createdAt: Date;
}

export interface ExportEvent {
  id: number;
  title: string;
  description: string;
  eventDate: Date;
}

export interface ExportBundle {
  tasks: ExportTask[];
  notes: ExportNote[];
  events: ExportEvent[];
  exportedAt: Date;
  userName: string | null;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Characters that make a spreadsheet treat a cell as a formula.
 *
 * A task titled `=HYPERLINK("http://evil","click")` is a live formula the moment
 * the file opens in Excel or Sheets — the classic CSV injection. Since any user
 * can name a task anything, and an export is a file someone else may open, the
 * cell is prefixed so it is read as text.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";

  let text = String(value);
  if (FORMULA_LEAD.test(text)) text = `'${text}`;

  // Quote whenever the delimiter, a quote, or a line break is present; double
  // any embedded quote. Quoting unconditionally would also be correct but makes
  // the file harder to read by eye, which is half of why anyone exports CSV.
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function isoDay(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

/**
 * Tasks as CSV.
 *
 * The one format Free gets, because it is the one that answers "where is my
 * work". Header row always present, so an empty workspace produces a valid file
 * rather than an empty one — an empty file reads as a failed export.
 */
export function toCsv(tasks: ExportTask[]): string {
  const header = [
    "id",
    "title",
    "project",
    "status",
    "priority",
    "assignee",
    "due_date",
    "completed_at",
    "created_at",
  ];

  const rows = tasks.map((t) =>
    [
      t.id,
      t.title,
      t.projectTitle,
      t.status,
      t.priority,
      t.assignee,
      isoDay(t.dueDate),
      isoDay(t.completedAt),
      isoDay(t.createdAt),
    ]
      .map(csvCell)
      .join(","),
  );

  // CRLF and a trailing newline: RFC 4180, and what Excel expects.
  return [header.join(","), ...rows].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/**
 * The whole workspace as one Markdown document.
 *
 * Locked notes appear by title with their content withheld. Including it would
 * make the export a way around the note lock — the lock is the feature, and an
 * exporter that ignores it is a bypass, not a convenience. Omitting the note
 * entirely would be worse: the user would not know it had been skipped.
 */
export function toMarkdown(bundle: ExportBundle): string {
  const { tasks, notes, events, exportedAt, userName } = bundle;
  const out: string[] = [];

  out.push(`# KAIROS export`);
  out.push("");
  if (userName) out.push(`**${userName}**  `);
  out.push(`Exported ${exportedAt.toISOString()}`);
  out.push("");

  out.push(`## Tasks (${String(tasks.length)})`);
  out.push("");
  if (tasks.length) {
    for (const t of tasks) {
      const done = t.status === "completed";
      const due = t.dueDate ? ` — due ${isoDay(t.dueDate)}` : "";
      out.push(
        `- [${done ? "x" : " "}] ${t.title} *(${t.projectTitle})*${due}`,
      );
    }
  } else {
    out.push("_None._");
  }
  out.push("");

  out.push(`## Notes (${String(notes.length)})`);
  out.push("");
  if (notes.length) {
    for (const n of notes) {
      out.push(`### ${n.title ?? "Untitled"}`);
      out.push("");
      if (n.locked) {
        out.push("_This note is locked. Its contents are not included in exports._");
      } else {
        out.push(n.content ?? "");
      }
      out.push("");
    }
  } else {
    out.push("_None._");
    out.push("");
  }

  out.push(`## Events (${String(events.length)})`);
  out.push("");
  if (events.length) {
    for (const e of events) {
      out.push(`- **${isoDay(e.eventDate)}** — ${e.title}`);
    }
  } else {
    out.push("_None._");
  }
  out.push("");

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// ICS
// ---------------------------------------------------------------------------

/** `20260821T140000Z` — the only form of timestamp this file uses. */
function icsStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Escape a text value per RFC 5545 §3.3.11.
 *
 * Order matters: backslashes first, or the escapes introduced by the later
 * replacements get escaped again and the output is wrong.
 */
function icsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold a content line to 75 octets, per RFC 5545 §3.1.
 *
 * Measured in bytes rather than characters, because the limit is octets and this
 * product runs in Bulgarian: Cyrillic is two bytes per character in UTF-8, so a
 * character-counted fold produces lines up to twice the legal length. The
 * continuation is CRLF followed by a single space.
 *
 * Folding never splits a multi-byte character, which would corrupt it.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const pieces: string[] = [];
  let current = "";
  let currentBytes = 0;
  // 75 for the first line; continuations carry a leading space, so 74 of payload.
  let budget = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > budget) {
      pieces.push(current);
      current = "";
      currentBytes = 0;
      budget = 74;
    }
    current += char;
    currentBytes += size;
  }
  if (current) pieces.push(current);

  return pieces.join("\r\n ");
}

/**
 * Events and dated tasks as an iCalendar file.
 *
 * Tasks are emitted as VEVENTs rather than VTODOs. VTODO is the semantically
 * correct type and is also the one Google Calendar silently drops, so a
 * standards-pure file would import as an empty calendar — which is not a
 * trade worth making for a feature whose entire purpose is getting dates into
 * the calendar the user actually uses.
 *
 * `uid` is derived from the row identity and the product domain so re-importing
 * an export updates the same entries instead of duplicating them.
 */
export function toIcs(bundle: ExportBundle): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KAIROS//Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  const stamp = icsStamp(bundle.exportedAt);

  for (const event of bundle.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:event-${String(event.id)}@kairos`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsStamp(event.eventDate)}`,
      `SUMMARY:${icsText(event.title)}`,
      ...(event.description
        ? [`DESCRIPTION:${icsText(event.description)}`]
        : []),
      "END:VEVENT",
    );
  }

  for (const task of bundle.tasks) {
    if (!task.dueDate) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:task-${String(task.id)}@kairos`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsStamp(task.dueDate)}`,
      `SUMMARY:${icsText(`${task.title} (${task.projectTitle})`)}`,
      `STATUS:${task.status === "completed" ? "COMPLETED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");

  // CRLF throughout — RFC 5545 requires it, and Outlook enforces it.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
