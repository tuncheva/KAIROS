"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "~/trpc/react";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { useRolePermissions } from "~/lib/useRolePermissions";
import { useDateFormat } from "~/lib/hooks/useDateFormat";
import { useTranslations } from "next-intl";
import {
  Plus,
  Sparkles,
  Upload,
  Calendar,
  User,
  UserPlus,
  CheckCircle2,
  Check,
  Loader2,
  ChevronDown,
  Trash2,
  AlertTriangle,
  X,
  Clock,
  CheckSquare,
  AlertCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { MilestoneTimeline } from "./MilestoneTimeline";

/* ─── Types ─── */

type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";
type TaskPriority = "low" | "medium" | "high" | "urgent";

type ProjectCard = {
  id: number;
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  tasks: Array<{ id: number; status: TaskStatus; dueDate: Date | null }>;
};

type OrgActivityEntry = {
  id: number;
  taskId: number;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
  taskTitle: string;
  projectId: number;
  projectTitle: string;
  user: {
    id: string | null;
    name: string | null;
    email: string | null;
    image: string | null;
  } | null;
  assignee: {
    id: string | null;
    name: string | null;
    image: string | null;
  } | null;
};

type OrgActivityResponse = {
  scope: "organization" | "personal";
  rows: OrgActivityEntry[];
};

type GeneratedTask = {
  title: string;
  description?: string;
  priority: TaskPriority;
  orderIndex: number;
  estimatedDueDays?: number;
};

type GenerateTaskDraftsResult = {
  draftId: string;
  tasks: GeneratedTask[];
  reasoning: string;
  projectTitle: string;
  projectDescription?: string;
};

type OrgMember = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: string;
  joinedAt: Date;
};

/* ─── Typed API wrapper (same pattern as ProgressFeedClient) ─── */
const typedApi = api as unknown as {
  user: {
    getProfile: {
      useQuery: (
        input?: undefined,
        opts?: { staleTime?: number; enabled?: boolean },
      ) => {
        data: {
          id: string;
          name: string | null;
          email: string | null;
          image: string | null;
          activeOrganizationId: number | null;
          organization: { id: number; name: string } | null;
          role: string | null;
        } | null | undefined;
        isLoading: boolean;
      };
    };
  };
  organization: {
    getMembers: {
      useQuery: (
        input: { organizationId: number },
        opts?: { staleTime?: number; enabled?: boolean },
      ) => {
        data: OrgMember[] | undefined;
        isLoading: boolean;
      };
    };
    inviteMember: {
      useMutation: (opts?: {
        onSuccess?: () => void;
        onError?: (err: { message: string }) => void;
      }) => {
        mutate: (input: { organizationId: number; email: string; role: string }) => void;
        isPending: boolean;
      };
    };
  };
  project: {
    getMyProjects: {
      useQuery: (
        input?: undefined,
        opts?: { staleTime?: number; enabled?: boolean },
      ) => { data: ProjectCard[] | undefined; isLoading: boolean; error: { message: string } | null };
    };
  };
  task: {
    getOrgActivity: {
      useQuery: (
        input: { limit: number; scope?: string },
        opts?: { staleTime?: number },
      ) => { data: OrgActivityResponse | undefined; isLoading: boolean; error: { message: string } | null };
    };
    create: {
      useMutation: (opts?: {
        onSuccess?: () => void;
        onError?: (err: { message: string }) => void;
      }) => {
        mutate: (input: {
          projectId: number;
          title: string;
          description?: string;
          priority: TaskPriority;
          status?: TaskStatus;
          dueDate?: Date;
          assignedToId?: string;
        }) => void;
        isPending: boolean;
      };
    };
    getByProject: {
      useQuery: (
        input: { projectId: number },
        opts?: { staleTime?: number; enabled?: boolean },
      ) => {
        data: Array<{
          id: number;
          title: string;
          description: string | null;
          status: TaskStatus;
          priority: TaskPriority;
          dueDate: Date | null;
          orderIndex: number;
          createdAt: Date;
          creator: { id: string | null; name: string | null; image: string | null } | null;
          assignee: { id: string | null; name: string | null; image: string | null } | null;
        }> | undefined;
        isLoading: boolean;
      };
    };
    updateStatus: {
      useMutation: (opts?: {
        onSuccess?: () => void;
        onError?: (err: { message: string }) => void;
      }) => {
        mutate: (input: { taskId: number; status: TaskStatus; completionNote?: string | null }) => void;
        isPending: boolean;
      };
    };
    delete: {
      useMutation: (opts?: {
        onSuccess?: () => void;
        onError?: (err: { message: string }) => void;
      }) => {
        mutate: (input: { taskId: number }) => void;
        isPending: boolean;
      };
    };
  };
  agent: {
    generateTaskDrafts: {
      useMutation: (opts?: {
        onSuccess?: (data: GenerateTaskDraftsResult) => void;
        onError?: (err: { message: string }) => void;
      }) => {
        mutate: (input: { projectId: number; message?: string }) => void;
        isPending: boolean;
        data?: GenerateTaskDraftsResult;
      };
    };
  };
};

/* ─── Priority helpers ─── */
const PRIORITY_OPTIONS: { value: TaskPriority; color: string }[] = [
  { value: "low", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
  { value: "medium", color: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
  { value: "high", color: "bg-orange-500/15 text-orange-400 border-orange-500/20" },
  { value: "urgent", color: "bg-red-500/15 text-red-400 border-red-500/20" },
];

/* ─── Status helpers ─── */
const STATUS_OPTIONS: { value: TaskStatus; color: string }[] = [
  { value: "pending", color: "bg-slate-500/15 text-slate-400 border-slate-500/20" },
  { value: "in_progress", color: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  { value: "completed", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
  { value: "blocked", color: "bg-red-500/15 text-red-400 border-red-500/20" },
];

const PRIORITY_LABEL_KEY: Record<TaskPriority, string> = {
  low: "priority.low",
  medium: "priority.medium",
  high: "priority.high",
  urgent: "priority.urgent",
};

const STATUS_LABEL_KEY: Record<TaskStatus, string> = {
  pending: "status.pending",
  in_progress: "status.inProgress",
  completed: "status.completed",
  blocked: "status.blocked",
};

/* ─── AI Generated Tasks Preview ─── */
function AiDraftPreview({
  tasks,
  reasoning,
  onApply,
  onDismiss,
  isApplying,
}: {
  tasks: GeneratedTask[];
  reasoning: string;
  onApply: (tasks: GeneratedTask[]) => void;
  onDismiss: () => void;
  isApplying: boolean;
}) {
  const t = useTranslations("progress.tasks");
  const [selected, setSelected] = useState<Set<number>>(() => new Set(tasks.map((_, i) => i)));

  const toggleTask = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === tasks.length) setSelected(new Set());
    else setSelected(new Set(tasks.map((_, i) => i)));
  };

  const selectedTasks = tasks.filter((_, i) => selected.has(i));

  return (
    <div className="mt-4 rounded-xl border border-accent-primary/30 bg-accent-primary/[0.04] dark:bg-accent-primary/[0.06] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-accent-primary" />
          <h4 className="text-sm font-bold text-fg-primary">{t("aiGeneratedTasks")}</h4>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleAll}
            className="text-[11px] text-accent-primary hover:text-accent-primary/80 font-medium transition-colors"
          >
            {selected.size === tasks.length ? t("deselectAll") : t("selectAll")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-fg-tertiary hover:text-fg-secondary transition-colors"
          >
            {t("dismiss")}
          </button>
        </div>
      </div>

      {reasoning && (
        <p className="text-xs text-fg-secondary italic leading-relaxed">{reasoning}</p>
      )}

      <div className="space-y-2">
        {tasks.map((t, i) => (
          <button
            key={i}
            type="button"
            onClick={() => toggleTask(i)}
            className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
              selected.has(i)
                ? "bg-accent-primary/[0.06] dark:bg-accent-primary/[0.08] border-accent-primary/30"
                : "bg-bg-elevated dark:bg-white/[0.03] border-border-medium/20 dark:border-white/[0.06] opacity-60"
            }`}
          >
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
              selected.has(i)
                ? "bg-accent-primary border-accent-primary"
                : "border-slate-300 dark:border-slate-600"
            }`}>
              {selected.has(i) && <Check size={11} className="text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-fg-primary">{t.title}</p>
              {t.description && (
                <p className="text-xs text-fg-secondary mt-0.5 line-clamp-2">{t.description}</p>
              )}
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                  PRIORITY_OPTIONS.find((p) => p.value === t.priority)?.color ?? ""
                }`}>
                  {t.priority.toUpperCase()}
                </span>
                {t.estimatedDueDays && (
                  <span className="text-[10px] text-fg-quaternary">
                    ~{t.estimatedDueDays}d
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onApply(selectedTasks)}
        disabled={isApplying || selectedTasks.length === 0}
        className="w-full py-2.5 rounded-xl bg-accent-primary text-white font-bold text-sm flex items-center justify-center gap-2 hover:brightness-110 transition-all shadow-lg shadow-accent-primary/20 disabled:opacity-50"
      >
        {isApplying ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            {t("creatingTasks")}
          </>
        ) : (
          <>
            <CheckCircle2 size={14} />
            {t("createSelectedTasks", { selected: selectedTasks.length, total: tasks.length })}
          </>
        )}
      </button>
    </div>
  );
}

/* ─── Create New Entry Form ─── */
function CreateNewEntryForm({
  projects,
  onCreated,
  members,
  selectedProjectId,
  onProjectChange,
  organizationId,
}: {
  projects: ProjectCard[];
  onCreated: () => void;
  members: OrgMember[];
  selectedProjectId: number | null;
  onProjectChange: (id: number | null) => void;
  organizationId: number | null;
}) {
  const t = useTranslations("progress.tasks");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>("pending");
  const [dueDate, setDueDate] = useState("");
  const [assignedToId, setAssignedToId] = useState<string>("");
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assignDropdownRef = useRef<HTMLDivElement>(null);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; size: number; type: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Restore unsaved task changes from localStorage
  const taskDraftKey = 'kairos_task_draft';
  const isTaskRestoredRef = useRef(false);
  useEffect(() => {
    if (isTaskRestoredRef.current) return;
    isTaskRestoredRef.current = true;
    try {
      const saved = localStorage.getItem(taskDraftKey);
      if (saved) {
        const d = JSON.parse(saved) as Record<string, string>;
        if (Date.now() - (Number(d._ts) || 0) < 120000) { // 2 minutes
          if (d.title) setTitle(d.title);
          if (d.description) setDescription(d.description);
          if (d.dueDate) setDueDate(d.dueDate);
        } else {
          localStorage.removeItem(taskDraftKey);
        }
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const hasContent = title || description;
    if (hasContent) {
      localStorage.setItem(taskDraftKey, JSON.stringify({ title, description, dueDate, _ts: Date.now() }));
    } else {
      localStorage.removeItem(taskDraftKey);
    }
  }, [title, description, dueDate]);

  /* AI draft state */
  const [aiDrafts, setAiDrafts] = useState<GeneratedTask[] | null>(null);
  const [aiReasoning, setAiReasoning] = useState("");
  const [isApplyingDrafts, setIsApplyingDrafts] = useState(false);

  /* Close assign dropdown on click outside */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (assignDropdownRef.current && !assignDropdownRef.current.contains(e.target as Node)) {
        setShowAssignDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedMember = members.find((m) => m.id === assignedToId);

  const createTask = typedApi.task.create.useMutation({
    onSuccess: () => {
      setTitle("");
      setDescription("");
      setDueDate("");
      setAssignedToId("");
      setStatus("pending");
      setError("");
      // Keep PDF attachments visible after task creation; only clear non-PDFs
      setAttachedFiles((prev) => prev.filter((f) => f.type === "application/pdf"));
      localStorage.removeItem(taskDraftKey);
      onCreated();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const generateDrafts = typedApi.agent.generateTaskDrafts.useMutation({
    onSuccess: (data) => {
      setAiDrafts(data.tasks);
      setAiReasoning(data.reasoning);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const inviteMember = typedApi.organization.inviteMember.useMutation({
    onSuccess: () => {
      setShowInviteModal(false);
      setInviteEmail("");
      setInviteError("");
    },
    onError: (err) => {
      setInviteError(err.message);
    },
  });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !organizationId) return;
    inviteMember.mutate({
      organizationId,
      email: inviteEmail.trim(),
      role: "member",
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !selectedProjectId) return;

    createTask.mutate({
      projectId: selectedProjectId,
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      status,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      assignedToId: assignedToId || undefined,
    });
  };

  const handleGenerateAi = () => {
    if (!selectedProjectId) return;
    setError("");
    generateDrafts.mutate({
      projectId: selectedProjectId,
      message: description.trim() || undefined,
    });
  };

  const applyAiDrafts = useCallback(
    (tasks: GeneratedTask[]) => {
      if (!selectedProjectId) return;
      setIsApplyingDrafts(true);

      let idx = 0;
      const createNext = () => {
        if (idx >= tasks.length) {
          setIsApplyingDrafts(false);
          setAiDrafts(null);
          setAiReasoning("");
          onCreated();
          return;
        }
        const t = tasks[idx]!;
        idx++;
        createTask.mutate({
          projectId: selectedProjectId,
          title: t.title,
          description: t.description,
          priority: t.priority,
          dueDate: t.estimatedDueDays
            ? new Date(Date.now() + t.estimatedDueDays * 86400000)
            : undefined,
        });
        setTimeout(createNext, 80);
      };
      createNext();
    },
    [selectedProjectId, createTask, onCreated],
  );

  return (
    <div className="create-entry-card bg-white dark:bg-[rgb(18,18,24)] rounded-xl border border-slate-200 dark:border-white/[0.08] shadow-sm p-6 flex flex-col gap-6 relative overflow-hidden">
      {/* Glow orb */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-accent-primary/5 blur-[60px] rounded-full pointer-events-none -translate-y-1/2 translate-x-1/4" />
      <h3 className="text-fg-primary text-lg font-bold border-b border-border-medium/40 dark:border-white/[0.06] pb-4 flex items-center gap-2 relative z-10">
        <Plus size={18} className="text-accent-primary" />
        {t("newTask")}
      </h3>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5 relative z-10">
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {/* Project select */}
        {projects.length > 0 && (
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">
              {t("project")}
            </label>
            <div className="relative">
              <select
                value={selectedProjectId ?? ""}
                onChange={(e) => onProjectChange(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-accent-primary/30 text-slate-900 dark:text-slate-100 focus:border-accent-primary focus:ring-1 focus:ring-accent-primary h-12 px-4 appearance-none pr-10 transition-all hover:border-accent-primary/50"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id} className="bg-bg-primary text-fg-primary">
                    {p.title}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-tertiary pointer-events-none"
              />
            </div>
          </div>
        )}

        {/* Task Title */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">
            {t("taskTitle")}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("taskTitlePlaceholder")}
            className="w-full rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-accent-primary/30 text-slate-900 dark:text-slate-100 focus:border-accent-primary focus:ring-1 focus:ring-accent-primary h-12 px-4 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all hover:border-accent-primary/50"
          />
        </div>

        {/* Priority / Status / Assign To / Date row */}
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-2">
            {/* Priority selector — dropdown */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">
                {t("priorityLabel")}
              </label>
              <div className="relative">
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  className="w-full rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-accent-primary/30 text-slate-900 dark:text-slate-100 focus:border-accent-primary focus:ring-1 focus:ring-accent-primary h-12 px-4 appearance-none transition-all hover:border-accent-primary/50"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value} className="bg-bg-primary text-fg-primary">
                      {t(PRIORITY_LABEL_KEY[p.value])}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${
                    priority === "low" ? "bg-emerald-400" :
                    priority === "medium" ? "bg-amber-400" :
                    priority === "high" ? "bg-orange-400" : "bg-red-400"
                  }`} />
                  <ChevronDown size={12} className="text-fg-tertiary" />
                </div>
              </div>
            </div>
            {/* Status selector — dropdown */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">
                {t("statusLabel")}
              </label>
              <div className="relative">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                  className="w-full rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-accent-primary/30 text-slate-900 dark:text-slate-100 focus:border-accent-primary focus:ring-1 focus:ring-accent-primary h-12 px-4 appearance-none transition-all hover:border-accent-primary/50"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value} className="bg-bg-primary text-fg-primary">
                      {t(STATUS_LABEL_KEY[s.value])}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${
                    status === "pending" ? "bg-slate-400" :
                    status === "in_progress" ? "bg-blue-400" :
                    status === "completed" ? "bg-emerald-400" : "bg-red-400"
                  }`} />
                  <ChevronDown size={12} className="text-fg-tertiary" />
                </div>
              </div>
            </div>
            <div ref={assignDropdownRef} className="relative">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">
                {t("assignTo")}
              </label>
              <button
                type="button"
                onClick={() => setShowAssignDropdown(!showAssignDropdown)}
                className="w-full flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-accent-primary/30 h-12 px-4 text-left transition-all hover:border-accent-primary/50"
              >
                {selectedMember ? (
                  <>
                    <div className="w-5 h-5 rounded-full overflow-hidden bg-accent-primary/20 flex-shrink-0">
                      {selectedMember.image ? (
                        <Image src={selectedMember.image} alt={selectedMember.name ?? ""} width={20} height={20} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent-primary to-accent-secondary">
                          <User size={10} className="text-white" />
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-fg-primary font-medium truncate flex-1">{selectedMember.name?.split(" ")[0] ?? t("member")}</span>
                  </>
                ) : (
                  <>
                    <div className="w-5 h-5 rounded-full bg-accent-primary/20 flex items-center justify-center flex-shrink-0">
                      <User size={10} className="text-accent-primary" />
                    </div>
                    <span className="text-xs text-fg-quaternary font-medium truncate flex-1">{t("select")}</span>
                  </>
                )}
                <ChevronDown size={12} className={`text-fg-tertiary transition-transform ${showAssignDropdown ? "rotate-180" : ""}`} />
              </button>

              {/* Assign dropdown */}
              {showAssignDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 z-30 rounded-xl border border-border-medium/40 dark:border-white/[0.1] bg-bg-elevated dark:bg-[rgb(14,14,18)] shadow-xl shadow-black/10 dark:shadow-black/30 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="max-h-36 overflow-y-auto py-1">
                    {/* Unassign option */}
                    <button
                      type="button"
                      onClick={() => { setAssignedToId(""); setShowAssignDropdown(false); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-accent-primary/10 transition-colors ${!assignedToId ? "bg-accent-primary/5" : ""}`}
                    >
                      <div className="w-5 h-5 rounded-full bg-bg-tertiary/50 flex items-center justify-center flex-shrink-0">
                        <User size={10} className="text-fg-quaternary" />
                      </div>
                      <span className="text-xs text-fg-secondary">{t("unassigned")}</span>
                    </button>

                    {members.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { setAssignedToId(m.id); setShowAssignDropdown(false); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-accent-primary/10 transition-colors ${assignedToId === m.id ? "bg-accent-primary/5" : ""}`}
                      >
                        <div className="w-5 h-5 rounded-full overflow-hidden bg-accent-primary/20 flex-shrink-0">
                          {m.image ? (
                            <Image src={m.image} alt={m.name ?? ""} width={20} height={20} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent-primary to-accent-secondary">
                              <User size={8} className="text-white" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-fg-primary font-medium truncate">{m.name ?? t("unknown")}</p>
                          <p className="text-[10px] text-fg-quaternary truncate">{m.role}</p>
                        </div>
                        {assignedToId === m.id && (
                          <CheckCircle2 size={12} className="text-accent-primary flex-shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Invite section */}
                  <div className="border-t border-border-medium/20 dark:border-white/[0.06] p-2">
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-accent-primary font-medium hover:bg-accent-primary/10 transition-colors"
                      onClick={() => {
                        setShowAssignDropdown(false);
                        setShowInviteModal(true);
                      }}
                    >
                      <UserPlus size={13} />
                       <span>{t("invitePeople")}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">
                {t("date")}
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-accent-primary/30 text-slate-900 dark:text-slate-100 focus:border-accent-primary focus:ring-1 focus:ring-accent-primary h-12 px-4 transition-all hover:border-accent-primary/50"
              />
            </div>
          </div>
        </div>

        {/* Attachments */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">
            {t("attachments")}
          </label>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const files = Array.from(e.dataTransfer.files);
              const valid = files.filter((f) => f.size <= 10 * 1024 * 1024);
              if (valid.length < files.length) setError(t("errors.filesTooLarge"));
              setAttachedFiles((prev) => [...prev, ...valid.map((f) => ({ name: f.name, size: f.size, type: f.type }))]);
            }}
            className={`w-full rounded-lg border-2 border-dashed ${isDragging ? "border-accent-primary bg-accent-primary/10" : "border-slate-300 dark:border-accent-primary/40 bg-slate-50/50 dark:bg-black/10"} hover:bg-slate-50 dark:hover:bg-accent-primary/5 transition-colors flex flex-col items-center justify-center py-6 cursor-pointer hover:border-accent-primary/60`}
          >
            <Upload size={20} className="text-accent-primary" />
            <p className="text-xs text-fg-secondary">
              <span className="text-accent-primary font-semibold">{t("clickToUpload")}</span> {t("orDragDrop")}
            </p>
            <p className="text-[10px] text-fg-quaternary">{t("uploadFormats")}</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.png,.jpg,.jpeg"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              const valid = files.filter((f) => f.size <= 10 * 1024 * 1024);
              if (valid.length < files.length) setError(t("errors.filesTooLarge"));
              setAttachedFiles((prev) => [...prev, ...valid.map((f) => ({ name: f.name, size: f.size, type: f.type }))]);
              e.target.value = "";
            }}
          />
          {attachedFiles.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {attachedFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-accent-primary/20 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-accent-primary font-semibold uppercase text-[10px]">{f.name.split(".").pop()}</span>
                    <span className="text-fg-primary truncate">{f.name}</span>
                    <span className="text-fg-quaternary shrink-0">({(f.size / 1024).toFixed(0)} KB)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="p-1 rounded text-fg-tertiary hover:text-red-400 transition shrink-0"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI Task Planner — now below attachments, clickable */}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">
              {t("aiInstructionsLabel")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("aiInstructionsPlaceholder")}
              rows={3}
              className="w-full rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-accent-primary/30 text-slate-900 dark:text-slate-100 focus:border-accent-primary focus:ring-1 focus:ring-accent-primary min-h-[80px] p-4 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all resize-y hover:border-accent-primary/50"
            />
          </div>
          <button
            type="button"
            onClick={handleGenerateAi}
            disabled={generateDrafts.isPending || !selectedProjectId}
            className="w-full text-left bg-accent-primary/5 border border-accent-primary/50 hover:border-accent-primary rounded-lg p-4 flex items-start gap-4 transition-all hover:shadow-[0_0_15px_rgb(var(--accent-primary)/0.3)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            <div className="bg-accent-primary/20 p-2 rounded-full flex shrink-0 shadow-[0_0_10px_rgb(var(--accent-primary)/0.2)] group-hover:bg-accent-primary/30 transition-colors">
              {generateDrafts.isPending ? (
                <Loader2 size={24} className="text-accent-primary animate-spin" />
              ) : (
                <Sparkles size={24} className="text-accent-primary" />
              )}
            </div>
            <div className="flex flex-col">
              <h4 className="text-slate-900 dark:text-slate-100 font-semibold mb-1">
                {generateDrafts.isPending ? t("generating") : t("aiTaskPlanner")}
              </h4>
              <p className="text-slate-600 dark:text-slate-400 text-sm">
                {t("aiPlannerDescription")}
              </p>
            </div>
          </button>
        </div>

        {/* AI Draft Preview */}
        {aiDrafts && aiDrafts.length > 0 && (
          <AiDraftPreview
            tasks={aiDrafts}
            reasoning={aiReasoning}
            onApply={applyAiDrafts}
            onDismiss={() => { setAiDrafts(null); setAiReasoning(""); }}
            isApplying={isApplyingDrafts}
          />
        )}

        {/* Create Task Button */}
        <button
          type="submit"
          disabled={createTask.isPending || !title.trim() || !selectedProjectId}
          className="w-full bg-accent-primary hover:bg-accent-hover text-white px-8 py-3 rounded-lg font-semibold shadow-lg shadow-accent-primary/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {createTask.isPending ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {t("creating")}
            </>
          ) : (
            <>
              <Plus size={16} />
              {t("createTask")}
            </>
          )}
        </button>
      </form>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[rgb(18,18,24)] rounded-xl border border-slate-200 dark:border-white/[0.08] shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-fg-primary flex items-center gap-2">
                <UserPlus size={18} className="text-accent-primary" />
                {t("invitePeople")}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteEmail("");
                  setInviteError("");
                }}
                className="p-1 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors"
              >
                <X size={18} className="text-fg-tertiary" />
              </button>
            </div>
            
            <form onSubmit={handleInvite} className="space-y-4">
              {inviteError && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
                  <AlertTriangle size={14} />
                  {inviteError}
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-fg-secondary mb-2">
                  {t("emailAddress")}
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t("emailPlaceholder")}
                  className="w-full rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-accent-primary/30 text-slate-900 dark:text-slate-100 focus:border-accent-primary focus:ring-1 focus:ring-accent-primary h-12 px-4 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all"
                  autoFocus
                />
              </div>
              
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowInviteModal(false);
                    setInviteEmail("");
                    setInviteError("");
                  }}
                  className="flex-1 px-4 py-3 rounded-lg border border-slate-200 dark:border-white/[0.08] text-fg-secondary font-medium hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={inviteMember.isPending || !inviteEmail.trim() || !organizationId}
                  className="flex-1 bg-accent-primary hover:bg-accent-hover text-white px-4 py-3 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {inviteMember.isPending ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      {t("sending")}
                    </>
                  ) : (
                    <>
                      <UserPlus size={16} />
                      {t("sendInvite")}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Master Progress Header ─── */
function MasterProgressBar({
  percentage,
}: {
  percentage: number;
}) {
  const t = useTranslations("progress.tasks");
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
          {t("masterProgress")}
        </span>
        <span className="text-accent-primary font-bold">
          {Math.round(percentage)}%
        </span>
      </div>
      <div className="w-full bg-slate-200 dark:bg-white/10 rounded-full h-2">
        <div
          className="h-2 rounded-full transition-all duration-700 ease-out shadow-[0_0_10px_rgb(var(--accent-primary)/0.3)]"
          style={{
            width: `${percentage}%`,
            background: "linear-gradient(90deg, rgb(var(--accent-primary)), rgb(var(--accent-secondary)))",
          }}
        />
      </div>
    </div>
  );
}

/* ─── Status Filter ─── */
type StatusFilter = "all" | "completed" | "pending" | "in_progress" | "blocked";

/* ─── Task Status Visualization Card ─── */
function TaskStatusCard({
  title,
  count,
  icon: Icon,
  color,
}: {
  title: string;
  count: number;
  icon: LucideIcon;
  color: string;
}) {
  return (
    <div className={`rounded-lg border-2 p-4 ${color} flex flex-col gap-3 flex-1 min-w-[200px]`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color.replace("bg-", "bg-").replace("border-", "border-").split(" ")[0]}/20`}>
          <Icon size={20} />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{title}</p>
          <p className="text-2xl font-bold">{count}</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Task Board Column ─── */
type BoardTask = {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  orderIndex: number;
  createdAt: Date;
  creator: { id: string | null; name: string | null; image: string | null } | null;
  assignee: { id: string | null; name: string | null; image: string | null } | null;
};

const BOARD_COLUMNS: { status: TaskStatus; dotColor: string; headerBg: string }[] = [
  { status: "pending", dotColor: "bg-slate-400", headerBg: "bg-slate-100 dark:bg-slate-500/10" },
  { status: "in_progress", dotColor: "bg-blue-400", headerBg: "bg-blue-50 dark:bg-blue-500/10" },
  { status: "completed", dotColor: "bg-emerald-400", headerBg: "bg-emerald-50 dark:bg-emerald-500/10" },
  { status: "blocked", dotColor: "bg-red-400", headerBg: "bg-red-50 dark:bg-red-500/10" },
];

function TaskBoard({
  tasks,
  onStatusChange,
  onDelete,
  isUpdating,
  deletingId,
}: {
  tasks: BoardTask[];
  onStatusChange: (taskId: number, newStatus: TaskStatus) => void;
  onDelete: (taskId: number) => void;
  isUpdating: boolean;
  deletingId: number | null;
}) {
  const t = useTranslations("progress.tasks");
  const grouped = useMemo(() => {
    const map: Record<TaskStatus, BoardTask[]> = {
      pending: [],
      in_progress: [],
      completed: [],
      blocked: [],
    };
    for (const t of tasks) {
      if (map[t.status]) {
        map[t.status].push(t);
      }
    }
    return map;
  }, [tasks]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
      {BOARD_COLUMNS.map((col) => (
        <div key={col.status} className="flex flex-col rounded-xl border border-border-medium/40 dark:border-white/[0.06] bg-white dark:bg-[rgb(18,18,24)] overflow-hidden">
          {/* Column header */}
          <div className={`px-4 py-3 ${col.headerBg} border-b border-border-medium/30 dark:border-white/[0.06] flex items-center justify-between`}>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${col.dotColor}`} />
              <span className="text-sm font-bold text-fg-primary">{t(STATUS_LABEL_KEY[col.status])}</span>
            </div>
            <span className="text-xs font-semibold text-fg-quaternary bg-bg-tertiary/50 dark:bg-white/[0.06] px-2 py-0.5 rounded-full">
              {(grouped[col.status] ?? []).length}
            </span>
          </div>

          {/* Cards */}
          <div className="flex flex-col gap-2 p-2 min-h-[120px]">
            {(grouped[col.status] ?? []).length === 0 ? (
              <div className="flex items-center justify-center py-8 text-xs text-fg-quaternary">
                {t("noTasks")}
              </div>
            ) : (
              (grouped[col.status] ?? []).map((task) => (
                <BoardTaskCard
                  key={task.id}
                  task={task}
                  onStatusChange={onStatusChange}
                  onDelete={onDelete}
                  isUpdating={isUpdating}
                  isDeleting={deletingId === task.id}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function BoardTaskCard({
  task,
  onStatusChange,
  onDelete,
  isUpdating,
  isDeleting,
}: {
  task: BoardTask;
  onStatusChange: (taskId: number, newStatus: TaskStatus) => void;
  onDelete: (taskId: number) => void;
  isUpdating: boolean;
  isDeleting: boolean;
}) {
  const t = useTranslations("progress.tasks");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { formatDate: formatDatePref } = useDateFormat();
  const priorityOption = PRIORITY_OPTIONS.find((p) => p.value === task.priority);
  const dueStr = task.dueDate
    ? formatDatePref(new Date(task.dueDate), "short")
    : null;
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "completed";

  return (
    <div className="rounded-lg border border-border-medium/30 dark:border-white/[0.06] bg-bg-primary dark:bg-[rgb(14,14,18)] p-3 hover:border-accent-primary/30 transition-all group">
      {/* Title */}
      <h4 className="text-sm font-semibold text-fg-primary mb-2 leading-snug">{task.title}</h4>

      {/* Description snippet */}
      {task.description && (
        <p className="text-xs text-fg-tertiary mb-2 line-clamp-2">{task.description}</p>
      )}

      {/* Priority + due date row */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${priorityOption?.color ?? ""}`}>
          {task.priority.toUpperCase()}
        </span>
        {dueStr && (
          <span className={`text-[10px] flex items-center gap-1 ${isOverdue ? "text-red-400" : "text-fg-quaternary"}`}>
            <Calendar size={10} />
            {dueStr}
          </span>
        )}
      </div>

      {/* Status change dropdown */}
      <div className="mb-2">
        <select
          value={task.status}
          onChange={(e) => onStatusChange(task.id, e.target.value as TaskStatus)}
          disabled={isUpdating}
          className="w-full text-xs rounded-md bg-bg-tertiary/30 dark:bg-white/[0.04] border border-border-medium/30 dark:border-white/[0.06] text-fg-secondary px-2 py-1.5 focus:border-accent-primary focus:ring-1 focus:ring-accent-primary appearance-none cursor-pointer hover:border-accent-primary/40 transition-colors"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value} className="bg-bg-primary text-fg-primary">
              {t(STATUS_LABEL_KEY[s.value])}
            </option>
          ))}
        </select>
      </div>

      {/* Footer: assignee + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {task.assignee?.id && (
            <div className="flex items-center gap-1" title={task.assignee.name ?? t("assigned")}>
              <div className="w-5 h-5 rounded-full overflow-hidden bg-accent-primary/20 flex-shrink-0">
                {task.assignee.image ? (
                  <Image src={task.assignee.image} alt={task.assignee.name ?? ""} width={20} height={20} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent-primary to-accent-secondary">
                    <User size={10} className="text-white" />
                  </div>
                )}
              </div>
              <span className="text-[10px] text-fg-tertiary">{task.assignee.name?.split(" ")[0]}</span>
            </div>
          )}
        </div>

        {/* Delete */}
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { onDelete(task.id); setConfirmDelete(false); }}
              disabled={isDeleting}
              className="px-2 py-0.5 rounded bg-red-500/15 text-red-400 text-[10px] font-bold hover:bg-red-500/25 transition-colors"
            >
              {isDeleting ? <Loader2 size={10} className="animate-spin" /> : t("common.yes")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="px-2 py-0.5 rounded bg-bg-tertiary/50 text-fg-tertiary text-[10px] font-bold hover:text-fg-secondary transition-colors"
            >
              {t("common.no")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="p-1 rounded text-fg-quaternary opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all"
            title={t("deleteTask")}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Main Export ─── */
export function TaskTimelineClient() {
  const t = useTranslations("progress.tasks");
  const { data: session } = useSession();
  const { permissions } = useRolePermissions();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<"creation" | "timeline" | "board">("creation");

  /* Get user profile to determine active org */
  const { data: profile } = typedApi.user.getProfile.useQuery(undefined, {
    staleTime: 60_000,
  });

  const activeOrgId = profile?.organization?.id ?? profile?.activeOrganizationId ?? null;

  /* Get org members for assign dropdown */
  const { data: orgMembers } = typedApi.organization.getMembers.useQuery(
    { organizationId: activeOrgId! },
    { staleTime: 60_000, enabled: !!activeOrgId },
  );

  const {
    data: projects,
    isLoading: isLoadingProjects,
    error: projError,
  } = typedApi.project.getMyProjects.useQuery(undefined, {
    staleTime: 30_000,
    enabled: true,
  });

  const {
    data: activity,
    isLoading: isLoadingActivity,
    error: actError,
  } = typedApi.task.getOrgActivity.useQuery(
    { limit: 50, scope: "all" },
    { staleTime: 15_000 },
  );

  /* Get tasks for the board view */
  const effectivePidForBoard = selectedProjectId ?? projects?.[0]?.id ?? null;
  const {
    data: boardTasks,
    isLoading: isLoadingBoard,
  } = typedApi.task.getByProject.useQuery(
    { projectId: effectivePidForBoard! },
    { staleTime: 15_000, enabled: !!effectivePidForBoard && activeView === "board" },
  );

  const utils = api.useUtils();

  const handleCreated = () => {
    void utils.invalidate();
  };

  /* Status toggle mutation */
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const updateStatus = typedApi.task.updateStatus.useMutation({
    onSuccess: () => {
      setTogglingId(null);
      // Invalidate only the activity feed - projects will update via socket or next interaction
      void utils.task.getOrgActivity.invalidate();
    },
    onError: () => {
      setTogglingId(null);
    },
  });

  const handleToggleDone = (taskId: number, currentlyDone: boolean) => {
    setTogglingId(taskId);
    updateStatus.mutate({
      taskId,
      status: currentlyDone ? "pending" : "completed",
    });
  };

  /* Delete mutation */
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const deleteTask = typedApi.task.delete.useMutation({
    onSuccess: () => {
      setDeletingId(null);
      // Invalidate only the activity feed - projects will update via socket or next interaction
      void utils.task.getOrgActivity.invalidate();
    },
    onError: (err) => {
      setDeletingId(null);
      console.error("[TaskDelete]", err.message);
    },
  });

  const handleDelete = (taskId: number) => {
    setDeletingId(taskId);
    deleteTask.mutate({ taskId });
  };

  /* Computed stats — percentage uses tasks of the selected project */
  const { percentage, timelineEntries, taskStatusMap, allTasksByStatus } = useMemo(() => {
    const allProjects = projects ?? [];
    const effectivePid = selectedProjectId ?? allProjects[0]?.id ?? null;
    const scopedProjects = effectivePid
      ? allProjects.filter((p) => p.id === effectivePid)
      : allProjects;
    const scopedTasks = scopedProjects.flatMap((p) => p.tasks ?? []);
    const total = scopedTasks.length;
    const completed = scopedTasks.filter((t) => t.status === "completed").length;
    const pct = total > 0 ? (completed / total) * 100 : 0;

    // Build a map of taskId -> current status from ALL project data (needed for toggle)
    const allTasks = allProjects.flatMap((p) => p.tasks ?? []);
    const statusMap = new Map<number, TaskStatus>();
    for (const t of allTasks) {
      statusMap.set(t.id, t.status);
    }

    // Group tasks by status for visualization
    const tasksByStatus: Record<TaskStatus, typeof allTasks> = {
      pending: [],
      in_progress: [],
      completed: [],
      blocked: [],
    };
    for (const t of scopedTasks) {
      tasksByStatus[t.status].push(t);
    }

    const sorted = (activity?.rows ?? [])
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Deduplicate by taskId — keep only the most recent activity entry per task
    const seen = new Set<number>();
    const entries = sorted.filter((e) => {
      if (seen.has(e.taskId)) return false;
      seen.add(e.taskId);
      return true;
    }).slice(0, 50);

    return { percentage: pct, timelineEntries: entries, taskStatusMap: statusMap, allTasksByStatus: tasksByStatus };
  }, [projects, activity, selectedProjectId]);

  /* Resolve the effective project filter — default to first project if user hasn't chosen */
  const effectiveProjectId = selectedProjectId ?? projects?.[0]?.id ?? null;

  /* Filter timeline entries by project + status */
  const filteredEntries = useMemo(() => {
    let entries = timelineEntries;
    // Filter by selected project
    if (effectiveProjectId) {
      entries = entries.filter((entry) => entry.projectId === effectiveProjectId);
    }
    if (statusFilter === "all") return entries;
    return entries.filter((entry) => {
      if (statusFilter === "completed") return entry.action === "status_changed" && entry.newValue === "completed";
      if (statusFilter === "pending") return entry.action === "created" || (entry.action === "status_changed" && entry.newValue === "pending");
      if (statusFilter === "in_progress") return entry.action === "status_changed" && entry.newValue === "in_progress";
      if (statusFilter === "blocked") return entry.action === "status_changed" && entry.newValue === "blocked";
      return true;
    });
  }, [timelineEntries, statusFilter, effectiveProjectId]);

  const isLoading = isLoadingProjects || isLoadingActivity;
  const errorMsg = projError?.message ?? actError?.message;

  /* Permission: can delete if admin role or if the activity user matches the session user */
  const canDeleteTask = (entry: OrgActivityEntry) => {
    if (permissions.canDeleteTasks) return true;
    if (entry.user?.id && session?.user?.id && entry.user.id === session.user.id) return true;
    return false;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="animate-spin w-8 h-8 text-accent-primary mx-auto mb-3" />
          <p className="text-sm text-fg-secondary">{t("loadingTimeline")}</p>
        </div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400 flex items-center gap-2">
          <AlertTriangle size={16} />
          {errorMsg}
        </p>
      </div>
    );
  }

  /* No projects — prompt user to create one first */
  if (!projects || projects.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-6">
        <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
          <div className="w-20 h-20 rounded-2xl bg-accent-primary/10 flex items-center justify-center mb-6">
            <Calendar size={36} className="text-accent-primary" />
          </div>
          <h2 className="text-2xl font-bold text-fg-primary mb-2">{t("noProjectsTitle")}</h2>
          <p className="text-fg-secondary mb-6">{t("noProjectsDesc")}</p>
          <a
            href="/projects"
            className="inline-flex items-center gap-2 px-6 py-3 bg-accent-primary text-white font-semibold rounded-xl hover:bg-accent-hover hover:shadow-lg hover:shadow-accent-primary/25 transition-all hover:scale-[1.02]"
          >
            <Plus size={18} />
            {t("createOneNow")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen flex flex-col">
      {/* Header with Page Title and Toggle Buttons */}
      <div className="px-4 sm:px-6 md:px-8 py-6 border-b border-border-medium/50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-fg-primary leading-tight tracking-tight">
              {t("title")}
            </h1>
            <p className="text-sm text-fg-tertiary mt-0.5">
              {t("subtitle")}
            </p>
          </div>

          {/* Toggle Buttons - Enhanced Segmented Control */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-1 bg-white dark:bg-slate-900/50 rounded-full p-1.5 border border-slate-200 dark:border-white/[0.08] shadow-sm hover:shadow-md transition-shadow"
          >
            <button
              onClick={() => setActiveView("creation")}
              className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 ${
                activeView === "creation"
                  ? "bg-accent-primary text-white shadow-md shadow-accent-primary/20"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              {t("taskCreation")}
            </button>
            <button
              onClick={() => setActiveView("timeline")}
              className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 ${
                activeView === "timeline"
                  ? "bg-accent-primary text-white shadow-md shadow-accent-primary/20"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              {t("timeline")}
            </button>
            <button
              onClick={() => setActiveView("board")}
              className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 ${
                activeView === "board"
                  ? "bg-accent-primary text-white shadow-md shadow-accent-primary/20"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              {t("board")}
            </button>
          </motion.div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto">
        <AnimatePresence mode="wait">
          {activeView === "creation" && (
            <motion.div
              key="creation"
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.3 }}
              className="w-full"
            >
              <div className="flex flex-col w-full">
                {/* Full-width Form — fills the entire page */}
                <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 md:px-8 py-8">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  >
                    <CreateNewEntryForm
                      projects={projects ?? []}
                      onCreated={handleCreated}
                      members={orgMembers ?? []}
                      selectedProjectId={selectedProjectId ?? projects?.[0]?.id ?? null}
                      onProjectChange={setSelectedProjectId}
                      organizationId={activeOrgId}
                    />
                  </motion.div>
                </div>

                {/* Task Visualization Below Form */}
                <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 md:px-8 pb-12 border-t border-border-medium/30">
                  <div className="pt-8">
                    <h2 className="text-lg font-bold text-fg-primary mb-4 flex items-center gap-2">
                      <span className="w-1 h-5 bg-accent-primary rounded-full" />
                      {t("tasksByStatus")}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <TaskStatusCard
                        title={t("status.pending")}
                        count={allTasksByStatus.pending.length}
                        icon={Clock}
                        color="bg-slate-50 dark:bg-slate-500/10 border-slate-200 dark:border-slate-500/30 text-slate-600 dark:text-slate-300"
                      />
                      <TaskStatusCard
                        title={t("status.inProgress")}
                        count={allTasksByStatus.in_progress.length}
                        icon={Zap}
                        color="bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30 text-blue-600 dark:text-blue-300"
                      />
                      <TaskStatusCard
                        title={t("status.completed")}
                        count={allTasksByStatus.completed.length}
                        icon={CheckSquare}
                        color="bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-300"
                      />
                      <TaskStatusCard
                        title={t("status.blocked")}
                        count={allTasksByStatus.blocked.length}
                        icon={AlertCircle}
                        color="bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-300"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
          {activeView === "timeline" && (
            <motion.div
              key="timeline"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 30 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="w-full"
            >
              <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-8">
                {/* Progress bar */}
                <MasterProgressBar percentage={percentage} />

                {/* Timeline header with title and filters */}
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                  className="mb-8"
                >
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-fg-primary flex items-center gap-2">
                      <span className="w-1 h-5 bg-accent-primary rounded-full" />
                      {t("activityTimeline")}
                    </h2>
                    <span className="text-xs font-medium text-fg-quaternary">
                      {t("eventsCount", { count: filteredEntries.length })}
                    </span>
                  </div>

                  {/* Status filters */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {[
                      { value: "all", label: t("allTasks") },
                      { value: "completed", label: t("status.completed") },
                      { value: "in_progress", label: t("status.inProgress") },
                      { value: "pending", label: t("status.pending") },
                      { value: "blocked", label: t("status.blocked") },
                    ].map((filter) => (
                      <motion.button
                        key={filter.value}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setStatusFilter(filter.value as "all" | "completed" | "in_progress" | "pending" | "blocked")}
                        className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                          statusFilter === filter.value
                            ? "bg-accent-primary text-white shadow-md shadow-accent-primary/20"
                            : "bg-white dark:bg-slate-900/50 text-fg-secondary border border-slate-200 dark:border-white/[0.08] hover:text-fg-primary hover:border-slate-300 dark:hover:border-white/[0.1]"
                        }`}
                      >
                        {filter.label}
                      </motion.button>
                    ))}
                  </div>
                </motion.div>

                {/* Horizontal timeline — scrolls internally */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, delay: 0.2 }}
                  className="w-full overflow-visible"
                >
                  <MilestoneTimeline
                    entries={filteredEntries}
                    taskStatusMap={taskStatusMap}
                    canDeleteTask={canDeleteTask}
                    onToggleDone={handleToggleDone}
                    onDelete={handleDelete}
                    togglingId={togglingId}
                    deletingId={deletingId}
                  />
                </motion.div>
              </div>
            </motion.div>
          )}
          {activeView === "board" && (
            <motion.div
              key="board"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 30 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="w-full"
            >
              <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-8">
                <MasterProgressBar percentage={percentage} />

                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-bold text-fg-primary flex items-center gap-2">
                    <span className="w-1 h-5 bg-accent-primary rounded-full" />
                    {t("taskBoard")}
                  </h2>
                  {projects && projects.length > 1 && (
                    <div className="relative">
                      <select
                        value={effectivePidForBoard ?? ""}
                        onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                        className="text-sm rounded-lg bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/[0.08] text-fg-primary px-3 py-1.5 pr-7 appearance-none cursor-pointer hover:border-accent-primary/40 transition-colors"
                      >
                        {projects.map((p) => (
                          <option key={p.id} value={p.id} className="bg-bg-primary text-fg-primary">
                            {p.title}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-tertiary pointer-events-none" />
                    </div>
                  )}
                </div>

                {isLoadingBoard ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="animate-spin w-6 h-6 text-accent-primary" />
                  </div>
                ) : (
                  <TaskBoard
                    tasks={boardTasks ?? []}
                    onStatusChange={(taskId, newStatus) => {
                      setTogglingId(taskId);
                      updateStatus.mutate({ taskId, status: newStatus });
                    }}
                    onDelete={handleDelete}
                    isUpdating={updateStatus.isPending}
                    deletingId={deletingId}
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
