"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useDateFormat } from "~/lib/hooks/useDateFormat";
import Image from "next/image";
import {
  Search,
  Plus,
  Lock,
  Trash2,
  Eye,
  EyeOff,
  AlertCircle,
  RefreshCw,
  KeyRound,
  X,
  FolderOpen,
  Users,
  MoreHorizontal,
  Loader2,
  Share2,
  BookOpen,
  StickyNote,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { cn } from "~/lib/utils";
import { useTranslations } from "next-intl";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type TabId = "all" | "notebooks" | "shared";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function NotesDashboard() {
  const toast = useToast();
  const utils = api.useUtils();
  const searchParams = useSearchParams();
  const { formatDate: formatDatePref } = useDateFormat();
  const t = useTranslations("notes");

  // ---- Tab / filter state ----
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNotebookId, setSelectedNotebookId] = useState<number | null>(null);

  // ---- Note CRUD state ----
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newNotebookId, setNewNotebookId] = useState<number | null>(null);
  const [addToCalendar, setAddToCalendar] = useState(false);
  const [newCalendarDate, setNewCalendarDate] = useState<Date | null>(null);

  // ---- Password state ----
  const [passwordInputs, setPasswordInputs] = useState<Record<number, string>>({});
  const [showPasswords, setShowPasswords] = useState<Record<number, boolean>>({});
  const [unlockedNotes, setUnlockedNotes] = useState<Record<number, { unlocked: boolean; content: string }>>({});
  const [passwordErrors, setPasswordErrors] = useState<Record<number, string>>({});
  const unlockAttemptsRef = useRef<Record<number, number>>({});
  const [showResetPromptModal, setShowResetPromptModal] = useState<number | null>(null);
  const [showResetModal, setShowResetModal] = useState<number | null>(null);
  const [resetPinInput, setResetPinInput] = useState("");
  const [resetPinError, setResetPinError] = useState<string | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [confirmNewPasswordInput, setConfirmNewPasswordInput] = useState("");
  const [showNewPasswords, setShowNewPasswords] = useState(false);

  // ---- Edit state ----
  const [editingContent, setEditingContent] = useState<Record<number, string>>({});
  const [editingTitle, setEditingTitle] = useState<Record<number, string>>({});
  const [confirmDeleteNoteId, setConfirmDeleteNoteId] = useState<number | null>(null);

  // ---- Share modal state ----
  const [shareModalNoteId, setShareModalNoteId] = useState<number | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [sharePermission, setSharePermission] = useState<"read" | "write">("read");
  const [shareEmailDebounced, setShareEmailDebounced] = useState("");
  const [showShareSuggestions, setShowShareSuggestions] = useState(false);

  // ---- Notebook creation state ----
  const [showCreateNotebook, setShowCreateNotebook] = useState(false);
  const [notebookName, setNotebookName] = useState("");

  // ---- Context menu ----
  const [contextMenuNoteId, setContextMenuNoteId] = useState<number | null>(null);

  // ---- Shared note editing ----
  const [selectedSharedNoteId, setSelectedSharedNoteId] = useState<number | null>(null);
  const [sharedEditTitle, setSharedEditTitle] = useState("");
  const [sharedEditContent, setSharedEditContent] = useState("");

  // ---- Queries ----
  const { data: notes, refetch: refetchNotes } = api.note.getAll.useQuery();
  const { data: sharedNotes } = api.note.getSharedWithMe.useQuery();
  const { data: notebooksList } = api.note.getNotebooks.useQuery();
  const { data: noteSharesList } = api.note.getNoteShares.useQuery(
    { noteId: shareModalNoteId! },
    { enabled: !!shareModalNoteId },
  );
  const { data: settings } = api.settings.get.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  // ---- Org members for share suggestions ----
  const { data: activeOrg } = api.organization.getActive.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const activeOrgId = activeOrg?.organization?.id;
  const { data: orgMembers } = api.organization.getMembers.useQuery(
    { organizationId: activeOrgId! },
    { enabled: !!activeOrgId, retry: false, refetchOnWindowFocus: false },
  );

  // ---- Share email lookup ----
  const shareEmailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (shareEmailTimerRef.current) clearTimeout(shareEmailTimerRef.current);
    const trimmed = shareEmail.trim();
    if (trimmed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      shareEmailTimerRef.current = setTimeout(() => setShareEmailDebounced(trimmed), 400);
    } else {
      setShareEmailDebounced("");
    }
    return () => { if (shareEmailTimerRef.current) clearTimeout(shareEmailTimerRef.current); };
  }, [shareEmail]);

  const { data: shareEmailLookup, isFetching: isShareLookingUp } = api.user.searchByEmail.useQuery(
    { email: shareEmailDebounced },
    { enabled: !!shareEmailDebounced, retry: false, refetchOnWindowFocus: false },
  );

  // Filter org members for suggestions based on typed email
  const shareSuggestions = useMemo(() => {
    if (!orgMembers || !shareEmail.trim()) return [];
    const q = shareEmail.toLowerCase();
    return orgMembers.filter((m) =>
      (m.email?.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q)) && m.email
    ).slice(0, 5);
  }, [orgMembers, shareEmail]);

  const keepUnlockedUntilClose = settings?.notesKeepUnlockedUntilClose ?? false;
  const resetPinHint = settings?.resetPinHint ?? null;

  useEffect(() => {
    if (keepUnlockedUntilClose) return;
    return () => {
      setUnlockedNotes({});
      setPasswordInputs({});
      setPasswordErrors({});
      setShowPasswords({});
      unlockAttemptsRef.current = {};
    };
  }, [keepUnlockedUntilClose]);

  // ---- Mutations ----
  const createNote = api.note.create.useMutation({
    onSuccess: () => {
      toast.success(t("messages.created"));
      setNewTitle(""); setNewContent(""); setNewPassword(""); setNewNotebookId(null);
      setShowCreateForm(false);
      void utils.note.getAll.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteNote = api.note.delete.useMutation({
    onSuccess: () => {
      setSelectedNoteId(null);
      void refetchNotes();
    },
  });

  const updateNote = api.note.update.useMutation({
    onSuccess: () => {
      setSelectedNoteId(null);
      void refetchNotes();
    },
  });

  const verifyPassword = api.note.verifyPassword.useMutation({
    onSuccess: (data, variables) => {
      if (data.valid && data.content) {
        setUnlockedNotes((prev) => ({
          ...prev,
          [variables.noteId]: { unlocked: true, content: data.content },
        }));
        setPasswordInputs((prev) => ({ ...prev, [variables.noteId]: "" }));
        setPasswordErrors((prev) => ({ ...prev, [variables.noteId]: "" }));
        unlockAttemptsRef.current[variables.noteId] = 0;
      } else {
        const next = (unlockAttemptsRef.current[variables.noteId] ?? 0) + 1;
        unlockAttemptsRef.current[variables.noteId] = next;
        if (next >= 2) setShowResetPromptModal(variables.noteId);
        setPasswordErrors((prev) => ({ ...prev, [variables.noteId]: t("messages.incorrectPassword") }));
      }
    },
    onError: (error, variables) => {
      const next = (unlockAttemptsRef.current[variables.noteId] ?? 0) + 1;
      unlockAttemptsRef.current[variables.noteId] = next;
      if (next >= 2) setShowResetPromptModal(variables.noteId);
      setPasswordErrors((prev) => ({ ...prev, [variables.noteId]: error.message }));
    },
  });

  const resetPasswordWithPin = api.note.resetPasswordWithPin.useMutation({
    onSuccess: () => {
      toast.success(t("password.resetSuccess"));
      setShowResetModal(null);
      setResetPinInput(""); setResetPinError(null);
      setNewPasswordInput(""); setConfirmNewPasswordInput("");
    },
    onError: (e) => setResetPinError(e.message),
  });

  const shareNote = api.note.shareNote.useMutation({
    onSuccess: () => {
      toast.success(t("messages.shared"));
      setShareEmail("");
      void utils.note.getNoteShares.invalidate();
      void utils.note.getAll.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const unshareNote = api.note.unshareNote.useMutation({
    onSuccess: () => {
      toast.success(t("messages.accessRemoved"));
      void utils.note.getNoteShares.invalidate();
      void utils.note.getAll.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const createNotebook = api.note.createNotebook.useMutation({
    onSuccess: () => {
      toast.success(t("notebooks.created"));
      setNotebookName("");
      setShowCreateNotebook(false);
      void utils.note.getNotebooks.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteNotebook = api.note.deleteNotebook.useMutation({
    onSuccess: () => {
      toast.success(t("notebooks.deleted"));
      setSelectedNotebookId(null);
      void utils.note.getNotebooks.invalidate();
      void utils.note.getAll.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const moveToNotebook = api.note.moveToNotebook.useMutation({
    onSuccess: () => {
      toast.success(t("notebooks.noteMoved"));
      setContextMenuNoteId(null);
      void utils.note.getAll.invalidate();
      void utils.note.getNotebooks.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ---- Handle shared note from notification ----
  useEffect(() => {
    const noteId = searchParams.get("noteId");
    const tab = searchParams.get("tab");
    
    if (noteId && tab) {
      const id = parseInt(noteId, 10);
      if (!isNaN(id)) {
        // Switch to the appropriate tab
        if (tab === "shared") {
          setActiveTab("shared");
          // Open the shared note after a brief delay to ensure data is loaded
          setTimeout(() => {
            const sharedNote = sharedNotes?.find(n => n.id === id);
            if (sharedNote) {
              setSelectedSharedNoteId(id);
              setSharedEditTitle(sharedNote.title ?? "");
              setSharedEditContent(sharedNote.content ?? "");
            }
          }, 300);
        } else {
          // Open the user's own note
          setTimeout(() => {
            setSelectedNoteId(id);
          }, 300);
        }
      }
    }
  }, [searchParams, sharedNotes]);

  // ---- Handlers ----
  const requestDeleteNote = useCallback((noteId: number) => {
    setConfirmDeleteNoteId(noteId);
    setContextMenuNoteId(null);
  }, []);

  const confirmDeleteNote = useCallback(() => {
    if (confirmDeleteNoteId !== null) {
      deleteNote.mutate({ id: confirmDeleteNoteId });
      setConfirmDeleteNoteId(null);
    }
  }, [confirmDeleteNoteId, deleteNote]);

  const closeExpandedNote = useCallback(() => {
    setSelectedNoteId(null);
    setEditingContent({});
    setEditingTitle({});
  }, []);

  // ---- Filtered notes ----
  const allNotes = useMemo(() => notes ?? [], [notes]);
  const filteredNotes = useMemo(() => {
    let result = allNotes;

    if (selectedNotebookId !== null) {
      result = result.filter((n) => n.notebookId === selectedNotebookId);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((n) => {
        const title = (n.title ?? "").toLowerCase();
        const content = (n.content ?? "").toLowerCase();
        return title.includes(q) || content.includes(q);
      });
    }

    return result;
  }, [allNotes, selectedNotebookId, searchQuery]);

  // ---- Tabs ----
  const tabs: { id: TabId; label: string; icon: React.ReactNode; count: number }[] = [
    { id: "all", label: t("tabs.allNotes"), icon: <StickyNote size={16} />, count: allNotes.length },
    { id: "notebooks", label: t("tabs.notebooks"), icon: <BookOpen size={16} />, count: notebooksList?.length ?? 0 },
    { id: "shared", label: t("tabs.shared"), icon: <Users size={16} />, count: sharedNotes?.length ?? 0 },
  ];

  // Time formatter
  const formatTime = (date: Date | string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return t("justNow");
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  const formatFullDate = (date: Date | string) => {
    const d = new Date(date);
    return formatDatePref(d, "long");
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex h-[calc(100vh-65px)] kairos-page-enter">
      {/* Delete Note Confirmation Dialog */}
      {confirmDeleteNoteId !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-secondary rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in fade-in slide-in-from-bottom-4">
            <h3 className="text-lg font-bold text-fg-primary mb-2">{t("delete.title")}</h3>
            <p className="text-sm text-fg-secondary mb-6">{t("delete.confirmMessage")}</p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmDeleteNoteId(null)}
                className="px-4 py-2 text-sm font-medium text-fg-secondary hover:bg-bg-surface rounded-lg transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={confirmDeleteNote}
                disabled={deleteNote.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50"
              >
                {deleteNote.isPending ? t("actions.deleting") : t("actions.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ---- Secondary sidebar ---- */}
      <aside className="w-56 border-r border-white/[0.06] bg-bg-primary flex flex-col p-4 hidden md:flex">
        <button
          onClick={() => setShowCreateForm(true)}
          className="w-full kairos-neon-btn text-white rounded-xl py-3 px-4 flex items-center justify-center gap-2 font-bold text-sm mb-4"
        >
          <Plus size={18} />
          {t("actions.create")}
        </button>

        <nav className="flex flex-col gap-1 flex-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSelectedNotebookId(null); }}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left",
                activeTab === tab.id
                  ? "bg-accent-primary/10 text-accent-primary border-l-2 border-accent-primary"
                  : "text-fg-tertiary hover:text-fg-primary hover:bg-white/[0.03]"
              )}
            >
              {tab.icon}
              <span className="flex-1">{tab.label}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-fg-tertiary">
                {tab.count}
              </span>
            </button>
          ))}
        </nav>
      </aside>

      {/* ---- Main content ---- */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Search + filter bar */}
        <div className="px-6 py-4 flex items-center gap-4 border-b border-white/[0.06]">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("search")}
              className="w-full pl-9 pr-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/30 focus:border-accent-primary/30"
            />
          </div>
          {/* Mobile new note button */}
          <button
            onClick={() => setShowCreateForm(true)}
            className="md:hidden kairos-neon-btn text-white rounded-lg p-2.5"
          >
            <Plus size={18} />
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* ---- ALL NOTES TAB ---- */}
          {activeTab === "all" && (
            <div>
              <div className="flex items-end justify-between mb-6">
                <h2 className="text-2xl font-bold text-fg-primary tracking-tight">
                  {selectedNotebookId
                    ? notebooksList?.find((nb) => nb.id === selectedNotebookId)?.name ?? t("notebook")
                    : t("recentNotes")}
                </h2>
                {selectedNotebookId && (
                  <button
                    onClick={() => setSelectedNotebookId(null)}
                    className="text-xs text-accent-primary hover:underline"
                  >
                    Show all
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredNotes.map((note) => {
                  const unlockedState = unlockedNotes[note.id];
                  const isLocked = !!note.passwordHash && !unlockedState?.unlocked;
                  const rawContent = unlockedState?.content ?? note.content ?? "";
                  const title = note.title ?? rawContent.split("\n")[0]?.trim().substring(0, 60) ?? "";
                  const preview = rawContent.split("\n").slice(note.title ? 0 : 1).join("\n").trim().substring(0, 120);

                  return (
                    <div
                      key={note.id}
                      onClick={() => setSelectedNoteId(note.id)}
                      className="group relative p-5 rounded-xl cursor-pointer transition-all duration-200 hover:shadow-[0_0_20px_rgba(var(--accent-primary),0.12)] border border-white/[0.08] dark:bg-[#1f1b2e] bg-[#efedf4] backdrop-blur-sm hover:bg-[rgba(var(--accent-primary),0.07)] hover:border-[rgba(var(--accent-primary),0.25)] max-h-[220px] flex flex-col"
                    >
                      <div className="flex items-start justify-between mb-3">
                        {note.shareStatus !== "private" ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[rgba(var(--accent-primary),0.15)] text-accent-primary border border-[rgba(var(--accent-primary),0.2)]">
                            {t("tags.shared")}
                          </span>
                        ) : isLocked ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white/[0.06] text-fg-tertiary border border-white/[0.08]">
                            <Lock size={9} className="inline mr-1 -mt-px" />Locked
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[rgba(var(--accent-secondary),0.12)] text-accent-secondary border border-[rgba(var(--accent-secondary),0.2)]">
                            {t("tags.note")}
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setContextMenuNoteId(contextMenuNoteId === note.id ? null : note.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-fg-tertiary hover:text-accent-primary transition-all p-1 rounded"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </div>

                      <h3 className="text-sm font-bold text-fg-primary mb-2 group-hover:text-accent-primary transition-colors line-clamp-1">
                        {isLocked ? t("encryptedNote") : (title || t("untitled"))}
                      </h3>

                      <p className="dark:text-slate-400 text-slate-500 text-xs leading-relaxed mb-3 line-clamp-3 flex-1 min-h-0 overflow-hidden">
                        {isLocked ? t("passwordProtected") : (preview || t("noContent"))}
                      </p>

                      <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/[0.04]">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-fg-tertiary">{t("meta.created")}: {formatTime(note.createdAt)}</span>
                          <span className="text-[9px] text-fg-tertiary">{t("meta.edited")}: {formatTime(note.updatedAt)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Shared users avatars */}
                          {"sharedWith" in note && (note as { sharedWith?: { id: string; name: string | null; email: string; image: string | null; permission: string }[] }).sharedWith && (note as { sharedWith: { id: string; name: string | null; email: string; image: string | null; permission: string }[] }).sharedWith.length > 0 && (
                            <div className="flex items-center -space-x-1.5">
                              {(note as { sharedWith: { id: string; name: string | null; email: string; image: string | null; permission: string }[] }).sharedWith.slice(0, 3).map((u) => (
                                <div
                                  key={u.id}
                                  title={`${u.name ?? u.email} (${u.permission})`}
                                  className="w-5 h-5 rounded-full border-2 border-bg-primary bg-accent-primary/20 flex items-center justify-center overflow-hidden"
                                >
                                  {u.image ? (
                                    <Image src={u.image} alt={u.name ?? ""} width={20} height={20} unoptimized className="w-full h-full object-cover" />
                                  ) : (
                                    <span className="text-[8px] font-bold text-accent-primary">
                                      {(u.name ?? u.email)?.[0]?.toUpperCase() ?? "?"}
                                    </span>
                                  )}
                                </div>
                              ))}
                              {(note as { sharedWith: { id: string; name: string | null }[] }).sharedWith.length > 3 && (
                                <div className="w-5 h-5 rounded-full border-2 border-bg-primary bg-bg-tertiary flex items-center justify-center">
                                  <span className="text-[8px] font-bold text-fg-tertiary">
                                    +{(note as { sharedWith: unknown[] }).sharedWith.length - 3}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                          {note.notebookId ? (
                            <div className="flex items-center gap-1.5 text-fg-tertiary">
                              <BookOpen size={12} />
                              <span className="text-[10px]">
                                {notebooksList?.find((nb) => nb.id === note.notebookId)?.name ?? t("notebook")}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {/* Context menu */}
                      {contextMenuNoteId === note.id && (
                        <div
                          className="absolute right-4 bottom-12 z-20 bg-bg-elevated border border-white/[0.08] rounded-xl shadow-xl p-1.5 min-w-[160px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => { setShareModalNoteId(note.id); setContextMenuNoteId(null); }}
                            className={cn(
                              "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition",
                              note.shareStatus !== "private"
                                ? "bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25"
                                : "text-fg-secondary hover:bg-white/[0.06] hover:text-fg-primary"
                            )}
                          >
                            <Share2 size={13} /> {note.shareStatus !== "private" ? t("manageSharing") : t("share")}
                          </button>
                          {notebooksList && notebooksList.length > 0 && (
                            <div className="border-t border-white/[0.06] my-1" />
                          )}
                          {notebooksList?.map((nb) => (
                            <button
                              key={nb.id}
                              onClick={() => moveToNotebook.mutate({ noteId: note.id, notebookId: nb.id })}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-fg-secondary hover:bg-white/[0.06] hover:text-fg-primary transition"
                            >
                              <FolderOpen size={13} /> {t("notebooks.moveTo", { name: nb.name })}
                            </button>
                          ))}
                          {note.notebookId && (
                            <button
                              onClick={() => moveToNotebook.mutate({ noteId: note.id, notebookId: null })}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-fg-tertiary hover:bg-white/[0.06] hover:text-fg-primary transition"
                            >
                              <X size={13} /> {t("notebooks.removeFrom")}
                            </button>
                          )}
                          <div className="border-t border-white/[0.06] my-1" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              requestDeleteNote(note.id);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition text-fg-secondary hover:bg-white/[0.06] hover:text-red-400"
                          >
                            <Trash2 size={13} />
                            {t("actions.delete")}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Create new note card */}
                <div
                  onClick={() => setShowCreateForm(true)}
                  className="border-2 border-dashed border-white/[0.08] bg-white/[0.01] p-5 rounded-xl flex flex-col items-center justify-center text-fg-tertiary hover:border-accent-primary/30 hover:text-accent-primary transition-all group cursor-pointer min-h-[180px]"
                >
                  <Plus size={32} className="mb-2 group-hover:scale-110 transition-transform" />
                  <p className="text-sm font-bold">{t("actions.create")}</p>
                </div>
              </div>
            </div>
          )}

          {/* ---- NOTEBOOKS TAB ---- */}
          {activeTab === "notebooks" && (
            <div>
              <div className="flex items-end justify-between mb-6">
                <h2 className="text-2xl font-bold text-fg-primary tracking-tight">{t("tabs.notebooks")}</h2>
                <button
                  onClick={() => setShowCreateNotebook(true)}
                  className="flex items-center gap-1.5 text-xs text-accent-primary hover:text-accent-secondary transition font-medium"
                >
                  <Plus size={14} /> {t("actions.create")}
                </button>
              </div>

              {showCreateNotebook && (
                <div className="mb-6 p-4 rounded-xl border border-accent-primary/20 bg-[rgba(var(--accent-primary),0.03)]">
                  <input
                    type="text"
                    value={notebookName}
                    onChange={(e) => setNotebookName(e.target.value)}
                    placeholder={t("notebooks.namePlaceholder")}
                    className="w-full px-3 py-2 bg-bg-primary rounded-lg text-sm text-fg-primary placeholder:text-fg-tertiary border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-accent-primary/30 mb-3"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && notebookName.trim()) createNotebook.mutate({ name: notebookName });
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => notebookName.trim() && createNotebook.mutate({ name: notebookName })}
                      disabled={!notebookName.trim() || createNotebook.isPending}
                      className="flex-1 px-4 py-2 rounded-lg kairos-neon-btn text-white text-sm font-medium disabled:opacity-50"
                    >
                      {createNotebook.isPending ? <Loader2 size={14} className="animate-spin mx-auto" /> : t("actions.create")}
                    </button>
                    <button
                      onClick={() => setShowCreateNotebook(false)}
                      className="px-4 py-2 rounded-lg border border-white/[0.06] text-fg-secondary text-sm hover:bg-white/[0.04] transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {notebooksList?.map((nb) => {
                  const notesInNotebook = allNotes.filter((n) => n.notebookId === nb.id);
                  return (
                    <div
                      key={nb.id}
                      onClick={() => { setActiveTab("all"); setSelectedNotebookId(nb.id); }}
                      className="group relative p-5 rounded-xl cursor-pointer transition-all duration-200 border border-white/[0.08] bg-[rgba(var(--accent-primary),0.03)] backdrop-blur-sm hover:bg-[rgba(var(--accent-primary),0.07)] hover:border-[rgba(var(--accent-primary),0.25)] hover:shadow-[0_0_20px_rgba(var(--accent-primary),0.12)]"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-lg bg-accent-primary/15 flex items-center justify-center">
                          <BookOpen size={18} className="text-accent-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold text-fg-primary group-hover:text-accent-primary transition-colors truncate">
                            {nb.name}
                          </h3>
                          <p className="text-[10px] text-fg-tertiary">{t("notebooks.notesCount", { count: notesInNotebook.length })}</p>
                        </div>
                      </div>
                      {nb.description && (
                        <p className="text-xs text-fg-tertiary line-clamp-2 mb-3">{nb.description}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-fg-tertiary">{formatTime(nb.updatedAt)}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(t("notebooks.deleteConfirm", { name: nb.name }))) {
                              deleteNotebook.mutate({ id: nb.id });
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-fg-tertiary hover:text-red-400 hover:bg-red-500/10 transition"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {(!notebooksList || notebooksList.length === 0) && !showCreateNotebook && (
                  <div
                    onClick={() => setShowCreateNotebook(true)}
                    className="border-2 border-dashed border-white/[0.08] bg-white/[0.01] p-5 rounded-xl flex flex-col items-center justify-center text-fg-tertiary hover:border-accent-primary/30 hover:text-accent-primary transition-all group cursor-pointer min-h-[140px] col-span-full max-w-xs mx-auto"
                  >
                    <BookOpen size={28} className="mb-2 group-hover:scale-110 transition-transform" />
                    <p className="text-sm font-bold">{t("notebooks.createFirst")}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---- SHARED TAB ---- */}
          {activeTab === "shared" && (
            <div>
              <h2 className="text-2xl font-bold text-fg-primary tracking-tight mb-6">{t("tabs.shared")}</h2>

              {/* Shared note expanded editor */}
              {selectedSharedNoteId && (() => {
                const sn = sharedNotes?.find((n) => n.id === selectedSharedNoteId);
                if (!sn) return null;
                const canEdit = sn.permission === "write" && !sn.passwordHash;
                return (
                  <div className="mb-6 p-5 rounded-xl border border-accent-primary/20 bg-bg-secondary space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[rgba(var(--accent-primary),0.15)] text-accent-primary border border-[rgba(var(--accent-primary),0.2)]">
                        {sn.permission === "write" ? t("sharing.canEdit") : t("sharing.viewOnly")}
                      </span>
                      <button
                        onClick={() => setSelectedSharedNoteId(null)}
                        className="p-1.5 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-white/[0.06] transition"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    {canEdit ? (
                      <>
                        <input
                          type="text"
                          value={sharedEditTitle}
                          onChange={(e) => setSharedEditTitle(e.target.value)}
                          placeholder={t("create.titlePlaceholder")}
                          className="w-full px-3 py-2 bg-bg-primary rounded-lg text-sm font-bold text-fg-primary placeholder:text-fg-tertiary border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
                        />
                        <textarea
                          value={sharedEditContent}
                          onChange={(e) => setSharedEditContent(e.target.value)}
                          placeholder={t("create.contentPlaceholder")}
                          rows={8}
                          className="w-full px-3 py-2 bg-bg-primary rounded-lg text-sm text-fg-primary placeholder:text-fg-tertiary border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-accent-primary/30 resize-y"
                        />
                        <button
                          onClick={() => {
                            updateNote.mutate(
                              { id: sn.id, content: sharedEditContent, title: sharedEditTitle || undefined },
                              {
                                onSuccess: () => {
                                  toast.success(t("messages.updated"));
                                  setSelectedSharedNoteId(null);
                                  void utils.note.getSharedWithMe.invalidate();
                                },
                              },
                            );
                          }}
                          disabled={updateNote.isPending}
                          className="px-4 py-2 rounded-lg kairos-neon-btn text-white text-sm font-medium disabled:opacity-50"
                        >
                          {updateNote.isPending ? <Loader2 size={14} className="animate-spin" /> : t("saveChanges")}
                        </button>
                      </>
                    ) : (
                      <>
                        <h3 className="text-sm font-bold text-fg-primary">{sn.title ?? t("untitled")}</h3>
                        <p className="text-sm text-fg-secondary whitespace-pre-wrap">{sn.content ?? ""}</p>
                      </>
                    )}
                    <div className="text-[10px] text-fg-tertiary">From {sn.ownerName ?? sn.ownerEmail}</div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {sharedNotes?.map((note) => {
                  const title = note.title ?? (note.content ?? "").split("\n")[0]?.trim().substring(0, 60) ?? t("untitled");
                  const preview = (note.content ?? "").substring(0, 120);

                  return (
                    <div
                      key={note.id}
                      onClick={() => {
                        setSelectedSharedNoteId(note.id);
                        setSharedEditTitle(note.title ?? "");
                        setSharedEditContent(note.content ?? "");
                      }}
                      className="group p-5 rounded-xl cursor-pointer transition-all duration-200 border border-white/[0.08] bg-[rgba(var(--accent-primary),0.03)] backdrop-blur-sm hover:bg-[rgba(var(--accent-primary),0.07)] hover:border-[rgba(var(--accent-primary),0.25)]"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[rgba(var(--accent-primary),0.15)] text-accent-primary border border-[rgba(var(--accent-primary),0.2)]">
                          {note.permission === "write" ? t("sharing.canEdit") : t("sharing.viewOnly")}
                        </span>
                        <span className="text-xs text-fg-tertiary">{formatTime(note.createdAt)}</span>
                      </div>
                      <h3 className="text-sm font-bold text-fg-primary mb-2 group-hover:text-accent-primary transition-colors line-clamp-1">
                        {note.passwordHash ? t("encryptedNote") : title}
                      </h3>
                      <p className="text-fg-tertiary text-xs leading-relaxed mb-4 line-clamp-3">
                        {note.passwordHash ? t("passwordProtected") : (preview || t("noContent"))}
                      </p>
                      <div className="flex items-center gap-2 text-fg-tertiary">
                        <Users size={12} />
                        <span className="text-[10px]">
                          From {note.ownerName ?? note.ownerEmail}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {(!sharedNotes || sharedNotes.length === 0) && (
                  <div className="col-span-full text-center py-16">
                    <Users size={36} className="mx-auto text-fg-tertiary mb-3" />
                    <p className="text-sm text-fg-secondary font-medium">{t("sharing.emptyTitle")}</p>
                    <p className="text-xs text-fg-tertiary mt-1">{t("sharing.emptyDesc")}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================================================================== */}
      {/* CREATE NOTE MODAL                                                  */}
      {/* ================================================================== */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowCreateForm(false)}>
          <div className="bg-bg-elevated rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-white/[0.08]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-fg-primary">{t("actions.create")}</h3>
              <button onClick={() => setShowCreateForm(false)} className="p-1.5 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-white/[0.06] transition">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={t("create.titlePlaceholder")}
                className="w-full px-4 py-2.5 bg-bg-primary rounded-lg text-sm text-fg-primary placeholder:text-fg-tertiary border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
                autoFocus
              />
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={t("create.contentPlaceholder")}
                rows={6}
                className="w-full px-4 py-3 bg-bg-primary rounded-lg text-sm text-fg-primary placeholder:text-fg-tertiary border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-accent-primary/30 resize-none"
              />
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] uppercase tracking-wider text-fg-tertiary font-bold mb-1.5">{t("create.passwordPlaceholder")}</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t("create.passwordPlaceholder")}
                    className="w-full px-3 py-2 bg-bg-primary rounded-lg text-sm text-fg-primary placeholder:text-fg-tertiary border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
                  />
                </div>
                {notebooksList && notebooksList.length > 0 && (
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase tracking-wider text-fg-tertiary font-bold mb-1.5">{t("notebook")}</label>
                    <select
                      value={newNotebookId ?? ""}
                      onChange={(e) => setNewNotebookId(e.target.value ? Number(e.target.value) : null)}
                      className="w-full px-3 py-2 bg-bg-primary rounded-lg text-sm text-fg-primary border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
                    >
                      <option value="">{t("common.none")}</option>
                      {notebooksList.map((nb) => (
                        <option key={nb.id} value={nb.id}>{nb.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <label className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-fg-primary">{t("calendar.addToCalendar")}</div>
                    <div className="text-[11px] text-fg-tertiary">{t("calendar.addToCalendarDesc")}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAddToCalendar((v) => {
                        const next = !v;
                        if (!next) setNewCalendarDate(null);
                        return next;
                      });
                    }}
                    className={cn(
                      "h-6 w-11 rounded-full transition relative border border-white/[0.10]",
                      addToCalendar ? "bg-accent-primary/60" : "bg-white/[0.06]",
                    )}
                    aria-pressed={addToCalendar}
                    aria-label={t("calendar.addToCalendar")}
                  >
                    <span
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white transition",
                        addToCalendar ? "right-0.5" : "left-0.5",
                      )}
                    />
                  </button>
                </label>

                {addToCalendar && (
                  <div className="mt-3">
                    <label className="block text-[10px] uppercase tracking-wider text-fg-tertiary font-bold mb-1.5">{t("calendar.calendarDate")}</label>
                    <input
                      type="date"
                      value={newCalendarDate ? newCalendarDate.toISOString().slice(0, 10) : ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) { setNewCalendarDate(null); return; }
                        // Create a local date (midday) to avoid timezone shifting.
                        const [y, m, d] = v.split("-").map(Number);
                        setNewCalendarDate(new Date(y!, (m! - 1), d, 12, 0, 0));
                      }}
                      className="w-full px-3 py-2 bg-bg-primary rounded-lg text-sm text-fg-primary border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => {
                  if (!newContent.trim()) { toast.info(t("messages.contentRequired")); return; }
                  createNote.mutate({
                    content: newContent,
                    title: newTitle || undefined,
                    password: newPassword || undefined,
                    notebookId: newNotebookId ?? undefined,
                    calendarDate: addToCalendar ? (newCalendarDate ?? undefined) : undefined,
                  });
                }}
                disabled={!newContent.trim() || createNote.isPending}
                className="flex-1 kairos-neon-btn text-white font-bold py-3 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
              >
                {createNote.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {t("actions.create")}
              </button>
              <button
                onClick={() => setShowCreateForm(false)}
                className="px-5 py-3 rounded-xl border border-white/[0.06] text-fg-secondary text-sm hover:bg-white/[0.04] transition"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* EXPANDED NOTE MODAL                                                */}
      {/* ================================================================== */}
      {selectedNoteId !== null && (() => {
        const note = allNotes.find((n) => n.id === selectedNoteId);
        if (!note) return null;
        const unlockedState = unlockedNotes[note.id];
        const isLocked = !!note.passwordHash && !unlockedState?.unlocked;

        return (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={closeExpandedNote}>
            <div className="bg-bg-elevated rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-auto p-6 border border-white/[0.08]" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-fg-tertiary">{formatDatePref(new Date(note.createdAt), "full")}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setShareModalNoteId(note.id); }}
                    className={cn(
                      "p-1.5 rounded-lg transition",
                      note.shareStatus !== "private"
                        ? "bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25"
                        : "text-fg-tertiary hover:text-accent-primary hover:bg-accent-primary/10"
                    )}
                    title={note.shareStatus !== "private" ? t("manageSharing") : t("share")}
                  >
                    <Share2 size={15} />
                  </button>
                  <button onClick={closeExpandedNote} className="p-1.5 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-white/[0.06] transition">
                    <X size={18} />
                  </button>
                </div>
              </div>

              {isLocked ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Lock className="text-red-400" size={18} />
                    <h3 className="text-base font-bold text-fg-primary">{t("passwordProtected")}</h3>
                  </div>
                  <p className="text-sm text-fg-secondary leading-relaxed">
                    {t("passwordProtected")}
                  </p>
                  <div className="relative">
                    <input
                      type={showPasswords[note.id] ? "text" : "password"}
                      value={passwordInputs[note.id] ?? ""}
                      onChange={(e) => {
                        setPasswordInputs((prev) => ({ ...prev, [note.id]: e.target.value }));
                        if (passwordErrors[note.id]) setPasswordErrors((prev) => ({ ...prev, [note.id]: "" }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") verifyPassword.mutate({ noteId: note.id, password: passwordInputs[note.id] ?? "" });
                      }}
                      placeholder={t("password.enterPassword")}
                      className="w-full bg-bg-primary text-fg-primary text-sm rounded-xl px-4 py-3 pr-10 focus:outline-none focus:ring-2 focus:ring-accent-primary/30 border border-white/[0.06]"
                    />
                    <button
                      onClick={() => setShowPasswords((prev) => ({ ...prev, [note.id]: !prev[note.id] }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-tertiary hover:text-fg-primary"
                    >
                      {showPasswords[note.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {passwordErrors[note.id] && (
                    <div className="text-red-400 text-xs flex items-center gap-1.5">
                      <AlertCircle size={12} /> {passwordErrors[note.id]}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => verifyPassword.mutate({ noteId: note.id, password: passwordInputs[note.id] ?? "" })}
                      disabled={!(passwordInputs[note.id]) || verifyPassword.isPending}
                      className="flex-1 kairos-neon-btn text-white text-sm font-bold py-3 rounded-xl disabled:opacity-50"
                    >
                      {verifyPassword.isPending ? t("actions.unlocking") : t("actions.unlock")}
                    </button>
                    <button
                      onClick={() => setShowResetPromptModal(note.id)}
                      className="px-4 py-3 rounded-xl border border-white/[0.06] text-fg-secondary text-sm hover:bg-white/[0.04] transition"
                    >
                      {t("password.resetPassword")}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2 pb-3 border-b border-white/[0.06]">
                    <input
                      type="text"
                      value={editingTitle[note.id] ?? note.title ?? ""}
                      onChange={(e) => setEditingTitle((prev) => ({ ...prev, [note.id]: e.target.value }))}
                      placeholder={t("untitled")}
                      className="text-base font-bold text-fg-primary bg-transparent flex-1 mr-2 focus:outline-none focus:ring-0 placeholder:text-fg-tertiary"
                    />
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => void refetchNotes()} className="p-1.5 text-fg-tertiary hover:text-fg-primary hover:bg-white/[0.06] rounded-lg transition">
                        <RefreshCw size={15} />
                      </button>
                      <button
                        onClick={() => requestDeleteNote(note.id)}
                        className="p-1.5 rounded-lg transition text-fg-tertiary hover:text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mb-3 text-[10px] text-fg-tertiary">
                    <span>{t("meta.created")}: {formatFullDate(note.createdAt)}</span>
                    <span>{t("meta.edited")}: {formatFullDate(note.updatedAt)}</span>
                  </div>
                  <textarea
                    value={editingContent[note.id] ?? (unlockedState?.content ?? note.content ?? "")}
                    onChange={(e) => setEditingContent((prev) => ({ ...prev, [note.id]: e.target.value }))}
                    className="w-full min-h-[200px] bg-bg-primary text-fg-primary rounded-xl p-4 text-sm leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary/30 border border-white/[0.06]"
                  />
                  <button
                    onClick={() => {
                      const content = editingContent[note.id] ?? (unlockedState?.content ?? note.content ?? "");
                      const title = editingTitle[note.id] ?? note.title ?? "";
                      updateNote.mutate({ id: note.id, content, title: title || undefined });
                    }}
                    disabled={updateNote.isPending}
                    className="w-full mt-4 kairos-neon-btn text-white font-bold py-3 rounded-xl disabled:opacity-50 text-sm"
                  >
                    {updateNote.isPending ? t("actions.saving") : t("actions.save")}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ================================================================== */}
      {/* SHARE MODAL                                                        */}
      {/* ================================================================== */}
      {shareModalNoteId !== null && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4" onClick={() => { setShareModalNoteId(null); setShowShareSuggestions(false); }}>
          <div className="bg-bg-elevated rounded-2xl shadow-2xl max-w-md w-full p-6 border border-white/[0.08]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent-primary/15 flex items-center justify-center">
                  <Share2 size={16} className="text-accent-primary" />
                </div>
                <h3 className="text-base font-bold text-fg-primary">{t("share")}</h3>
              </div>
              <button onClick={() => { setShareModalNoteId(null); setShowShareSuggestions(false); }} className="p-1.5 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-white/[0.06] transition">
                <X size={18} />
              </button>
            </div>

            <div className="flex gap-2 mb-4">
              <div className="flex-1 relative">
                <input
                  type="email"
                  value={shareEmail}
                  onChange={(e) => { setShareEmail(e.target.value); setShowShareSuggestions(true); }}
                  onFocus={() => setShowShareSuggestions(true)}
                  placeholder={t("sharing.emailPlaceholder")}
                  className="w-full px-3 py-2 bg-bg-primary rounded-lg text-sm text-fg-primary placeholder:text-fg-tertiary border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && shareEmail.trim()) {
                      shareNote.mutate({ noteId: shareModalNoteId, email: shareEmail, permission: sharePermission });
                      setShowShareSuggestions(false);
                    }
                  }}
                />
                {/* Org member suggestions */}
                {showShareSuggestions && shareEmail.trim() && !shareEmailDebounced && shareSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded-lg border border-white/[0.08] bg-bg-elevated shadow-xl max-h-40 overflow-y-auto">
                    {shareSuggestions.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { setShareEmail(m.email); setShowShareSuggestions(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.06] transition text-left"
                      >
                        {m.image ? (
                          <Image src={m.image} alt="" width={28} height={28} unoptimized className="w-7 h-7 rounded-full object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-accent-primary/15 flex items-center justify-center text-[10px] font-bold text-accent-primary">
                            {(m.name ?? m.email)?.[0]?.toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-fg-primary truncate">{m.name ?? t("sharing.noName")}</p>
                          <p className="text-[10px] text-fg-tertiary truncate">{m.email}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {/* Email lookup result */}
                {shareEmailDebounced && !isShareLookingUp && shareEmailLookup && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-10 p-2.5 rounded-lg border border-accent-primary/20 bg-bg-elevated shadow-lg flex items-center gap-2.5">
                    {shareEmailLookup.image ? (
                      <Image src={shareEmailLookup.image} alt="" width={32} height={32} unoptimized className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-accent-primary/15 flex items-center justify-center">
                        <span className="text-xs font-bold text-accent-primary">
                          {(shareEmailLookup.name ?? shareEmailLookup.email)?.[0]?.toUpperCase() ?? "?"}
                        </span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg-primary truncate">{shareEmailLookup.name ?? t("sharing.noName")}</p>
                      <p className="text-[10px] text-fg-tertiary truncate">{shareEmailLookup.email}</p>
                    </div>
                  </div>
                )}
                {shareEmailDebounced && !isShareLookingUp && !shareEmailLookup && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-10 p-2.5 rounded-lg border border-red-500/20 bg-bg-elevated shadow-lg">
                    <p className="text-xs text-red-400">{t("sharing.noAccount")}</p>
                  </div>
                )}
                {shareEmailDebounced && isShareLookingUp && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-10 p-2.5 rounded-lg border border-white/[0.06] bg-bg-elevated shadow-lg flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin text-fg-tertiary" />
                    <p className="text-xs text-fg-tertiary">{t("sharing.lookup")}</p>
                  </div>
                )}
              </div>
              <select
                value={sharePermission}
                onChange={(e) => setSharePermission(e.target.value as "read" | "write")}
                className="px-3 py-2 bg-bg-primary rounded-lg text-sm text-fg-primary border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
              >
                <option value="read">{t("sharing.view")}</option>
                <option value="write">{t("sharing.edit")}</option>
              </select>
              <button
                onClick={() => {
                  if (shareEmail.trim()) {
                    shareNote.mutate({ noteId: shareModalNoteId, email: shareEmail, permission: sharePermission });
                  }
                  setShowShareSuggestions(false);
                }}
                disabled={!shareEmail.trim() || shareNote.isPending}
                className="px-4 py-2 kairos-neon-btn text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                {shareNote.isPending ? <Loader2 size={14} className="animate-spin" /> : t("share")}
              </button>
            </div>

            {/* Current shares */}
            {noteSharesList && noteSharesList.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                <p className="text-[10px] uppercase tracking-wider text-fg-tertiary font-bold">{t("sharing.sharedWith")}</p>
                {noteSharesList.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-bg-primary/50">
                    <div className="flex items-center gap-2.5">
                      {s.userImage ? (
                        <Image src={s.userImage} alt="" width={28} height={28} unoptimized className="w-7 h-7 rounded-full object-cover" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-accent-primary/15 flex items-center justify-center text-[10px] font-bold text-accent-primary">
                          {(s.userName ?? s.userEmail)?.[0]?.toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-fg-primary font-medium">{s.userName ?? s.userEmail}</p>
                        <p className="text-[10px] text-fg-tertiary capitalize">{s.permission}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => unshareNote.mutate({ noteId: shareModalNoteId, userId: s.userId })}
                      className="p-1 rounded text-fg-tertiary hover:text-red-400 transition"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* RESET PROMPT MODAL                                                 */}
      {/* ================================================================== */}
      {showResetPromptModal !== null && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-bg-elevated rounded-2xl shadow-2xl max-w-md w-full p-6 border border-white/[0.08]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center">
                <AlertCircle className="text-red-400" size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-fg-primary">{t("messages.incorrectPassword")}</h3>
                <p className="text-xs text-fg-secondary">{t("password.multipleFailedAttempts")}</p>
              </div>
            </div>
            <p className="text-sm text-fg-secondary mb-6">{t("password.resetPrompt")}</p>
            <div className="flex gap-3">
              <button onClick={() => setShowResetPromptModal(null)} className="flex-1 px-4 py-3 border border-white/[0.06] text-fg-primary hover:bg-white/[0.04] rounded-xl text-sm font-bold transition">
                {t("password.tryAgain")}
              </button>
              <button
                onClick={() => {
                  const id = showResetPromptModal;
                  setShowResetPromptModal(null);
                  setShowResetModal(id);
                  setResetPinInput(""); setResetPinError(null);
                  setNewPasswordInput(""); setConfirmNewPasswordInput("");
                }}
                className="flex-1 px-4 py-3 kairos-neon-btn text-white font-bold rounded-xl text-sm"
              >
                {t("password.resetPassword")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* RESET MODAL (PIN)                                                  */}
      {/* ================================================================== */}
      {showResetModal !== null && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-bg-elevated rounded-2xl shadow-2xl max-w-md w-full p-6 border border-white/[0.08]">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 bg-accent-primary/10 rounded-lg flex items-center justify-center">
                <KeyRound className="text-accent-primary" size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-fg-primary">{t("password.resetPassword")}</h3>
                <p className="text-xs text-fg-secondary">{t("password.enterSecretPin")}</p>
              </div>
            </div>

            <div className="bg-bg-primary border border-white/[0.06] rounded-xl p-4 mb-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-fg-secondary mb-1.5">{t("password.resetPin")}</label>
                <input
                  type="password"
                  value={resetPinInput}
                  onChange={(e) => { setResetPinInput(e.target.value); setResetPinError(null); }}
                  placeholder={t("password.enterPin")}
                  className="w-full bg-bg-elevated text-fg-primary text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent-primary/30 border border-white/[0.06]"
                />
              </div>
              {resetPinHint && (
                <p className="text-xs text-fg-tertiary italic">Hint: {resetPinHint}</p>
              )}
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-bold text-fg-secondary mb-1.5">{t("password.newPassword")}</label>
                <div className="relative">
                  <input
                    type={showNewPasswords ? "text" : "password"}
                    value={newPasswordInput}
                    onChange={(e) => setNewPasswordInput(e.target.value)}
                    className="w-full bg-bg-primary text-fg-primary text-sm rounded-lg px-4 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-accent-primary/30 border border-white/[0.06]"
                  />
                  <button onClick={() => setShowNewPasswords((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-tertiary hover:text-fg-primary">
                    {showNewPasswords ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-fg-secondary mb-1.5">{t("password.confirmPassword")}</label>
                <input
                  type={showNewPasswords ? "text" : "password"}
                  value={confirmNewPasswordInput}
                  onChange={(e) => setConfirmNewPasswordInput(e.target.value)}
                  className="w-full bg-bg-primary text-fg-primary text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent-primary/30 border border-white/[0.06]"
                />
              </div>
            </div>

            {resetPinError && (
              <div className="mb-4 text-xs text-red-400 flex items-center gap-1.5">
                <AlertCircle size={12} /> {resetPinError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setShowResetModal(null); setResetPinInput(""); setResetPinError(null); }}
                className="flex-1 px-4 py-3 border border-white/[0.06] text-fg-primary hover:bg-white/[0.04] rounded-xl text-sm font-bold transition"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => {
                  if (!resetPinInput.trim()) { setResetPinError(t("password.passwordRequired")); return; }
                  if (!newPasswordInput || !confirmNewPasswordInput) { setResetPinError(t("password.passwordRequired")); return; }
                  if (newPasswordInput !== confirmNewPasswordInput) { setResetPinError(t("password.passwordsMismatch")); return; }
                  resetPasswordWithPin.mutate({ noteId: showResetModal, resetPin: resetPinInput.trim(), newPassword: newPasswordInput });
                }}
                disabled={resetPasswordWithPin.isPending}
                className="flex-1 px-4 py-3 kairos-neon-btn text-white font-bold rounded-xl text-sm disabled:opacity-50"
              >
                {resetPasswordWithPin.isPending ? t("password.resetting") : t("password.resetPassword")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Click-away handler for context menus */}
      {contextMenuNoteId !== null && (
        <div className="fixed inset-0 z-10" onClick={() => setContextMenuNoteId(null)} />
      )}
    </div>
  );
}
