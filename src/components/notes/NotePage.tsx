"use client";

/**
 * The writing surface.
 *
 * The old editor was a `max-w-lg` dialog over a 70%-black scrim, with a
 * `min-h-[200px] resize-none` textarea and a Save button that closed the note
 * and refetched the whole list. This is the same note at full height, next to
 * the list it came from, saving itself as you pause.
 *
 * Three things it will not let you do, because the server will not either: edit
 * a note shared with you read-only, edit a note that is still encrypted, or
 * unlock someone else's encrypted note — `verifyPassword` is owner-only, so a
 * recipient gets an explanation rather than a password field that cannot work.
 *
 * The title is set in the display serif at 34px. The chrome around it — the
 * breadcrumb, the save state, the meta line, the word count — is mono
 * micro-label. Giving the thing you are writing a different voice from the
 * furniture is the move `CalendarClient` makes with its `font-display` month
 * heading, and it is the only place on this surface where the display face
 * appears.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Check,
  CloudOff,
  FileText,
  FolderOpen,
  Loader2,
  Lock,
  LockOpen,
  MoreHorizontal,
  Plus,
  Share2,
  Trash2,
  X,
} from "~/components/ui/icons";

import { Menu, MenuItem, MenuLabel, MenuSeparator } from "./Menu";
import { LockGate } from "./LockGate";
import { useAutosave, type SaveStatus } from "./useAutosave";
import {
  Badge,
  BTN_ACCENT,
  ICON_BTN_BARE,
  ICON_BTN_ON,
  MICRO,
  SharedAvatars,
} from "./notesUi";
import {
  fromDateInputValue,
  toDateInputValue,
  wordCount,
  type NoteItem,
} from "./notesData";

export interface DraftInput {
  title: string;
  content: string;
  password: string | null;
  notebookId: number | null;
  calendarDate: Date | null;
}

export interface LockState {
  password: string;
  reveal: boolean;
  error: string | null;
  /** Refusals so far for this note. Replays the gate's shake. */
  attempt: number;
  isPending: boolean;
}

/** An inline strip: the calendar-date picker and the draft password field. */
const STRIP =
  "notes-strip mb-4 flex items-center gap-2.5 rounded-[10px] border border-border-medium bg-bg-surface px-3 py-2.5";
const STRIP_INPUT =
  "min-w-0 flex-1 rounded-lg border border-border-medium bg-bg-elevated px-2.5 py-1.5 text-[12px] tabular-nums text-fg-primary outline-none transition-colors focus:border-accent-primary/60 focus:ring-[3px] focus:ring-accent-primary/10";

export function NotePage({
  note,
  isDraft,
  isLoading = false,
  notebooks,
  unlockedContent,
  locale,
  formatFullDate,
  lock,
  onLockPasswordChange,
  onToggleReveal,
  onUnlock,
  onResetPassword,
  onSave,
  onCreate,
  onDelete,
  onShare,
  onMoveToNotebook,
  onSetCalendarDate,
  onBack,
  onNewNote,
}: {
  note: NoteItem | null;
  isDraft: boolean;
  /**
   * The route names a note the queries have not returned yet.
   *
   * Without this, a hard load of `/notes/5` renders "Nothing open" for as long
   * as the fetch takes and then replaces it with the note — an empty state that
   * was never true. It exists because the route-level `loading.tsx` was removed;
   * see the note in `NotesWorkspace`.
   */
  isLoading?: boolean;
  notebooks: Array<{ id: number; name: string }>;
  /** Decrypted body, present only while the note is unlocked this session. */
  unlockedContent: string | undefined;
  locale: string;
  formatFullDate: (date: Date) => string;
  lock: LockState;
  onLockPasswordChange: (next: string) => void;
  onToggleReveal: () => void;
  onUnlock: () => void;
  onResetPassword: () => void;
  onSave: (input: { id: number; title: string; content: string }) => Promise<void>;
  onCreate: (input: DraftInput) => Promise<void>;
  onDelete: () => void;
  onShare: () => void;
  onMoveToNotebook: (notebookId: number | null) => void;
  onSetCalendarDate: (date: Date | null) => void;
  onBack: () => void;
  onNewNote: () => void;
}) {
  const t = useTranslations("notes");

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Draft-only metadata, held locally until the note exists to hang it on.
  const [draftPassword, setDraftPassword] = useState("");
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [draftNotebookId, setDraftNotebookId] = useState<number | null>(null);
  const [draftCalendarDate, setDraftCalendarDate] = useState<Date | null>(null);

  const titleRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const locked = !!note?.isPasswordProtected && unlockedContent === undefined;
  const isOwn = note?.kind === "own";
  const readOnly =
    !isDraft && (!note || locked || (note.kind === "shared" && note.permission !== "write"));

  const body = unlockedContent ?? note?.content ?? "";

  /* Re-seed the editor when the note changes, and again the moment a locked
     note is unlocked — but never on an ordinary cache update, or a save landing
     mid-sentence would overwrite what is being typed. */
  const seedKey = `${isDraft ? "draft" : (note?.id ?? "none")}:${unlockedContent !== undefined}`;
  useEffect(() => {
    if (isDraft) {
      setTitle("");
      setContent("");
      setDraftPassword("");
      setShowPasswordField(false);
      setDraftNotebookId(null);
      setDraftCalendarDate(null);
      titleRef.current?.focus();
      return;
    }
    setTitle(note?.title ?? "");
    setContent(body);
    setShowDatePicker(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  /* A snapshot carries its own destination — `noteId: null` means "this is
     still a draft, create it". An edit can outlive the pane that made it: click
     another note mid-sentence and the unsaved text is handed off and written,
     so it must not depend on which note happens to be open when it lands. */
  const snapshot = useMemo(
    () => ({
      noteId: isDraft ? null : (note?.id ?? null),
      title,
      content,
      password: isDraft ? draftPassword.trim() || null : null,
      notebookId: isDraft ? draftNotebookId : null,
      calendarDate: isDraft ? draftCalendarDate : null,
    }),
    [isDraft, note?.id, title, content, draftPassword, draftNotebookId, draftCalendarDate],
  );

  const baseline = useMemo(
    () => ({
      noteId: isDraft ? null : (note?.id ?? null),
      title: isDraft ? "" : (note?.title ?? ""),
      content: isDraft ? "" : body,
      password: null,
      notebookId: null,
      calendarDate: null,
    }),
    [isDraft, note?.id, note?.title, body],
  );

  const autosave = useAutosave({
    value: snapshot,
    baseline,
    keyId: isDraft ? "draft" : (note?.id ?? null),
    /* A draft only becomes a note once it has a body — `note.create` requires
       one, and an empty page you clicked away from is not a note. */
    enabled: isDraft ? content.trim().length > 0 : !readOnly && note !== null,
    onSave: async (value) => {
      if (value.noteId === null) {
        await onCreate({
          title: value.title,
          content: value.content,
          password: value.password,
          notebookId: value.notebookId,
          calendarDate: value.calendarDate,
        });
        return;
      }
      await onSave({ id: value.noteId, title: value.title, content: value.content });
    },
  });

  /* Leaving the surface entirely still has to write what is pending; a note
     *switch* is handled by the hook, which knows which note the text came
     from. */
  const flushRef = useRef(autosave.flush);
  flushRef.current = autosave.flush;
  useEffect(() => {
    return () => {
      void flushRef.current();
    };
  }, []);

  // ── the note is named but not here yet ─────────────────────────────
  if (!note && !isDraft && isLoading) {
    return (
      <div className="flex h-full flex-col bg-bg-primary" aria-busy="true">
        <div className="min-h-[48px] flex-none border-b border-border-light/60 px-4 py-2">
          <div className="kairos-shimmer h-3 w-24 rounded" />
        </div>
        <div className="min-h-0 flex-1 px-5 pt-6 md:px-10">
          {/* 34px display serif, so the placeholder is that tall. */}
          <div className="kairos-shimmer h-8 w-3/5 rounded" />
          <div className="kairos-shimmer mt-4 h-2.5 w-2/5 rounded" />
          <div className="mt-5 mb-5 h-px bg-border-light/50" />
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="kairos-shimmer h-2.5 rounded"
                style={{ width: `${90 - (i % 4) * 12}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── nothing selected ───────────────────────────────────────────────
  if (!note && !isDraft) {
    return (
      <div className="hidden h-full place-items-center bg-bg-primary p-6 text-center md:grid">
        <div className="max-w-[280px]">
          <div className="notes-disc-in mx-auto mb-4 grid h-[54px] w-[54px] place-items-center rounded-full border border-accent-primary/30 text-accent-primary">
            <FileText size={22} />
          </div>
          <p
            className="calendar-pop text-[15px] font-bold tracking-[-0.012em] text-fg-primary"
            style={{ animationDelay: "0.08s" }}
          >
            {t("empty.noSelection")}
          </p>
          <p
            className="calendar-pop mt-2 text-[12.5px] leading-relaxed text-fg-tertiary"
            style={{ animationDelay: "0.12s" }}
          >
            {t("empty.noSelectionDesc")}
          </p>
          <div className="calendar-pop mt-5" style={{ animationDelay: "0.16s" }}>
            <button type="button" onClick={onNewNote} className={BTN_ACCENT}>
              <Plus size={14} />
              {t("actions.create")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const notebookName = notebooks.find(
    (nb) => nb.id === (isDraft ? draftNotebookId : note?.notebookId),
  )?.name;
  const calendarDate = isDraft ? draftCalendarDate : (note?.calendarDate ?? null);

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      <header className="flex min-h-[48px] flex-none items-center gap-2 border-b border-border-light/60 px-3 py-2 md:px-4">
        <button
          type="button"
          onClick={() => {
            void autosave.flush();
            onBack();
          }}
          aria-label={t("common.back")}
          className={`${ICON_BTN_BARE} -ml-1 md:hidden`}
        >
          <ArrowLeft size={18} />
        </button>

        <p className={`${MICRO} flex min-w-0 flex-1 items-center gap-1.5 truncate`}>
          {notebookName ? (
            <>
              <BookOpen size={12} className="flex-shrink-0" />
              <span className="truncate">{notebookName}</span>
            </>
          ) : (
            <span className="truncate">{isDraft ? t("draft") : t("unfiledNote")}</span>
          )}
        </p>

        <SaveIndicator status={autosave.status} savedAt={autosave.savedAt} locale={locale} readOnly={readOnly} />

        {isOwn && !isDraft && (
          <button
            type="button"
            onClick={onShare}
            aria-label={note.sharedWith.length > 0 ? t("manageSharing") : t("share")}
            title={note.sharedWith.length > 0 ? t("manageSharing") : t("share")}
            className={note.sharedWith.length > 0 ? ICON_BTN_ON : ICON_BTN_BARE}
          >
            <Share2 size={15} />
          </button>
        )}

        {(isOwn || isDraft) && (
          <Menu label={t("common.noteActions")} icon={<MoreHorizontal size={15} />}>
            {(close) => (
              <>
                <MenuLabel>{t("notebook")}</MenuLabel>
                <MenuItem
                  icon={
                    (isDraft ? draftNotebookId : note?.notebookId) === null ? (
                      <Check size={13} className="text-accent-primary" />
                    ) : (
                      <span className="w-[13px]" />
                    )
                  }
                  onClick={() => {
                    if (isDraft) setDraftNotebookId(null);
                    else onMoveToNotebook(null);
                    close();
                  }}
                >
                  {t("common.none")}
                </MenuItem>
                {notebooks.map((nb) => (
                  <MenuItem
                    key={nb.id}
                    icon={
                      (isDraft ? draftNotebookId : note?.notebookId) === nb.id ? (
                        <Check size={13} className="text-accent-primary" />
                      ) : (
                        <FolderOpen size={13} />
                      )
                    }
                    onClick={() => {
                      if (isDraft) setDraftNotebookId(nb.id);
                      else onMoveToNotebook(nb.id);
                      close();
                    }}
                  >
                    {nb.name}
                  </MenuItem>
                ))}

                <MenuSeparator />
                <MenuItem
                  icon={<CalendarDays size={13} />}
                  onClick={() => {
                    setShowDatePicker(true);
                    close();
                  }}
                >
                  {calendarDate ? t("calendar.change") : t("calendar.addToCalendar")}
                </MenuItem>

                {isDraft && (
                  <MenuItem
                    icon={<Lock size={13} />}
                    onClick={() => {
                      setShowPasswordField(true);
                      close();
                    }}
                  >
                    {t("password.protect")}
                  </MenuItem>
                )}

                {!isDraft && (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      icon={<Trash2 size={13} />}
                      destructive
                      onClick={() => {
                        close();
                        onDelete();
                      }}
                    >
                      {t("actions.delete")}
                    </MenuItem>
                  </>
                )}
              </>
            )}
          </Menu>
        )}
      </header>

      {/* A recipient cannot decrypt someone else's note: the server only
          verifies a password for the owner. Say that, rather than offering a
          field that is guaranteed to fail. */}
      {note?.kind === "shared" && note.isPasswordProtected ? (
        <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
          <div className="notes-pane-in max-w-[300px]">
            <div className="notes-disc-in mx-auto mb-4 grid h-[54px] w-[54px] place-items-center rounded-full border border-error/35 text-error">
              <Lock size={22} />
            </div>
            <h2 className="text-[15.5px] font-bold tracking-[-0.012em] text-fg-primary">
              {t("password.gateTitle")}
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-fg-tertiary">
              {t("password.ownerOnly", { owner: note.ownerName ?? note.ownerEmail ?? "" })}
            </p>
          </div>
        </div>
      ) : locked ? (
        <LockGate
          password={lock.password}
          onPasswordChange={onLockPasswordChange}
          reveal={lock.reveal}
          onToggleReveal={onToggleReveal}
          error={lock.error}
          attempt={lock.attempt}
          isPending={lock.isPending}
          canReset={isOwn}
          onUnlock={onUnlock}
          onResetPassword={onResetPassword}
          subtitle={t("password.gateSubtitle", {
            edited: note ? formatFullDate(note.updatedAt) : "",
          })}
        />
      ) : (
        /* Deliberately not animated, and deliberately not keyed.
           An earlier pass keyed this column on the note and faded it in, which
           looked like the pane reloading every time you picked a row: the title
           input and the textarea were torn down and rebuilt, so the text
           blinked out and back and the caret was lost. The reading surface is
           the one thing on this page that should hold still — the motion is in
           the list, the rail, the menus and the dialogs around it. */
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-6 pb-3 md:px-10">
          <label htmlFor="note-title" className="sr-only">
            {t("create.titlePlaceholder")}
          </label>
          <input
            id="note-title"
            ref={titleRef}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                bodyRef.current?.focus();
              }
            }}
            onBlur={() => void autosave.flush()}
            readOnly={readOnly}
            placeholder={t("untitled")}
            className="w-full bg-transparent font-display text-[28px] leading-[1.14] font-normal tracking-[-0.012em] text-fg-primary placeholder:text-fg-quaternary focus:outline-none md:text-[34px]"
          />

          <p className={`${MICRO} mt-3 mb-4 flex flex-wrap items-center gap-x-3.5 gap-y-1`}>
            {note && (
              <>
                <span>{t("meta.createdOn", { date: formatFullDate(note.createdAt) })}</span>
                <span>{t("meta.editedOn", { date: formatFullDate(note.updatedAt) })}</span>
              </>
            )}
            {note?.kind === "shared" && (
              <span>{t("sharing.fromOwner", { owner: note.ownerName ?? note.ownerEmail ?? "" })}</span>
            )}
            {calendarDate && (
              <span className="text-info">
                {t("calendar.onDate", {
                  date: calendarDate.toLocaleDateString(locale, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }),
                })}
              </span>
            )}
          </p>

          {showDatePicker && (
            <div className={STRIP}>
              <CalendarDays size={14} className="flex-shrink-0 text-info" />
              <label htmlFor="note-calendar-date" className="sr-only">
                {t("calendar.calendarDate")}
              </label>
              <input
                id="note-calendar-date"
                type="date"
                value={toDateInputValue(calendarDate)}
                onChange={(event) => {
                  const next = fromDateInputValue(event.target.value);
                  if (isDraft) {
                    setDraftCalendarDate(next);
                    return;
                  }
                  /* Setting the date is a full `note.update`, which carries the
                     body with it — so anything unsaved has to land first or the
                     older copy would be written back over it. */
                  void autosave.flush().then(() => onSetCalendarDate(next));
                }}
                className={STRIP_INPUT}
              />
              {calendarDate && (
                <button
                  type="button"
                  onClick={() => {
                    if (isDraft) {
                      setDraftCalendarDate(null);
                      return;
                    }
                    void autosave.flush().then(() => onSetCalendarDate(null));
                  }}
                  className="font-mono text-[9.5px] tracking-[0.12em] uppercase text-fg-tertiary transition-colors hover:text-error"
                >
                  {t("calendar.remove")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowDatePicker(false)}
                aria-label={t("common.close")}
                className="kairos-tap grid h-6 w-6 flex-none place-items-center rounded-md text-fg-tertiary transition-colors hover:text-fg-primary"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {isDraft && showPasswordField && (
            <div className={STRIP}>
              <Lock size={14} className="flex-shrink-0 text-error" />
              <label htmlFor="note-password" className="sr-only">
                {t("create.passwordPlaceholder")}
              </label>
              <input
                id="note-password"
                type="password"
                value={draftPassword}
                onChange={(event) => setDraftPassword(event.target.value)}
                placeholder={t("create.passwordPlaceholder")}
                autoComplete="new-password"
                className={STRIP_INPUT}
              />
              <button
                type="button"
                onClick={() => {
                  setDraftPassword("");
                  setShowPasswordField(false);
                }}
                aria-label={t("common.close")}
                className="kairos-tap grid h-6 w-6 flex-none place-items-center rounded-md text-fg-tertiary transition-colors hover:text-fg-primary"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {/* A hairline between the metadata and the prose, so the writing area
              reads as its own field rather than as more header. */}
          <div className="mb-5 h-px flex-none bg-border-light/50" aria-hidden="true" />

          {readOnly ? (
            <p className="flex-1 text-[14.5px] leading-[1.75] whitespace-pre-wrap text-fg-secondary">
              {content || t("noContent")}
            </p>
          ) : (
            <>
              <label htmlFor="note-body" className="sr-only">
                {t("create.contentPlaceholder")}
              </label>
              <textarea
                id="note-body"
                ref={bodyRef}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                onBlur={() => void autosave.flush()}
                placeholder={t("create.contentPlaceholder")}
                className="min-h-[240px] w-full flex-1 resize-none bg-transparent text-[14.5px] leading-[1.75] text-fg-secondary placeholder:text-fg-quaternary focus:outline-none"
              />
            </>
          )}
        </div>
      )}

      <footer className="flex flex-none flex-wrap items-center gap-2 border-t border-border-light/60 bg-bg-surface px-4 py-2.5 md:px-5">
        {notebookName ? <Badge>{notebookName}</Badge> : null}
        {calendarDate && (
          <Badge tone="calendar" icon={<CalendarDays size={9} />}>
            {calendarDate.toLocaleDateString(locale, { day: "numeric", month: "short" })}
          </Badge>
        )}
        {note?.isPasswordProtected && (
          <Badge
            tone={locked ? "lock" : "ok"}
            icon={locked ? <Lock size={9} /> : <LockOpen size={9} />}
          >
            {locked ? t("filters.locked") : t("password.unlocked")}
          </Badge>
        )}
        {readOnly && note?.kind === "shared" && (
          <Badge tone="share">{t("sharing.viewOnly")}</Badge>
        )}

        <span className="flex-1" />

        {note?.kind === "own" && note.sharedWith.length > 0 && (
          <SharedAvatars
            users={note.sharedWith}
            ringClass="ring-bg-surface"
            label={t("sharing.sharedWith")}
            peek
          />
        )}
        {!locked && (
          <span className={`${MICRO} tabular-nums`}>
            {t("meta.words", { count: wordCount(content) })}
          </span>
        )}
      </footer>
    </div>
  );
}

/**
 * The Save button's replacement: a status you can check rather than press.
 *
 * Four states in one slot, keyed so React swaps the node and the cross-fade
 * actually plays — the old version returned four different elements from four
 * early returns, so icon and colour changed in the same frame with nothing
 * connecting them.
 *
 * The proposal also had the `Saved` check drawing its own stroke. That is not
 * buildable through `ui/icons`: the Phosphor glyphs behind it are filled paths,
 * not stroked ones, so there is no stroke for `stroke-dashoffset` to walk along.
 * Hand-authoring one SVG for one checkmark would put a bespoke glyph in the
 * middle of a surface that gets all of them from the shim, which is a worse
 * trade than losing the flourish.
 */
function SaveIndicator({
  status,
  savedAt,
  locale,
  readOnly,
}: {
  status: SaveStatus;
  savedAt: Date | null;
  locale: string;
  readOnly: boolean;
}) {
  const t = useTranslations("notes");
  if (readOnly) return null;

  const shell = "calendar-pop flex flex-none items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.13em]";

  if (status === "saving") {
    return (
      <span key="saving" className={`${shell} text-fg-tertiary`}>
        <Loader2 size={11} className="animate-spin" />
        {t("actions.saving")}
      </span>
    );
  }

  if (status === "error") {
    return (
      <span key="error" role="alert" className={`${shell} text-error`}>
        <CloudOff size={11} />
        {t("messages.saveFailed")}
      </span>
    );
  }

  if (status === "dirty") {
    return (
      <span key="dirty" className={`${shell} text-fg-quaternary`}>
        <AlertCircle size={11} />
        {t("messages.unsaved")}
      </span>
    );
  }

  if (status === "saved" && savedAt) {
    return (
      <span key="saved" className={`${shell} text-success`}>
        <Check size={11} />
        {t("messages.savedAt", {
          time: savedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
        })}
      </span>
    );
  }

  return null;
}
