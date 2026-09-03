"use client";

/**
 * The note list: the current query, made visible.
 *
 * This replaces the card grid. A card was a 220-pixel box carrying a badge, a
 * clipped line of body and two timestamps; a row carries the title, a real
 * preview, the notebook, who it is shared with, and whether it is locked — in
 * less vertical space, so more of the corpus is on screen at once. Sort and
 * filter are controls here rather than assumptions baked into the query.
 *
 * A row used to be a `rounded-xl` card that grew a ring, a backdrop blur and a
 * floating accent bar when selected. It is a hairline row now — the `TaskRow`
 * shape from `DashboardClient` — and selection is a left border that scales in
 * from its own centre over a 7% accent wash. Rows rise on load and on every
 * filter or sort change, capped so a long list never reads as loading twice.
 */

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDownWideNarrow,
  CalendarDays,
  CalendarX,
  Check,
  FileText,
  FolderOpen,
  KeyRound,
  Lock,
  LockOpen,
  Menu as MenuIcon,
  Plus,
  Search,
  SquareArrowOutUpRight,
  Share2,
  ShieldOff,
  Trash2,
  Users,
} from "~/components/ui/icons";

import { ContextMenu, type ContextMenuAnchor } from "./ContextMenu";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "./Menu";
import {
  Badge,
  BTN_ACCENT,
  CHIP,
  CHIP_IDLE,
  CHIP_ON,
  ICON_BTN_BARE,
  MICRO,
  SharedAvatars,
  STAMP,
} from "./notesUi";
import {
  formatListTimestamp,
  groupNotes,
  noteTitle,
  notePreview,
  type NoteFilter,
  type NoteItem,
  type NoteSort,
  type NoteView,
} from "./notesData";

/**
 * How many rows get a staggered entrance.
 *
 * Past this they all arrive together. A 60-note list staggered at 30ms would
 * take nearly two seconds to finish assembling, which stops reading as an
 * entrance and starts reading as a second page load.
 */
const STAGGER_CAP = 12;
const STAGGER_STEP = 0.03;

export function NoteList({
  notes,
  selectedId,
  heading,
  view,
  sort,
  onSortChange,
  filter,
  onFilterChange,
  query,
  lockedExcluded,
  unlocked,
  notebookNameOf,
  locale,
  isLoading,
  onSelect,
  onNewNote,
  onOpenRail,
  notebooks,
  onShare,
  onDelete,
  onMoveToNotebook,
  onLock,
  onRemoveLock,
  onResetPassword,
  onRelock,
  onRemoveCalendarDate,
}: {
  notes: NoteItem[];
  selectedId: number | null;
  heading: string;
  view: NoteView;
  sort: NoteSort;
  onSortChange: (next: NoteSort) => void;
  filter: NoteFilter;
  onFilterChange: (next: NoteFilter) => void;
  query: string;
  /** How many encrypted notes the search could not look inside. */
  lockedExcluded: number;
  unlocked: Record<number, string>;
  notebookNameOf: (id: number | null) => string | null;
  locale: string;
  isLoading: boolean;
  onSelect: (id: number) => void;
  onNewNote: () => void;
  onOpenRail: () => void;
  /** For the "move to notebook" section of a row's context menu. */
  notebooks: Array<{ id: number; name: string }>;
  onShare: (id: number) => void;
  onDelete: (id: number) => void;
  onMoveToNotebook: (id: number, notebookId: number | null) => void;
  /** Encrypt a note that has no password yet. */
  onLock: (id: number) => void;
  /** Decrypt a protected note back to an ordinary one. */
  onRemoveLock: (id: number) => void;
  onResetPassword: (id: number) => void;
  /** Forget the password held for this note this session. */
  onRelock: (id: number) => void;
  onRemoveCalendarDate: (id: number) => void;
}) {
  const t = useTranslations("notes");
  const listRef = useRef<HTMLUListElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    note: NoteItem;
    anchor: ContextMenuAnchor;
  } | null>(null);

  const sortLabels: Record<NoteSort, string> = {
    edited: t("sort.edited"),
    created: t("sort.created"),
    title: t("sort.title"),
  };

  const filters: Array<{ key: NoteFilter; label: string }> = [
    { key: "all", label: t("filters.all") },
    { key: "locked", label: t("filters.locked") },
    { key: "shared", label: t("filters.shared") },
    { key: "unfiled", label: t("filters.unfiled") },
  ];

  /* Arrow keys walk the rows. The list is a real list of real buttons, so this
     only has to move focus — activation is still Enter or Space on the button. */
  const onListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = listRef.current?.querySelectorAll<HTMLButtonElement>(
      "button[data-note-row]",
    );
    if (!rows || rows.length === 0) return;

    event.preventDefault();
    const list = Array.from(rows);
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? (list[Math.min(index + 1, list.length - 1)] ?? list[0])
        : (list[Math.max(index - 1, 0)] ?? list[0]);
    next?.focus();
  };

  const grouped = groupNotes(notes, sort);

  /* One counter across the groups, so the stagger runs down the visible list
     rather than restarting at every date bucket. */
  let rowIndex = 0;

  return (
    <div className="flex h-full flex-col bg-bg-primary md:border-r md:border-border-light/60">
      <div className="flex flex-none items-center gap-2 px-3.5 pt-4 pb-2.5">
        <button
          type="button"
          onClick={onOpenRail}
          aria-label={t("common.openLibrary")}
          className={`${ICON_BTN_BARE} -ml-1 md:hidden`}
        >
          <MenuIcon size={18} />
        </button>

        <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-0.012em] text-fg-primary">
          {heading}
        </h2>

        <Menu
          label={t("sort.label")}
          icon={
            <span className="flex items-center gap-1.5">
              <ArrowDownWideNarrow size={12} />
              {sortLabels[sort]}
            </span>
          }
          triggerClassName={`${CHIP} ${CHIP_IDLE}`}
        >
          {(close) => (
            <>
              <MenuLabel>{t("sort.label")}</MenuLabel>
              {(["edited", "created", "title"] as NoteSort[]).map((key) => (
                <MenuItem
                  key={key}
                  icon={
                    sort === key ? (
                      <Check size={13} className="text-accent-primary" />
                    ) : (
                      <span className="w-[13px]" />
                    )
                  }
                  onClick={() => {
                    onSortChange(key);
                    close();
                  }}
                >
                  {sortLabels[key]}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>

        <button
          type="button"
          onClick={onNewNote}
          aria-label={t("actions.create")}
          className={`${ICON_BTN_BARE} text-accent-primary md:hidden`}
        >
          <Plus size={18} />
        </button>
      </div>

      <div
        className="flex flex-none gap-1.5 overflow-x-auto px-3.5 pb-3"
        role="tablist"
        aria-label={t("filters.label")}
      >
        {filters.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={filter === entry.key}
            onClick={() => onFilterChange(entry.key)}
            className={`${CHIP} ${filter === entry.key ? CHIP_ON : CHIP_IDLE}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <ul className="flex flex-col" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i} className="space-y-2 border-b border-border-light/45 px-3.5 py-3.5">
                <div className="kairos-shimmer h-3 w-1/2 rounded" />
                <div className="kairos-shimmer h-2.5 w-4/5 rounded" />
                <div className="kairos-shimmer h-2 w-1/4 rounded" />
              </li>
            ))}
          </ul>
        ) : notes.length === 0 ? (
          <EmptyList
            query={query}
            filter={filter}
            view={view}
            onNewNote={onNewNote}
          />
        ) : (
          <ul
            ref={listRef}
            className="flex flex-col"
            aria-label={heading}
            onKeyDown={onListKeyDown}
          >
            {grouped.map((group) => (
              <li key={group.key}>
                {group.label && (
                  <p className={`${MICRO} px-3.5 pt-4 pb-1.5`}>{t(`buckets.${group.label}`)}</p>
                )}
                <ul className="flex flex-col">
                  {group.notes.map((note) => {
                    const delay = Math.min(rowIndex++, STAGGER_CAP) * STAGGER_STEP;
                    return (
                      <li key={`${note.kind}-${note.id}`}>
                        <NoteRow
                          note={note}
                          selected={note.id === selectedId}
                          unlockedContent={unlocked[note.id]}
                          notebookName={notebookNameOf(note.notebookId)}
                          locale={locale}
                          sort={sort}
                          enterDelay={delay}
                          onSelect={() => onSelect(note.id)}
                          onContextMenu={(anchor) =>
                            setContextMenu({ note, anchor })
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Encrypted notes never leave the server decrypted, so search cannot
          look inside them. Silence would read as "no match". A hairline strip
          pinned to the bottom of the pane rather than a paragraph at the end of
          the scroll, which is where it could not be seen without reaching the
          end of the results it is explaining. */}
      {query.trim() !== "" && lockedExcluded > 0 && (
        <p className="flex flex-none items-start gap-2 border-t border-border-light/45 px-3.5 py-3 text-[11.5px] leading-relaxed text-fg-quaternary">
          <Lock size={12} className="mt-0.5 flex-shrink-0" />
          {t("searchLockedExcluded", { count: lockedExcluded })}
        </p>
      )}

      {contextMenu && (
        <NoteContextMenu
          note={contextMenu.note}
          anchor={contextMenu.anchor}
          isUnlocked={unlocked[contextMenu.note.id] !== undefined}
          notebooks={notebooks}
          onClose={() => setContextMenu(null)}
          onSelect={onSelect}
          onShare={onShare}
          onDelete={onDelete}
          onMoveToNotebook={onMoveToNotebook}
          onLock={onLock}
          onRemoveLock={onRemoveLock}
          onResetPassword={onResetPassword}
          onRelock={onRelock}
          onRemoveCalendarDate={onRemoveCalendarDate}
        />
      )}
    </div>
  );
}

/**
 * What a right-click on a row can do.
 *
 * Mostly actions the surface already supported from somewhere else — what
 * changes is that reaching them no longer costs opening the note first. The
 * exception is locking: a password used to be choosable only while creating a
 * note, so protecting an old one meant retyping it into a new one.
 *
 * A note shared *with* you is someone else's: no delete, no sharing, no
 * notebook — those all check ownership on the server and would only fail.
 */
function NoteContextMenu({
  note,
  anchor,
  isUnlocked,
  notebooks,
  onClose,
  onSelect,
  onShare,
  onDelete,
  onMoveToNotebook,
  onLock,
  onRemoveLock,
  onResetPassword,
  onRelock,
  onRemoveCalendarDate,
}: {
  note: NoteItem;
  anchor: ContextMenuAnchor;
  isUnlocked: boolean;
  notebooks: Array<{ id: number; name: string }>;
  onClose: () => void;
  onSelect: (id: number) => void;
  onShare: (id: number) => void;
  onDelete: (id: number) => void;
  onMoveToNotebook: (id: number, notebookId: number | null) => void;
  onLock: (id: number) => void;
  /** Decrypt a protected note back to an ordinary one. */
  onRemoveLock: (id: number) => void;
  onResetPassword: (id: number) => void;
  onRelock: (id: number) => void;
  onRemoveCalendarDate: (id: number) => void;
}) {
  const t = useTranslations("notes");
  const isOwn = note.kind === "own";

  /* Close first, so focus is back on the row before the handler navigates or
     opens a dialog that wants focus of its own. */
  const act = (close: () => void, run: () => void) => () => {
    close();
    run();
  };

  return (
    <ContextMenu
      anchor={anchor}
      label={t("common.noteActions")}
      onClose={onClose}
    >
      {(close) => (
        <>
          <MenuItem
            icon={<SquareArrowOutUpRight size={13} />}
            onClick={act(close, () => onSelect(note.id))}
          >
            {t("actions.open")}
          </MenuItem>

          {isOwn && !note.isPasswordProtected && (
            <MenuItem
              icon={<Lock size={13} />}
              onClick={act(close, () => onLock(note.id))}
            >
              {t("password.protect")}
            </MenuItem>
          )}

          {note.isPasswordProtected &&
            (isUnlocked ? (
              <MenuItem
                icon={<Lock size={13} />}
                onClick={act(close, () => onRelock(note.id))}
              >
                {t("actions.lockAgain")}
              </MenuItem>
            ) : (
              <MenuItem
                icon={<LockOpen size={13} />}
                onClick={act(close, () => onSelect(note.id))}
              >
                {t("actions.unlock")}
              </MenuItem>
            ))}

          {isOwn && note.isPasswordProtected && (
            <>
              <MenuItem
                icon={<ShieldOff size={13} />}
                onClick={act(close, () => onRemoveLock(note.id))}
              >
                {t("password.remove")}
              </MenuItem>
              <MenuItem
                icon={<KeyRound size={13} />}
                onClick={act(close, () => onResetPassword(note.id))}
              >
                {t("password.resetPassword")}
              </MenuItem>
            </>
          )}

          {isOwn && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={<Share2 size={13} />}
                onClick={act(close, () => onShare(note.id))}
              >
                {note.sharedWith.length > 0 ? t("manageSharing") : t("share")}
              </MenuItem>

              {note.calendarDate && (
                <MenuItem
                  icon={<CalendarX size={13} />}
                  onClick={act(close, () => onRemoveCalendarDate(note.id))}
                >
                  {t("calendar.remove")}
                </MenuItem>
              )}

              <MenuSeparator />
              <MenuLabel>{t("notebook")}</MenuLabel>
              <MenuItem
                icon={
                  note.notebookId === null ? (
                    <Check size={13} className="text-accent-primary" />
                  ) : (
                    <span className="w-[13px]" />
                  )
                }
                onClick={act(close, () => onMoveToNotebook(note.id, null))}
              >
                {t("common.none")}
              </MenuItem>
              {notebooks.map((notebook) => (
                <MenuItem
                  key={notebook.id}
                  icon={
                    note.notebookId === notebook.id ? (
                      <Check size={13} className="text-accent-primary" />
                    ) : (
                      <FolderOpen size={13} />
                    )
                  }
                  onClick={act(close, () =>
                    onMoveToNotebook(note.id, notebook.id),
                  )}
                >
                  {notebook.name}
                </MenuItem>
              ))}

              <MenuSeparator />
              <MenuItem
                icon={<Trash2 size={13} />}
                destructive
                onClick={act(close, () => onDelete(note.id))}
              >
                {t("actions.delete")}
              </MenuItem>
            </>
          )}
        </>
      )}
    </ContextMenu>
  );
}

function NoteRow({
  note,
  selected,
  unlockedContent,
  notebookName,
  locale,
  sort,
  enterDelay,
  onSelect,
  onContextMenu,
}: {
  note: NoteItem;
  selected: boolean;
  unlockedContent: string | undefined;
  notebookName: string | null;
  locale: string;
  sort: NoteSort;
  enterDelay: number;
  onSelect: () => void;
  onContextMenu: (anchor: ContextMenuAnchor) => void;
}) {
  const t = useTranslations("notes");

  const title = noteTitle(note, unlockedContent, {
    untitled: t("untitled"),
    encrypted: t("encryptedNote"),
  });
  const preview = notePreview(note, unlockedContent, {
    locked: t("lockedPreview"),
    empty: t("noContent"),
  });
  const stamp = formatListTimestamp(
    sort === "created" ? note.createdAt : note.updatedAt,
    locale,
    {
      yesterday: t("buckets.yesterday"),
    },
  );

  const locked = note.isPasswordProtected;
  const shared = note.kind === "shared" || note.sharedWith.length > 0;

  const sharedFaces =
    note.kind === "own" && note.sharedWith.length > 0 ? (
      <SharedAvatars
        users={note.sharedWith}
        ringClass="ring-bg-primary"
        label={t("sharing.sharedWith")}
      />
    ) : null;

  /* The faces are rendered twice on purpose.
     A face has to be its own button so it can open the profile drawer, and a
     button cannot sit inside the row button. So the copy *inside* the row is
     inert and invisible — it exists only to reserve the exact space, which
     keeps the meta badges from running under the real stack — and the copy
     outside is laid over that gap. */
  return (
    <div className="notes-row-in relative" style={{ animationDelay: `${enterDelay}s` }}>
      <button
        type="button"
        data-note-row
        onClick={onSelect}
        /* Fires for the context-menu key and Shift+F10 as well as for the mouse.
         A keyboard opening reports 0,0, so anchor to the row instead. */
        onContextMenu={(event) => {
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          onContextMenu(
            event.clientX === 0 && event.clientY === 0
              ? { x: box.left + 16, y: box.top + box.height / 2 }
              : { x: event.clientX, y: event.clientY },
          );
        }}
        aria-current={selected ? "true" : undefined}
        className={`relative w-full border-b border-l-2 border-border-light/45 border-l-transparent px-3.5 py-3 text-left transition-colors duration-[300ms] ${
          selected ? "bg-accent-primary/[0.07]" : "hover:bg-accent-primary/[0.05]"
        }`}
      >
        {/* The marker scales in from its own centre — `dash-grow`'s
            transform-origin trick turned on its side. The old ring had nothing
            to animate, so a selection change was a colour swap and no more. */}
        <span
          aria-hidden="true"
          className={`absolute inset-y-0 -left-[2px] w-[2px] origin-center bg-accent-primary transition-transform duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.25,1)] ${
            selected ? "scale-y-100" : "scale-y-0"
          }`}
        />

        <span className="flex items-baseline gap-2.5">
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold tracking-[-0.008em] text-fg-primary">
            {title}
          </span>
          <span className={`${STAMP} flex-shrink-0`}>{stamp}</span>
        </span>

        <span className="mt-1 block truncate text-[12.5px] text-fg-tertiary">
          {preview}
        </span>

        <span className="mt-2 flex items-center gap-1.5">
          {/* Lock and share are independent facts. The old card put them in one
            ternary, so a shared note that was also encrypted showed neither
            lock nor key — only "Shared". */}
          {locked && (
            <Badge tone="lock" icon={<Lock size={9} />}>
              {t("filters.locked")}
            </Badge>
          )}
          {note.kind === "shared" ? (
            <Badge tone="share" icon={<Users size={9} />}>
              {note.permission === "write"
                ? t("sharing.canEdit")
                : t("sharing.viewOnly")}
            </Badge>
          ) : (
            shared && (
              <Badge tone="share" icon={<Users size={9} />}>
                {String(note.sharedWith.length)}
              </Badge>
            )
          )}
          {note.calendarDate && (
            <Badge tone="calendar" icon={<CalendarDays size={9} />}>
              {note.calendarDate.toLocaleDateString(locale, {
                day: "numeric",
                month: "short",
              })}
            </Badge>
          )}
          {notebookName && <Badge>{notebookName}</Badge>}

          <span className="flex-1" />

          {sharedFaces && (
            <span aria-hidden="true" className="invisible">
              {sharedFaces}
            </span>
          )}
          {note.kind === "shared" && (
            <span className={`${STAMP} max-w-[120px] truncate normal-case`}>
              {t("sharing.fromOwner", {
                owner: note.ownerName ?? note.ownerEmail ?? "",
              })}
            </span>
          )}
        </span>
      </button>

      {sharedFaces && (
        <span className="absolute right-3.5 bottom-3 z-10 flex">
          <SharedAvatars
            users={note.sharedWith}
            ringClass="ring-bg-primary"
            label={t("sharing.sharedWith")}
            peek
          />
        </span>
      )}
    </div>
  );
}

/**
 * Nothing to show, and why.
 *
 * Three of these six branches used to be a single grey line of `text-sm` — a
 * filter that matched nothing looked indistinguishable from a rendering
 * failure. They all get the outlined disc and a second line now, and the disc
 * is the same shape as the lock gate's badge and every dialog's icon tile.
 */
function EmptyList({
  query,
  filter,
  view,
  onNewNote,
}: {
  query: string;
  filter: NoteFilter;
  view: NoteView;
  onNewNote: () => void;
}) {
  const t = useTranslations("notes");

  if (query.trim()) {
    return (
      <Empty
        tone="error"
        icon={<Search size={22} />}
        title={t("searchEmpty", { query })}
        body={t("searchEmptyHint")}
      />
    );
  }

  if (filter !== "all") {
    return (
      <Empty
        tone={filter === "locked" ? "error" : "accent"}
        icon={
          filter === "locked" ? (
            <Lock size={22} />
          ) : filter === "shared" ? (
            <Users size={22} />
          ) : (
            <FolderOpen size={22} />
          )
        }
        title={t(`filters.empty.${filter}`)}
        body={t(`filters.emptyHint.${filter}`)}
      />
    );
  }

  if (view === "shared") {
    return (
      <Empty
        icon={<Users size={22} />}
        title={t("sharing.emptyTitle")}
        body={t("sharing.emptyDesc")}
      />
    );
  }

  if (view === "calendar") {
    return (
      <Empty
        tone="info"
        icon={<CalendarDays size={22} />}
        title={t("calendar.emptyTitle")}
        body={t("calendar.emptyDesc")}
      />
    );
  }

  return (
    <Empty
      icon={<FileText size={22} />}
      title={view === "all" ? t("empty.title") : t("empty.notebookTitle")}
      body={t("empty.description")}
      action={
        <button type="button" onClick={onNewNote} className={BTN_ACCENT}>
          <Plus size={14} />
          {t("actions.create")}
        </button>
      }
    />
  );
}

/**
 * The shared empty-state shape.
 *
 * The disc pops on the overshoot curve and the copy follows it, which is the
 * `kairos-scale-in` / `calendar-pop` pairing the rest of the app uses for a
 * panel arriving.
 */
function Empty({
  tone = "accent",
  icon,
  title,
  body,
  action,
}: {
  tone?: "accent" | "error" | "info";
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  const tones = {
    accent: "border-accent-primary/30 text-accent-primary",
    error: "border-error/35 text-error",
    info: "border-info/30 text-info",
  } as const;

  return (
    <div className="grid place-items-center px-6 py-14 text-center">
      <div className="max-w-[280px]">
        <div
          className={`notes-disc-in mx-auto mb-4 grid h-[54px] w-[54px] place-items-center rounded-full border ${tones[tone]}`}
        >
          {icon}
        </div>
        <p
          className="calendar-pop text-[15px] font-bold tracking-[-0.012em] text-fg-primary"
          style={{ animationDelay: "0.08s" }}
        >
          {title}
        </p>
        <p
          className="calendar-pop mt-2 text-[12.5px] leading-relaxed text-fg-tertiary"
          style={{ animationDelay: "0.12s" }}
        >
          {body}
        </p>
        {action && (
          <div className="calendar-pop mt-5" style={{ animationDelay: "0.16s" }}>
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
