"use client";

/**
 * The notes surface: rail, list, page.
 *
 * This replaces the single 1394-line `NotesDashboard` and its four stacked
 * modals. The parts that were right are moved rather than rewritten — the
 * in-memory unlock map that lets a save re-encrypt with the password you typed,
 * the `keepUnlockedUntilClose` setting that decides how long it lives, the
 * org-aware share lookup. What is new is everything the old shell hid: sort,
 * filters, notebook renaming, a calendar date you can change after creating the
 * note, and a writing surface that is not a dialog.
 *
 * Selection is a route (`/notes/[noteId]`), not component state. That is what
 * makes the back button work on mobile, lets a notification deep link land on
 * the right note, and keeps the URL shareable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { useDateFormat } from "~/hooks/useDateFormat";

import { ConfirmDialog } from "./ConfirmDialog";
import { LockNoteDialog } from "./LockNoteDialog";
import { NoteList } from "./NoteList";
import { NotePage, type DraftInput } from "./NotePage";
import { NotebookDialog } from "./NotebookDialog";
import { NotesRail, type RailNotebook } from "./NotesRail";
import { PinResetDialog } from "./PinResetDialog";
import { RemoveLockDialog } from "./RemoveLockDialog";
import { ShareDialog } from "./ShareDialog";
import { exitMs, PANE_SWAP_MS, SHEET_EXIT_MS } from "./notesMotion";
import {
  countLockedExcluded,
  notebookIdOfView,
  selectNotes,
  type NoteFilter,
  type NoteItem,
  type NoteSort,
  type NoteView,
} from "./notesData";

const SORT_STORAGE_KEY = "kairos.notes.sort";
/** Wrong-password attempts before the PIN reset is offered. */
const RESET_PROMPT_AFTER = 2;

/**
 * Which note the URL is asking for.
 *
 * Read from the pathname rather than handed down from the page, because the
 * page is the segment that changes and this component now lives above it in
 * `(workspace)/layout.tsx` — see that file. It also means one code path serves
 * a cold load, a deep link, the back button and an in-app selection.
 */
function selectionOf(pathname: string): { noteId: number | null; isDraft: boolean } {
  const rest = pathname.replace(/^\/notes\/?/, "");
  if (rest === "new") return { noteId: null, isDraft: true };
  const id = Number(rest);
  return Number.isInteger(id) && id > 0
    ? { noteId: id, isDraft: false }
    : { noteId: null, isDraft: false };
}

/**
 * Move to a note without asking the server for a page.
 *
 * `router.push` re-renders the `[noteId]` segment on the server, which for a
 * list you click through is a round trip per row — and every one of them had to
 * wait on `auth()` before anything could paint. The routes still exist and
 * still work when entered directly; this is the in-surface case, where the
 * workspace is already mounted and holding all the data, and the only thing
 * that has to change is which note is selected and what the address bar says.
 *
 * `history.pushState` is supported by the App Router for exactly this: it
 * updates the URL and `usePathname()` without a navigation, so nothing
 * unmounts, no payload is fetched and `.kairos-page-enter` does not replay. The
 * back button still works because these are real history entries — `popstate`
 * updates `usePathname()`, which is the only thing the selection is derived
 * from.
 */
function pushPath(next: string) {
  if (window.location.pathname === next) return;
  window.history.pushState(null, "", next);
}

interface UnlockedNote {
  content: string;
  /** Kept so a later save can re-encrypt; the server refuses a plaintext write. */
  password: string;
}

export function NotesWorkspace() {
  const t = useTranslations("notes");
  const locale = useLocale();
  const dateLocale = locale === "bg" ? "bg-BG" : "en-US";
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /* The single source of truth for what is open. `usePathname()` updates on a
     real navigation, on `history.pushState`, and on the back button, so all
     three land here and nowhere else. */
  const { noteId, isDraft } = useMemo(() => selectionOf(pathname), [pathname]);
  const toast = useToast();
  const utils = api.useUtils();
  const { formatDate } = useDateFormat();

  const [view, setView] = useState<NoteView>("all");
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [sort, setSort] = useState<NoteSort>("edited");
  const [query, setQuery] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  /* The sheet used to appear whole: `{railOpen && <div .../>}` with no
     transition either way, on the one surface where a drawer sliding in is the
     whole affordance. `railClosing` buys the exit, the same way every other
     drawer in the app does — see `notesMotion.ts`. */
  const [railClosing, setRailClosing] = useState(false);
  const railTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeRail = useCallback(() => {
    setRailClosing((already) => {
      if (already) return already;
      railTimer.current = setTimeout(() => {
        setRailOpen(false);
        setRailClosing(false);
      }, exitMs(SHEET_EXIT_MS));
      return true;
    });
  }, []);

  useEffect(
    () => () => {
      if (railTimer.current) clearTimeout(railTimer.current);
    },
    [],
  );

  const [unlocked, setUnlocked] = useState<Record<number, UnlockedNote>>({});
  const [lockPassword, setLockPassword] = useState("");
  const [revealPassword, setRevealPassword] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const attemptsRef = useRef<Record<number, number>>({});
  /* The same count as `attemptsRef`, but in state, because the gate needs to
     re-render to replay its shake. A ref alone cannot do that, and the error
     string alone is not enough — two identical wrong guesses produce the same
     message, so an animation keyed on it would fire once and then sit still. */
  const [lockAttempt, setLockAttempt] = useState(0);

  const [shareNoteId, setShareNoteId] = useState<number | null>(null);
  const [notebookDialog, setNotebookDialog] = useState<null | { notebook: RailNotebook | null }>(null);
  const [confirmDeleteNote, setConfirmDeleteNote] = useState<number | null>(null);
  const [confirmDeleteNotebook, setConfirmDeleteNotebook] = useState<RailNotebook | null>(null);
  const [lockNoteId, setLockNoteId] = useState<number | null>(null);
  const [removeLockNoteId, setRemoveLockNoteId] = useState<number | null>(null);
  const [resetPromptFor, setResetPromptFor] = useState<number | null>(null);
  const [resetPinFor, setResetPinFor] = useState<number | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const creatingRef = useRef(false);

  // ── data ────────────────────────────────────────────────────────────
  const ownQuery = api.note.getAll.useQuery();
  const sharedQuery = api.note.getSharedWithMe.useQuery();
  const notebooksQuery = api.note.getNotebooks.useQuery();
  const { data: settings } = api.settings.get.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const keepUnlockedUntilClose = settings?.notesKeepUnlockedUntilClose ?? false;
  const resetPinHint = settings?.resetPinHint ?? null;

  const ownNotes = useMemo<NoteItem[]>(
    () =>
      (ownQuery.data ?? []).map((note) => ({
        id: note.id,
        title: note.title,
        content: note.content,
        createdAt: new Date(note.createdAt),
        updatedAt: new Date(note.updatedAt),
        notebookId: note.notebookId,
        /* The password-protected branch of `getAll` returns a narrower object
           that omits this, so it cannot simply be read off the union. */
        calendarDate:
          "calendarDate" in note && note.calendarDate ? new Date(note.calendarDate) : null,
        isPasswordProtected: note.isPasswordProtected,
        kind: "own" as const,
        sharedWith: note.sharedWith,
        permission: null,
        ownerName: null,
        ownerEmail: null,
      })),
    [ownQuery.data],
  );

  const sharedNotes = useMemo<NoteItem[]>(
    () =>
      (sharedQuery.data ?? []).map((note) => ({
        id: note.id,
        title: note.title,
        content: note.content,
        createdAt: new Date(note.createdAt),
        updatedAt: new Date(note.updatedAt),
        notebookId: note.notebookId,
        calendarDate: null,
        isPasswordProtected: note.isPasswordProtected,
        kind: "shared" as const,
        sharedWith: [],
        permission: note.permission,
        ownerName: note.ownerName,
        ownerEmail: note.ownerEmail,
      })),
    [sharedQuery.data],
  );

  const notebooks = useMemo<RailNotebook[]>(
    () =>
      (notebooksQuery.data ?? []).map((notebook) => ({
        id: notebook.id,
        name: notebook.name,
        description: notebook.description,
        count: ownNotes.filter((note) => note.notebookId === notebook.id).length,
      })),
    [notebooksQuery.data, ownNotes],
  );

  const activeNote = useMemo(
    () =>
      noteId === null
        ? null
        : (ownNotes.find((note) => note.id === noteId) ??
          sharedNotes.find((note) => note.id === noteId) ??
          null),
    [noteId, ownNotes, sharedNotes],
  );

  // ── sort preference ─────────────────────────────────────────────────
  useEffect(() => {
    const stored = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (stored === "edited" || stored === "created" || stored === "title") setSort(stored);
  }, []);

  const changeSort = useCallback((next: NoteSort) => {
    setSort(next);
    window.localStorage.setItem(SORT_STORAGE_KEY, next);
  }, []);

  // ── unlock lifetime ─────────────────────────────────────────────────
  useEffect(() => {
    if (keepUnlockedUntilClose) return;
    /* The setting is off, so unlocks last only as long as the surface does. */
    return () => {
      setUnlocked({});
      attemptsRef.current = {};
    };
  }, [keepUnlockedUntilClose]);

  useEffect(() => {
    setLockPassword("");
    setLockError(null);
    setRevealPassword(false);
  }, [noteId]);

  // ── legacy deep links ───────────────────────────────────────────────
  useEffect(() => {
    const legacyId = searchParams.get("noteId");
    if (!legacyId) return;
    const parsed = Number(legacyId);
    /* Notifications still link to `/notes?noteId=12&tab=shared`, which used to
       be resolved by a 300ms `setTimeout` racing the query. It is a route now. */
    if (Number.isInteger(parsed) && parsed > 0) {
      window.history.replaceState(null, "", `/notes/${parsed}`);
    }
  }, [searchParams]);

  // ── keyboard ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setRailOpen(true);
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.key === "Escape" && railOpen) closeRail();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [railOpen, closeRail]);

  // ── mutations ───────────────────────────────────────────────────────
  const createNote = api.note.create.useMutation();
  const updateNote = api.note.update.useMutation();
  const deleteNote = api.note.delete.useMutation({
    onSuccess: () => {
      toast.success(t("messages.deleted"));
      void utils.note.getAll.invalidate();
      pushPath("/notes");
    },
    onError: (error) => toast.error(error.message),
  });
  const moveToNotebook = api.note.moveToNotebook.useMutation({
    onSuccess: () => {
      toast.success(t("notebooks.noteMoved"));
      void utils.note.getAll.invalidate();
      void utils.note.getNotebooks.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteNotebook = api.note.deleteNotebook.useMutation({
    onSuccess: () => {
      toast.success(t("notebooks.deleted"));
      setView((current) => (current.startsWith("notebook:") ? "all" : current));
      void utils.note.getNotebooks.invalidate();
      void utils.note.getAll.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const verifyPassword = api.note.verifyPassword.useMutation({
    onSuccess: (result, variables) => {
      if (result.valid && result.content !== undefined && result.content !== null) {
        setUnlocked((previous) => ({
          ...previous,
          [variables.noteId]: { content: result.content, password: variables.password },
        }));
        setLockPassword("");
        setLockError(null);
        attemptsRef.current[variables.noteId] = 0;
        setLockAttempt(0);
        return;
      }
      registerFailedAttempt(variables.noteId, t("messages.incorrectPassword"));
    },
    onError: (error, variables) => registerFailedAttempt(variables.noteId, error.message),
  });

  const registerFailedAttempt = (id: number, message: string) => {
    const next = (attemptsRef.current[id] ?? 0) + 1;
    attemptsRef.current[id] = next;
    setLockError(message);
    setLockAttempt(next);
    if (next >= RESET_PROMPT_AFTER) setResetPromptFor(id);
  };

  /** Patch the list caches rather than refetch — a save is not a page load. */
  const patchCaches = useCallback(
    (id: number, patch: { title: string; content: string; isProtected: boolean }) => {
      const editedAt = new Date();

      utils.note.getAll.setData(undefined, (previous) =>
        previous?.map((note) => {
          if (note.id !== id) return note;
          /* `getAll` returns a narrower object for a protected note — no body,
             no calendar date — and that shape is the guarantee that plaintext
             never enters the query cache. The decrypted copy lives in
             `unlocked` and nowhere else, so only the metadata is patched here. */
          return "calendarDate" in note
            ? { ...note, title: patch.title || null, content: patch.content, updatedAt: editedAt }
            : { ...note, title: patch.title || null, updatedAt: editedAt };
        }),
      );

      utils.note.getSharedWithMe.setData(undefined, (previous) =>
        previous?.map((note) =>
          note.id === id
            ? { ...note, title: patch.title || null, content: patch.content, updatedAt: editedAt }
            : note,
        ),
      );

      if (patch.isProtected) {
        setUnlocked((previous) => {
          const entry = previous[id];
          return entry ? { ...previous, [id]: { ...entry, content: patch.content } } : previous;
        });
      }
    },
    [utils],
  );

  const saveNote = useCallback(
    async ({ id, title, content }: { id: number; title: string; content: string }) => {
      /* Resolved by id rather than from "the note that is open", because an
         edit handed off by a note switch is written after the pane has moved
         on to something else. */
      const target =
        ownNotes.find((note) => note.id === id) ?? sharedNotes.find((note) => note.id === id);
      if (!target) return;

      const isProtected = target.isPasswordProtected;
      const password = isProtected ? unlocked[id]?.password : undefined;

      if (isProtected && !password) {
        /* Without the password the server would have to either refuse or strip
           the encryption. It refuses; so do we, before the request. */
        throw new Error(t("messages.lockedSaveBlocked"));
      }

      await updateNote.mutateAsync({
        id,
        content,
        title,
        ...(password ? { password } : {}),
      });

      patchCaches(id, { title, content, isProtected });
    },
    [ownNotes, sharedNotes, unlocked, updateNote, patchCaches, t],
  );

  const createFromDraft = useCallback(
    async (input: DraftInput) => {
      if (creatingRef.current) return;
      creatingRef.current = true;
      try {
        const created = await createNote.mutateAsync({
          content: input.content,
          title: input.title || undefined,
          password: input.password ?? undefined,
          notebookId: input.notebookId ?? undefined,
          calendarDate: input.calendarDate ?? undefined,
        });
        toast.success(t("messages.created"));
        await utils.note.getAll.invalidate();

        if (input.password) {
          /* Created encrypted, and the password is right here — no reason to
             ask for it again to read what was just written. */
          setUnlocked((previous) => ({
            ...previous,
            [created.id]: { content: input.content, password: input.password! },
          }));
        }
        /* Only follow the new note if the draft is still what is on screen.
           Clicking another note mid-draft hands the text off to be created in
           the background — landing on it instead would undo that click. */
        if (isDraft) window.history.replaceState(null, "", `/notes/${created.id}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("messages.saveFailed"));
        throw error;
      } finally {
        creatingRef.current = false;
      }
    },
    [createNote, isDraft, toast, t, utils],
  );

  /* Takes the note rather than reading "the open one": the list's context menu
     can change the date of a note that is not on screen. */
  const setCalendarDateFor = useCallback(
    async (note: NoteItem | null, date: Date | null) => {
      if (!note) return;
      const isProtected = note.isPasswordProtected;
      const password = isProtected ? unlocked[note.id]?.password : undefined;
      const content = unlocked[note.id]?.content ?? note.content ?? "";

      if (isProtected && !password) {
        /* Writing the date means rewriting the body, and the body cannot be
           re-encrypted without the password. */
        toast.error(t("messages.lockedSaveBlocked"));
        return;
      }

      try {
        await updateNote.mutateAsync({
          id: note.id,
          content,
          title: note.title ?? "",
          calendarDate: date,
          ...(password ? { password } : {}),
        });
        await utils.note.getAll.invalidate();
        toast.success(date ? t("calendar.added") : t("calendar.removed"));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("messages.saveFailed"));
      }
    },
    [unlocked, updateNote, utils, toast, t],
  );

  // ── list assembly ───────────────────────────────────────────────────
  const source = view === "shared" ? sharedNotes : ownNotes;
  const notebookFilterId = notebookIdOfView(view);

  /* The decrypted bodies, keyed by id — what search and the previews read from
     for any note unlocked this session. */
  const unlockedBodies = useMemo(
    () => Object.fromEntries(Object.entries(unlocked).map(([id, entry]) => [id, entry.content])),
    [unlocked],
  );

  const visibleNotes = useMemo(
    () =>
      selectNotes({
        notes: source,
        view,
        filter,
        query,
        sort,
        unlocked: unlockedBodies,
        locale,
      }),
    [source, view, filter, query, sort, unlockedBodies, locale],
  );

  const lockedExcluded = useMemo(
    () => countLockedExcluded(source, query, unlockedBodies),
    [source, query, unlockedBodies],
  );

  const headings: Record<string, string> = {
    all: t("tabs.allNotes"),
    shared: t("views.sharedWithMe"),
    calendar: t("views.onCalendar"),
  };
  const heading =
    notebookFilterId !== null
      ? (notebooks.find((notebook) => notebook.id === notebookFilterId)?.name ?? t("notebook"))
      : (headings[view] ?? t("tabs.allNotes"));

  const unlockedContent = noteId === null ? undefined : unlocked[noteId]?.content;
  const isListLoading = view === "shared" ? sharedQuery.isLoading : ownQuery.isLoading;

  /* `src/app/(app)/notes/loading.tsx` used to hold the skeleton for this route,
     and it had to go.

     A `loading.tsx` beside `page.tsx` wraps the whole `notes` segment — including
     `[noteId]` — in one Suspense boundary. Selection here is a route, so every
     tap on a row is a soft navigation across that boundary, and Next.js shows
     the fallback while it fetches the new payload: all three panes were replaced
     by a full-page skeleton and then rebuilt, on every single note. That is the
     flash. It cannot be scoped away by adding a closer `loading.tsx`, because a
     closer boundary is still a boundary.

     Without it, Next keeps the current UI on screen until the new payload
     arrives, so the rail and the list hold still and only the pane that changed
     changes. The loading state moves to the components that own the data:
     `NoteList` already shimmered its own rows, and `NotePage` now does the same
     when the route names a note the queries have not answered for yet. */
  const isNoteLoading =
    noteId !== null && activeNote === null && (ownQuery.isLoading || sharedQuery.isLoading);

  const openNote = useCallback((id: number) => {
    setRailOpen(false);
    pushPath(`/notes/${id}`);
  }, []);

  const newNote = useCallback(() => {
    setRailOpen(false);
    pushPath("/notes/new");
  }, []);

  const showPageOnMobile = noteId !== null || isDraft;

  /* The mobile pane swap, animated without remounting either pane.
     Keying the wrappers on `showPageOnMobile` also produced the slide, but it
     tore down and rebuilt whichever pane was arriving — which on desktop, where
     both panes are visible and nothing is sliding, made picking a row look like
     the editor reloading. Toggling a class instead leaves the DOM alone: the
     text, the caret and the scroll position all survive. */
  const [swapping, setSwapping] = useState(false);
  const lastPane = useRef(showPageOnMobile);
  useEffect(() => {
    if (lastPane.current === showPageOnMobile) return;
    lastPane.current = showPageOnMobile;
    setSwapping(true);
    const done = setTimeout(() => setSwapping(false), exitMs(PANE_SWAP_MS));
    return () => clearTimeout(done);
  }, [showPageOnMobile]);

  /* Only the pane arriving animates, and only below `md`. */
  const listSwap = swapping && !showPageOnMobile ? "notes-push-in md:animate-none" : "";
  const pageSwap = swapping && showPageOnMobile ? "notes-push-in md:animate-none" : "";

  return (
    <div className="flex h-full overflow-hidden">
      {/* Rail — a column on desktop, a sheet on mobile. */}
      <div className="hidden md:block w-[236px] flex-none h-full">
        <NotesRail
          view={view}
          onViewChange={(next) => {
            setView(next);
            setFilter("all");
          }}
          counts={{
            all: ownNotes.length,
            shared: sharedNotes.length,
            calendar: ownNotes.filter((note) => note.calendarDate !== null).length,
          }}
          notebooks={notebooks}
          query={query}
          onQueryChange={setQuery}
          searchRef={searchRef}
          onNewNote={newNote}
          onCreateNotebook={() => setNotebookDialog({ notebook: null })}
          onRenameNotebook={(notebook) => setNotebookDialog({ notebook })}
          onDeleteNotebook={setConfirmDeleteNotebook}
        />
      </div>

      {railOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className={`absolute inset-0 bg-black/45 ${
              railClosing ? "notes-sheet-scrim--out" : "notes-sheet-scrim"
            }`}
            onClick={closeRail}
            aria-hidden="true"
          />
          <div
            className={`absolute inset-y-0 left-0 w-[280px] max-w-[85vw] shadow-2xl ${
              railClosing ? "notes-sheet--out" : "notes-sheet"
            }`}
          >
            <NotesRail
              view={view}
              onViewChange={(next) => {
                setView(next);
                setFilter("all");
                closeRail();
              }}
              counts={{
                all: ownNotes.length,
                shared: sharedNotes.length,
                calendar: ownNotes.filter((note) => note.calendarDate !== null).length,
              }}
              notebooks={notebooks}
              query={query}
              onQueryChange={setQuery}
              searchRef={searchRef}
              onNewNote={newNote}
              onCreateNotebook={() => {
                closeRail();
                setNotebookDialog({ notebook: null });
              }}
              onRenameNotebook={(notebook) => {
                closeRail();
                setNotebookDialog({ notebook });
              }}
              onDeleteNotebook={(notebook) => {
                closeRail();
                setConfirmDeleteNotebook(notebook);
              }}
              onClose={closeRail}
            />
          </div>
        </div>
      )}

      {/* One pane at a time on mobile: the list, or the note. The swap used to
          be a bare `hidden`/`block` toggle, so the two panes had no visible
          relationship — the list was simply replaced by a note. Keying on which
          pane is showing replays the entrance, so the note now arrives from the
          right and going back reverses it. Desktop shows both and the key is
          inert there. */}
      <div
        className={`${showPageOnMobile ? "hidden md:block" : "block"} ${listSwap} w-full md:w-[318px] flex-none h-full`}
      >
        <NoteList
          notes={visibleNotes}
          selectedId={noteId}
          heading={heading}
          view={view}
          sort={sort}
          onSortChange={changeSort}
          filter={filter}
          onFilterChange={setFilter}
          query={query}
          lockedExcluded={lockedExcluded}
          unlocked={unlockedBodies}
          notebookNameOf={(id) =>
            id === null ? null : (notebooks.find((notebook) => notebook.id === id)?.name ?? null)
          }
          locale={dateLocale}
          isLoading={isListLoading}
          onSelect={openNote}
          onNewNote={newNote}
          onOpenRail={() => setRailOpen(true)}
          notebooks={notebooks}
          onShare={setShareNoteId}
          onDelete={setConfirmDeleteNote}
          onMoveToNotebook={(id, notebookId) => moveToNotebook.mutate({ noteId: id, notebookId })}
          onLock={setLockNoteId}
          onRemoveLock={setRemoveLockNoteId}
          onResetPassword={setResetPinFor}
          onRelock={(id) =>
            setUnlocked((previous) => {
              /* Drop the decrypted copy and the password with it: the row goes
                 back to showing the locked preview and the next open asks
                 again. Nothing on the server changes — it never held either. */
              const { [id]: _removed, ...rest } = previous;
              return rest;
            })
          }
          onRemoveCalendarDate={(id) => {
            const note = ownNotes.find((entry) => entry.id === id) ?? null;
            void setCalendarDateFor(note, null);
          }}
        />
      </div>

      <div
        className={`${showPageOnMobile ? "block" : "hidden md:block"} ${pageSwap} flex-1 min-w-0 h-full`}
      >
        <NotePage
          note={activeNote}
          isDraft={isDraft}
          isLoading={isNoteLoading}
          notebooks={notebooks}
          unlockedContent={unlockedContent}
          locale={dateLocale}
          formatFullDate={(date) => formatDate(date, "long")}
          lock={{
            password: lockPassword,
            reveal: revealPassword,
            error: lockError,
            attempt: lockAttempt,
            isPending: verifyPassword.isPending,
          }}
          onLockPasswordChange={(next) => {
            setLockPassword(next);
            if (lockError) setLockError(null);
          }}
          onToggleReveal={() => setRevealPassword((value) => !value)}
          onUnlock={() => {
            if (noteId === null) return;
            verifyPassword.mutate({ noteId, password: lockPassword });
          }}
          onResetPassword={() => setResetPinFor(noteId)}
          onSave={saveNote}
          onCreate={createFromDraft}
          onDelete={() => setConfirmDeleteNote(noteId)}
          onShare={() => setShareNoteId(noteId)}
          onMoveToNotebook={(notebookId) => {
            if (noteId !== null) moveToNotebook.mutate({ noteId, notebookId });
          }}
          onSetCalendarDate={(date) => void setCalendarDateFor(activeNote, date)}
          onBack={() => pushPath("/notes")}
          onNewNote={newNote}
        />
      </div>

      {shareNoteId !== null && (
        <ShareDialog noteId={shareNoteId} onClose={() => setShareNoteId(null)} />
      )}

      {lockNoteId !== null && (
        <LockNoteDialog
          noteId={lockNoteId}
          onClose={() => setLockNoteId(null)}
          onSuccess={(password) => {
            const id = lockNoteId;
            /* The body was readable a moment ago, and the password is right
               here — holding both keeps the note open instead of locking the
               user out of what they were just looking at. */
            const body =
              unlocked[id]?.content ??
              ownNotes.find((note) => note.id === id)?.content ??
              "";
            setUnlocked((previous) => ({ ...previous, [id]: { content: body, password } }));
            setLockNoteId(null);
            void utils.note.getAll.invalidate();
          }}
        />
      )}

      {removeLockNoteId !== null && (
        <RemoveLockDialog
          noteId={removeLockNoteId}
          knownPassword={unlocked[removeLockNoteId]?.password}
          onClose={() => setRemoveLockNoteId(null)}
          onSuccess={() => {
            const id = removeLockNoteId;
            setUnlocked((previous) => {
              /* The note is plaintext now, so `getAll` carries its body again.
                 A stale entry here would keep an old copy winning over it. */
              const { [id]: _removed, ...rest } = previous;
              return rest;
            });
            setRemoveLockNoteId(null);
            void utils.note.getAll.invalidate();
          }}
        />
      )}

      {notebookDialog && (
        <NotebookDialog notebook={notebookDialog.notebook} onClose={() => setNotebookDialog(null)} />
      )}

      {confirmDeleteNote !== null && (
        <ConfirmDialog
          title={t("delete.title")}
          message={t("delete.confirmMessage")}
          confirmLabel={t("actions.delete")}
          destructive
          isPending={deleteNote.isPending}
          onCancel={() => setConfirmDeleteNote(null)}
          onConfirm={() => {
            deleteNote.mutate({ id: confirmDeleteNote });
            setConfirmDeleteNote(null);
          }}
        />
      )}

      {confirmDeleteNotebook && (
        <ConfirmDialog
          title={t("notebooks.deleteTitle")}
          /* The FK is `on delete set null`, so the notes survive and become
             unfiled. The old `window.confirm` said as much; the dialog should
             not say less. */
          message={t("notebooks.deleteConfirm", { name: confirmDeleteNotebook.name })}
          confirmLabel={t("actions.delete")}
          destructive
          isPending={deleteNotebook.isPending}
          onCancel={() => setConfirmDeleteNotebook(null)}
          onConfirm={() => {
            deleteNotebook.mutate({ id: confirmDeleteNotebook.id });
            setConfirmDeleteNotebook(null);
          }}
        />
      )}

      {resetPromptFor !== null && (
        <ConfirmDialog
          title={t("messages.incorrectPassword")}
          message={t("password.resetPrompt")}
          confirmLabel={t("password.resetPassword")}
          cancelLabel={t("password.tryAgain")}
          isPending={false}
          onCancel={() => setResetPromptFor(null)}
          onConfirm={() => {
            setResetPinFor(resetPromptFor);
            setResetPromptFor(null);
          }}
        />
      )}

      {resetPinFor !== null && (
        <PinResetDialog
          noteId={resetPinFor}
          hint={resetPinHint}
          onClose={() => setResetPinFor(null)}
          onSuccess={() => {
            /* The note was re-encrypted under a new password, so anything held
               for the old one is stale. */
            setUnlocked((previous) => {
              const next = { ...previous };
              delete next[resetPinFor];
              return next;
            });
            attemptsRef.current[resetPinFor] = 0;
            setLockAttempt(0);
            setResetPinFor(null);
            setLockPassword("");
            setLockError(null);
          }}
        />
      )}
    </div>
  );
}
