"use client";

/**
 * The note list: the current query, made visible.
 *
 * This replaces the card grid. A card was a 220-pixel box carrying a badge, a
 * clipped line of body and two timestamps; a row carries the title, a real
 * preview, the notebook, who it is shared with, and whether it is locked — in
 * less vertical space, so more of the corpus is on screen at once. Sort and
 * filter are controls here rather than assumptions baked into the query.
 */

import { useRef } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDownWideNarrow,
  CalendarDays,
  Check,
  FileText,
  Lock,
  Menu as MenuIcon,
  Plus,
  Users,
} from "lucide-react";

import { Menu, MenuItem, MenuLabel } from "./Menu";
import { MetaChip, SharedAvatars } from "./notesUi";
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
}) {
  const t = useTranslations("notes");
  const listRef = useRef<HTMLUListElement | null>(null);

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
    const rows = listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-note-row]");
    if (!rows || rows.length === 0) return;

    event.preventDefault();
    const list = Array.from(rows);
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? list[Math.min(index + 1, list.length - 1)] ?? list[0]
        : list[Math.max(index - 1, 0)] ?? list[0];
    next?.focus();
  };

  const grouped = groupNotes(notes, sort);

  return (
    <div className="flex flex-col h-full bg-bg-secondary md:border-r md:border-border-light/40">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2.5 flex-none">
        <button
          type="button"
          onClick={onOpenRail}
          aria-label={t("common.openLibrary")}
          className="p-2 -ml-1 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-bg-tertiary transition-colors md:hidden"
        >
          <MenuIcon size={18} />
        </button>

        <h2 className="flex-1 min-w-0 truncate text-sm font-bold text-fg-primary">{heading}</h2>

        <Menu
          label={t("sort.label")}
          icon={
            <span className="flex items-center gap-1.5">
              <ArrowDownWideNarrow size={13} />
              <span className="text-[10px] font-semibold uppercase tracking-wide">{sortLabels[sort]}</span>
            </span>
          }
          triggerClassName="px-2 py-1.5 rounded-lg bg-bg-tertiary text-fg-tertiary hover:text-fg-primary transition-colors"
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
          className="p-2 rounded-lg text-accent-primary hover:bg-accent-primary/10 transition-colors md:hidden"
        >
          <Plus size={18} />
        </button>
      </div>

      <div
        className="flex gap-1.5 px-4 pb-2.5 flex-none overflow-x-auto"
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
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap transition-colors ${
              filter === entry.key
                ? "bg-accent-primary/12 text-accent-primary ring-1 ring-accent-primary/30"
                : "bg-bg-tertiary text-fg-tertiary hover:text-fg-secondary"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-4">
        {isLoading ? (
          <ul className="flex flex-col gap-1 p-2" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i} className="p-2.5 space-y-2">
                <div className="h-3 w-1/2 rounded bg-bg-tertiary animate-pulse" />
                <div className="h-2.5 w-4/5 rounded bg-bg-tertiary animate-pulse" />
                <div className="h-2 w-1/4 rounded bg-bg-tertiary animate-pulse" />
              </li>
            ))}
          </ul>
        ) : notes.length === 0 ? (
          <EmptyList query={query} filter={filter} view={view} onNewNote={onNewNote} />
        ) : (
          <ul
            ref={listRef}
            className="flex flex-col gap-0.5"
            aria-label={heading}
            onKeyDown={onListKeyDown}
          >
            {grouped.map((group) => (
              <li key={group.key}>
                {group.label && (
                  <p className="px-2.5 pt-3 pb-1.5 text-[9.5px] font-semibold uppercase tracking-widest text-fg-quaternary">
                    {t(`buckets.${group.label}`)}
                  </p>
                )}
                <ul className="flex flex-col gap-0.5">
                  {group.notes.map((note) => (
                    <li key={`${note.kind}-${note.id}`}>
                      <NoteRow
                        note={note}
                        selected={note.id === selectedId}
                        unlockedContent={unlocked[note.id]}
                        notebookName={notebookNameOf(note.notebookId)}
                        locale={locale}
                        sort={sort}
                        onSelect={() => onSelect(note.id)}
                      />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        {/* Encrypted notes never leave the server decrypted, so search cannot
            look inside them. Silence would read as "no match". */}
        {query.trim() !== "" && lockedExcluded > 0 && (
          <p className="flex items-start gap-2 px-3 pt-4 text-[11px] text-fg-quaternary">
            <Lock size={12} className="mt-0.5 flex-shrink-0" />
            {t("searchLockedExcluded", { count: lockedExcluded })}
          </p>
        )}
      </div>
    </div>
  );
}

function NoteRow({
  note,
  selected,
  unlockedContent,
  notebookName,
  locale,
  sort,
  onSelect,
}: {
  note: NoteItem;
  selected: boolean;
  unlockedContent: string | undefined;
  notebookName: string | null;
  locale: string;
  sort: NoteSort;
  onSelect: () => void;
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
  const stamp = formatListTimestamp(sort === "created" ? note.createdAt : note.updatedAt, locale, {
    yesterday: t("buckets.yesterday"),
  });

  const locked = note.isPasswordProtected;
  const shared = note.kind === "shared" || note.sharedWith.length > 0;

  return (
    <button
      type="button"
      data-note-row
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`relative w-full text-left px-2.5 py-2.5 rounded-xl transition-colors ${
        selected
          ? "bg-bg-elevated kairos-system-card ring-1 ring-accent-primary/20"
          : "hover:bg-bg-tertiary"
      }`}
    >
      {selected && (
        <span className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-accent-primary" aria-hidden="true" />
      )}

      <span className="flex items-baseline gap-2">
        <span className="flex-1 min-w-0 truncate text-[13px] font-semibold text-fg-primary">{title}</span>
        <span className="text-[10px] tabular-nums text-fg-quaternary flex-shrink-0">{stamp}</span>
      </span>

      <span className="block mt-0.5 truncate text-xs text-fg-tertiary">{preview}</span>

      <span className="flex items-center gap-1.5 mt-1.5">
        {/* Lock and share are independent facts. The old card put them in one
            ternary, so a shared note that was also encrypted showed neither
            lock nor key — only "Shared". */}
        {locked && (
          <MetaChip tone="lock" icon={<Lock size={9} />}>
            {t("filters.locked")}
          </MetaChip>
        )}
        {note.kind === "shared" ? (
          <MetaChip tone="share" icon={<Users size={9} />}>
            {note.permission === "write" ? t("sharing.canEdit") : t("sharing.viewOnly")}
          </MetaChip>
        ) : (
          shared && (
            <MetaChip tone="share" icon={<Users size={9} />}>
              {String(note.sharedWith.length)}
            </MetaChip>
          )
        )}
        {note.calendarDate && (
          <MetaChip tone="calendar" icon={<CalendarDays size={9} />}>
            {note.calendarDate.toLocaleDateString(locale, { day: "numeric", month: "short" })}
          </MetaChip>
        )}
        {notebookName && <MetaChip>{notebookName}</MetaChip>}

        <span className="flex-1" />

        {note.kind === "own" && note.sharedWith.length > 0 && (
          <SharedAvatars
            users={note.sharedWith}
            ringClass={selected ? "ring-bg-elevated" : "ring-bg-secondary"}
            label={t("sharing.sharedWith")}
          />
        )}
        {note.kind === "shared" && (
          <span className="text-[10px] text-fg-quaternary truncate max-w-[120px]">
            {t("sharing.fromOwner", { owner: note.ownerName ?? note.ownerEmail ?? "" })}
          </span>
        )}
      </span>
    </button>
  );
}

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
      <div className="py-16 px-6 text-center">
        <p className="text-sm text-fg-secondary">{t("searchEmpty", { query })}</p>
      </div>
    );
  }

  if (filter !== "all") {
    return (
      <div className="py-16 px-6 text-center">
        <p className="text-sm text-fg-secondary">{t(`filters.empty.${filter}`)}</p>
      </div>
    );
  }

  if (view === "shared") {
    return (
      <div className="py-16 px-6 text-center">
        <div className="w-14 h-14 rounded-full bg-accent-primary/10 grid place-items-center mx-auto mb-3">
          <Users size={24} className="text-accent-primary" />
        </div>
        <p className="text-sm font-semibold text-fg-primary mb-1">{t("sharing.emptyTitle")}</p>
        <p className="text-xs text-fg-tertiary">{t("sharing.emptyDesc")}</p>
      </div>
    );
  }

  if (view === "calendar") {
    return (
      <div className="py-16 px-6 text-center">
        <div className="w-14 h-14 rounded-full bg-info/10 grid place-items-center mx-auto mb-3">
          <CalendarDays size={24} className="text-info" />
        </div>
        <p className="text-sm font-semibold text-fg-primary mb-1">{t("calendar.emptyTitle")}</p>
        <p className="text-xs text-fg-tertiary">{t("calendar.emptyDesc")}</p>
      </div>
    );
  }

  return (
    <div className="py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-full bg-accent-primary/10 grid place-items-center mx-auto mb-3">
        <FileText size={24} className="text-accent-primary" />
      </div>
      <p className="text-sm font-semibold text-fg-primary mb-1">
        {view === "all" ? t("empty.title") : t("empty.notebookTitle")}
      </p>
      <p className="text-xs text-fg-tertiary mb-4">{t("empty.description")}</p>
      <button
        type="button"
        onClick={onNewNote}
        className="px-4 py-2 rounded-lg bg-accent-primary/10 text-accent-primary text-sm font-semibold hover:bg-accent-primary/20 transition-colors"
      >
        {t("actions.create")}
      </button>
    </div>
  );
}

