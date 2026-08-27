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
  MoreHorizontal,
  Share2,
  Trash2,
  X,
} from "lucide-react";

import { Menu, MenuItem, MenuLabel, MenuSeparator } from "./Menu";
import { LockGate } from "./LockGate";
import { useAutosave, type SaveStatus } from "./useAutosave";
import { MetaChip, SharedAvatars } from "./notesUi";
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
  isPending: boolean;
}

export function NotePage({
  note,
  isDraft,
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

  // ── nothing selected ───────────────────────────────────────────────
  if (!note && !isDraft) {
    return (
      <div className="hidden md:grid place-items-center h-full bg-bg-primary p-6 text-center">
        <div>
          <div className="w-14 h-14 rounded-full bg-accent-primary/10 grid place-items-center mx-auto mb-3">
            <FileText size={24} className="text-accent-primary" />
          </div>
          <p className="text-sm font-semibold text-fg-primary mb-1">{t("empty.noSelection")}</p>
          <p className="text-xs text-fg-tertiary mb-4">{t("empty.noSelectionDesc")}</p>
          <button
            type="button"
            onClick={onNewNote}
            className="px-4 py-2 rounded-lg bg-accent-primary/10 text-accent-primary text-sm font-semibold hover:bg-accent-primary/20 transition-colors"
          >
            {t("actions.create")}
          </button>
        </div>
      </div>
    );
  }

  const notebookName = notebooks.find(
    (nb) => nb.id === (isDraft ? draftNotebookId : note?.notebookId),
  )?.name;
  const calendarDate = isDraft ? draftCalendarDate : (note?.calendarDate ?? null);

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      <header className="flex items-center gap-1.5 px-3 md:px-5 py-2.5 flex-none border-b border-border-light/40">
        <button
          type="button"
          onClick={() => {
            void autosave.flush();
            onBack();
          }}
          aria-label={t("common.back")}
          className="p-2 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-bg-secondary transition-colors md:hidden"
        >
          <ArrowLeft size={18} />
        </button>

        <p className="flex-1 min-w-0 flex items-center gap-1.5 text-[11px] text-fg-tertiary truncate">
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
            className={`p-2 rounded-lg transition-colors ${
              note.sharedWith.length > 0
                ? "bg-accent-primary/12 text-accent-primary hover:bg-accent-primary/20"
                : "text-fg-tertiary hover:text-fg-primary hover:bg-bg-secondary"
            }`}
          >
            <Share2 size={16} />
          </button>
        )}

        {(isOwn || isDraft) && (
          <Menu label={t("common.noteActions")} icon={<MoreHorizontal size={16} />}>
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
        <div className="flex-1 min-h-0 grid place-items-center p-6 text-center">
          <div className="max-w-[300px]">
            <div className="w-[52px] h-[52px] rounded-2xl bg-error/10 text-error grid place-items-center mx-auto mb-3.5">
              <Lock size={22} />
            </div>
            <h2 className="text-lg font-bold text-fg-primary">{t("password.gateTitle")}</h2>
            <p className="mt-1 text-xs text-fg-tertiary leading-relaxed">
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
          isPending={lock.isPending}
          canReset={isOwn}
          onUnlock={onUnlock}
          onResetPassword={onResetPassword}
          subtitle={t("password.gateSubtitle", {
            edited: note ? formatFullDate(note.updatedAt) : "",
          })}
        />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-4 md:px-10 pt-5 pb-2">
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
            className="w-full bg-transparent text-2xl md:text-[28px] font-bold text-fg-primary placeholder:text-fg-quaternary focus:outline-none"
          />

          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 mb-3 text-[10px] font-medium uppercase tracking-wide text-fg-quaternary">
            {note && (
              <>
                <span>{t("meta.createdOn", { date: formatFullDate(note.createdAt) })}</span>
                <span aria-hidden="true">·</span>
                <span>{t("meta.editedOn", { date: formatFullDate(note.updatedAt) })}</span>
              </>
            )}
            {note?.kind === "shared" && (
              <>
                <span aria-hidden="true">·</span>
                <span>{t("sharing.fromOwner", { owner: note.ownerName ?? note.ownerEmail ?? "" })}</span>
              </>
            )}
            {calendarDate && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-info">
                  {t("calendar.onDate", {
                    date: calendarDate.toLocaleDateString(locale, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    }),
                  })}
                </span>
              </>
            )}
          </p>

          {showDatePicker && (
            <div className="flex items-center gap-2 mb-3 p-2.5 rounded-xl bg-bg-secondary">
              <CalendarDays size={14} className="text-info flex-shrink-0" />
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
                className="flex-1 px-2.5 py-1.5 text-xs bg-bg-primary rounded-lg text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/35"
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
                  className="px-2 py-1.5 rounded-lg text-[11px] font-semibold text-fg-tertiary hover:text-error transition-colors"
                >
                  {t("calendar.remove")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowDatePicker(false)}
                aria-label={t("common.close")}
                className="p-1 rounded-lg text-fg-tertiary hover:text-fg-primary transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {isDraft && showPasswordField && (
            <div className="flex items-center gap-2 mb-3 p-2.5 rounded-xl bg-bg-secondary">
              <Lock size={14} className="text-error flex-shrink-0" />
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
                className="flex-1 px-2.5 py-1.5 text-xs bg-bg-primary rounded-lg text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/35"
              />
              <button
                type="button"
                onClick={() => {
                  setDraftPassword("");
                  setShowPasswordField(false);
                }}
                aria-label={t("common.close")}
                className="p-1 rounded-lg text-fg-tertiary hover:text-fg-primary transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {readOnly ? (
            <p className="flex-1 whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">
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
                className="flex-1 min-h-[240px] w-full bg-transparent text-sm leading-relaxed text-fg-secondary placeholder:text-fg-quaternary focus:outline-none resize-none"
              />
            </>
          )}
        </div>
      )}

      <footer className="flex items-center gap-2 px-4 md:px-5 py-2.5 flex-none border-t border-border-light/40 bg-bg-surface">
        {notebookName && <MetaChip>{notebookName}</MetaChip>}
        {calendarDate && (
          <MetaChip tone="calendar" icon={<CalendarDays size={9} />}>
            {calendarDate.toLocaleDateString(locale, { day: "numeric", month: "short" })}
          </MetaChip>
        )}
        {note?.isPasswordProtected && (
          <MetaChip tone="lock" icon={<Lock size={9} />}>
            {locked ? t("filters.locked") : t("password.unlocked")}
          </MetaChip>
        )}
        {readOnly && note?.kind === "shared" && (
          <MetaChip tone="share">{t("sharing.viewOnly")}</MetaChip>
        )}

        <span className="flex-1" />

        {note?.kind === "own" && note.sharedWith.length > 0 && (
          <SharedAvatars
            users={note.sharedWith}
            ringClass="ring-bg-surface"
            label={t("sharing.sharedWith")}
          />
        )}
        {!locked && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-fg-quaternary tabular-nums">
            {t("meta.words", { count: wordCount(content) })}
          </span>
        )}
      </footer>
    </div>
  );
}

/** The Save button's replacement: a status you can check rather than press. */
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

  if (status === "saving") {
    return (
      <span className="flex items-center gap-1.5 mr-1 text-[10px] font-semibold uppercase tracking-wide text-fg-tertiary">
        <Loader2 size={11} className="animate-spin" />
        {t("actions.saving")}
      </span>
    );
  }

  if (status === "error") {
    return (
      <span
        role="alert"
        className="flex items-center gap-1.5 mr-1 text-[10px] font-semibold uppercase tracking-wide text-error"
      >
        <CloudOff size={11} />
        {t("messages.saveFailed")}
      </span>
    );
  }

  if (status === "dirty") {
    return (
      <span className="flex items-center gap-1.5 mr-1 text-[10px] font-semibold uppercase tracking-wide text-fg-quaternary">
        <AlertCircle size={11} />
        {t("messages.unsaved")}
      </span>
    );
  }

  if (status === "saved" && savedAt) {
    return (
      <span className="flex items-center gap-1.5 mr-1 text-[10px] font-semibold uppercase tracking-wide text-success">
        <Check size={11} />
        {t("messages.savedAt", {
          time: savedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
        })}
      </span>
    );
  }

  return null;
}
