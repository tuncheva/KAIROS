"use client";

import { useState, useEffect, useMemo, useRef } from"react";
import { Check, ChevronDown, Clock, User, CheckCircle2 } from"lucide-react";
import Image from"next/image";
import { useLocale, useTranslations } from"next-intl";

interface Task {
 id: number;
 title: string;
 description?: string | null;
 status:"pending" |"in_progress" |"completed" |"blocked";
 priority:"low" |"medium" |"high" |"urgent";
 dueDate?: Date | null;
 assignedTo?: {
 id: string;
 name: string | null;
 image: string | null;
 } | null;
 completedAt?: Date | null;
 completionNote?: string | null;
 orderIndex: number;
 createdBy?: {
 id: string;
 name: string | null;
 image: string | null;
 } | null;
 completedBy?: {
 id: string;
 name: string | null;
 image: string | null;
 } | null;
 lastEditedBy?: {
 id: string;
 name: string | null;
 image: string | null;
 } | null;
 lastEditedAt?: Date | null;
}

interface InteractiveTimelineProps {
 tasks: Task[];
 onTaskStatusChange: (taskId: number, newStatus: Task["status"]) => void;
 onTaskUpdate?: (taskId: number, patch: { title?: string; description?: string; assignedToId?: string | null; dueDate?: Date | null }) => void;
 onTaskCompletionNoteSave?: (taskId: number, completionNote: string | null) => void;
 onTaskDiscard?: (taskId: number) => void;
 canEditCompletionNote?: (task: Task) => boolean;
 canDiscardTask?: (task: Task) => boolean;
 availableUsers?: Array<{ id: string; name: string | null; image: string | null }>;
 isReadOnly?: boolean;
 projectTitle?: string;
}

export function InteractiveTimeline({
 tasks,
 onTaskStatusChange,
 onTaskUpdate,
 onTaskCompletionNoteSave,
 onTaskDiscard,
 canEditCompletionNote,
 canDiscardTask,
 availableUsers = [],
 isReadOnly = false,
 projectTitle
}: InteractiveTimelineProps) {
 const t = useTranslations("create");
 const locale = useLocale();
 const [mounted, setMounted] = useState(false);
 const [optimisticTasks, setOptimisticTasks] = useState<Task[]>(tasks);
 const [animatedPercentage, setAnimatedPercentage] = useState(0);
 const [hoveredTaskId, setHoveredTaskId] = useState<number | null>(null);
 const [hoverAssignTaskId, setHoverAssignTaskId] = useState<number | null>(null);
 const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
 const [highlightedTaskId, setHighlightedTaskId] = useState<number | null>(null);

 const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
 const [editTitle, setEditTitle] = useState<string>("");
 const [editDescription, setEditDescription] = useState<string>("");
 const [editAssignedToId, setEditAssignedToId] = useState<string>("unassigned");
 const [editDueDate, setEditDueDate] = useState<string>("");

 const [editingCompletionNoteTaskId, setEditingCompletionNoteTaskId] = useState<number | null>(null);
 const [editCompletionNote, setEditCompletionNote] = useState<string>("");
 
 const taskRefs = useRef<Map<number, HTMLDivElement>>(new Map());

 const rafRef = useRef<number | null>(null);
 const animatedPercentageRef = useRef(0);
 
 useEffect(() => {
 setMounted(true);
 }, []);

 useEffect(() => {
 setOptimisticTasks(tasks);
 }, [tasks]);

 useEffect(() => {
 const targetPercentage = optimisticTasks.length === 0 
 ? 0 
 : (optimisticTasks.filter(t => t.status ==="completed").length / optimisticTasks.length) * 100;

 if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

 const startPercentage = animatedPercentageRef.current;
 const duration = 400;

 const start = performance.now();

 const tick = (now: number) => {
 const elapsed = now - start;
 const t = Math.min(elapsed / duration, 1);
 const current = startPercentage + (targetPercentage - startPercentage) * t;
 animatedPercentageRef.current = current;
 setAnimatedPercentage(current);

 if (t < 1) {
 rafRef.current = requestAnimationFrame(tick);
 } else {
 rafRef.current = null;
 }
 };

 rafRef.current = requestAnimationFrame(tick);

 return () => {
 if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
 rafRef.current = null;
 };
 }, [optimisticTasks]);

 const sortedTasks = useMemo(() => {
 return [...optimisticTasks].sort((a, b) => {
 if (a.orderIndex !== b.orderIndex) {
 return a.orderIndex - b.orderIndex;
 }
 if (a.dueDate && b.dueDate) {
 return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
 }
 return 0;
 });
 }, [optimisticTasks]);

 const completedCount = optimisticTasks.filter(t => t.status ==="completed").length;

 const formatShortDate = (date: Date) => {
 return new Intl.DateTimeFormat(locale, { month:"short", day:"numeric" }).format(date);
 };

 const formatShortDateTime = (date: Date) => {
 return new Intl.DateTimeFormat(locale, {
 month:"short",
 day:"numeric",
 hour:"numeric",
 minute:"2-digit",
 }).format(date);
 };

 const handleCheckboxToggle = (task: Task) => {
 if (isReadOnly || task.id < 0) return;

 const newStatus: Task["status"] =
 task.status ==="completed" ?"pending" :"completed";

 // Call the mutation immediately for instant feedback
 onTaskStatusChange(task.id, newStatus);

 // Update optimistic state
 setOptimisticTasks((prev) =>
 prev.map(t =>
 t.id === task.id
 ? { ...t, status: newStatus, completedAt: newStatus ==="completed" ? new Date() : null }
 : t
 )
 );

 // If marking as complete, highlight the next incomplete task (no scroll)
 if (newStatus ==="completed") {
 const sortedUpdated = [...optimisticTasks].sort((a, b) => {
 if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
 if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
 return 0;
 });

 const currentIndex = sortedUpdated.findIndex(t => t.id === task.id);
 const nextIncomplete = sortedUpdated.find((t, idx) => idx > currentIndex && t.status !=="completed");

 if (nextIncomplete) {
 setHighlightedTaskId(nextIncomplete.id);
 setTimeout(() => setHighlightedTaskId(null), 1500);
 }
 }
 };

 if (!mounted) {
 return (
 <div className="w-full h-full overflow-y-auto bg-bg-primary">
 <div className="animate-pulse">
 <div className="h-8 bg-bg-tertiary rounded-[12px] mx-4 mb-4"></div>
 <div className="h-4 bg-bg-tertiary rounded-[12px] mx-4 mb-8"></div>
 <div className="h-32 bg-bg-tertiary rounded-[12px] mx-4 mb-4"></div>
 <div className="h-32 bg-bg-tertiary rounded-[12px] mx-4"></div>
 </div>
 </div>
 );
 }

 if (sortedTasks.length === 0) {
 return (
 <div className="flex-1 flex items-center justify-center min-h-[500px]">
 <div className="text-center max-w-md">
 <div className="w-[60px] h-[60px] rounded-full bg-bg-tertiary flex items-center justify-center mx-auto mb-4">
 <Clock size={26} className="text-fg-secondary" strokeWidth={2.2} />
 </div>
 <h3 className="text-[17px] font-[590] text-fg-primary mb-2">
 {t("timeline.emptyTitle")}
 </h3>
 <p className="text-[15px] leading-[1.4667] tracking-[-0.01em] text-fg-tertiary">
 {t("timeline.emptyDesc")}
 </p>
 </div>
 </div>
 );
 }

 return (
 <div className="w-full h-full overflow-y-auto bg-bg-primary">
 <div className="max-w-full px-4">
 {/* Header */}
 <div className="pt-8 pb-6">
 <h1 className="text-[34px] font-[700] leading-[1.1] tracking-[-0.022em] text-fg-primary mb-2">
 {projectTitle ?? t("timeline.title")}
 </h1>
 <p className="text-[15px] leading-[1.4667] tracking-[-0.01em] text-fg-tertiary">
 {t("timeline.progressLine", { count: sortedTasks.length })}
 </p>
 </div>

 {/* Progress Section */}
 <div className="mb-8">
 <div className="bg-bg-secondary rounded-[10px] p-4 sm:p-6 border border-slate-200 dark:border-white/[0.06] shadow-sm dark:shadow-none">
 <div className="flex items-center justify-between mb-4">
 <div>
 <div className="text-[17px] leading-[1.235] tracking-[-0.016em] text-fg-primary font-[590] mb-1">
 {t("timeline.projectProgress")}
 </div>
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-secondary">
 {t("timeline.completedLine", { completed: completedCount, total: sortedTasks.length })}
 </div>
 </div>
 <div className="text-right">
 <div className="text-[34px] font-[700] leading-[1.1] tracking-[-0.022em] text-accent-primary mb-1">
 {Math.round(animatedPercentage)}%
 </div>
 </div>
 </div>

 <div className="relative w-full h-[6px] bg-bg-tertiary rounded-full overflow-hidden">
 <div 
 className="absolute top-0 left-0 h-full rounded-full transition-all duration-300"
 style={{ 
 width: `${animatedPercentage}%`,
 background: animatedPercentage === 0 
 ?'transparent'
 :'linear-gradient(90deg, rgb(var(--accent-primary)), rgb(var(--accent-secondary)))',
 }}
 />
 </div>
 </div>
 </div>

 {/* Tasks List */}
 <div className="space-y-2">
 <h2 className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-secondary mb-3 px-1 uppercase tracking-wide">
 {t("timeline.tasksCount", { count: sortedTasks.length })}
 </h2>
 
 <div className="space-y-2">
 {sortedTasks.map((task) => {
 const isCompleted = task.status ==="completed";
 const isExpanded = expandedTaskId === task.id;
 const isOverdue = !!task.dueDate && !isCompleted && new Date(task.dueDate).getTime() < Date.now();
 const isHighlighted = highlightedTaskId === task.id;
 
 return (
 <div 
 key={task.id}
 ref={(el) => {
 if (el) taskRefs.current.set(task.id, el);
 else taskRefs.current.delete(task.id);
 }}
 className={`bg-bg-secondary rounded-[10px] overflow-hidden border border-slate-200 dark:border-white/[0.06] shadow-sm dark:shadow-none ${isHighlighted ?"ring-2 ring-accent-primary/50" :""}`}
 onMouseEnter={() => setHoveredTaskId(task.id)}
 onMouseLeave={() => { setHoveredTaskId(null); setHoverAssignTaskId(null); }}
 >
 <div 
 role="button"
 tabIndex={0}
 onClick={() => setExpandedTaskId((prev) => (prev === task.id ? null : task.id))}
 onKeyDown={(e) => {
 if (e.key ==="Enter" || e.key ==="") {
 e.preventDefault();
 setExpandedTaskId((prev) => (prev === task.id ? null : task.id));
 }
 }}
 className="w-full flex items-center justify-between pl-4 pr-[18px] py-[11px] active:bg-bg-tertiary transition-colors"
 >
 <div className="flex items-center gap-3 flex-1 min-w-0">
 <button
 onClick={(e) => {
 e.stopPropagation();
 handleCheckboxToggle(task);
 }}
 disabled={isReadOnly || task.id < 0}
 className={`w-[30px] h-[30px] rounded-full flex items-center justify-center transition-all ${
 isCompleted
 ?"text-accent-primary/15"
 :"bg-bg-tertiary"
 } ${isReadOnly || task.id < 0 ?"cursor-not-allowed opacity-50" :"cursor-pointer"}`}
 aria-label={isCompleted ? t("timeline.markIncomplete") : t("timeline.markComplete")}
 >
 {isCompleted && (
 <Check size={18} className="text-accent-primary" strokeWidth={3} />
 )}
 </button>
 
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 mb-1">
 <h4 className={`text-[17px] leading-[1.235] tracking-[-0.016em] text-fg-primary font-[590] truncate ${
 isCompleted ?"line-through text-fg-tertiary" :""
 }`}>
 {task.title}
 </h4>
 
 <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${
 task.priority ==="urgent" 
 ?"bg-error/10 text-error"
 : task.priority ==="high"
 ?"bg-orange-500/10 text-orange-500"
 : task.priority ==="medium"
 ?"bg-warning/10 text-warning"
 :"bg-accent-primary/10 text-accent-primary"
 }`}>
 {t(
 task.priority ==="urgent"
 ?"taskForm.priorityUrgent"
 : task.priority ==="high"
 ?"taskForm.priorityHigh"
 : task.priority ==="medium"
 ?"taskForm.priorityMedium"
 :"taskForm.priorityLow",
 )}
 </span>
 </div>
 
 <div className="flex items-center gap-2 text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-secondary">
 {task.dueDate && (
 <div className="flex items-center gap-1">
 <Clock size={12} className={isOverdue ?"text-error" :"text-accent-primary"} strokeWidth={2.2} />
 <span>{formatShortDate(new Date(task.dueDate))}</span>
 {isOverdue && (
 <span className="text-error font-semibold">• {t("timeline.overdue")}</span>
 )}
 </div>
 )}
 
 {task.assignedTo && (
 <div className="flex items-center gap-1">
 <span>•</span>
 <User size={12} className="text-accent-primary" strokeWidth={2.2} />
 <span>{task.assignedTo.name ?? t("team.unknownUser")}</span>
 </div>
 )}
 </div>
 </div>
 </div>

 {/* Hover assign button */}
 <div className="flex items-center gap-2">
 {!isReadOnly && onTaskUpdate && hoveredTaskId === task.id && task.id >= 0 && (
 <div className="relative">
 <button
 type="button"
 onClick={(e) => {
 e.stopPropagation();
 setHoverAssignTaskId(prev => prev === task.id ? null : task.id);
 }}
 className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 transition-all"
 >
 <User size={12} strokeWidth={2.5} />
  <span>{task.assignedTo?.name?.split(" ")[0] ?? t("timeline.assign")}</span>
 </button>

 {hoverAssignTaskId === task.id && (
 <div
 className="absolute right-0 top-full mt-1 z-30 min-w-[200px] rounded-xl border border-slate-200 dark:border-white/[0.1] bg-bg-elevated dark:bg-[rgb(14,14,18)] shadow-xl shadow-black/10 dark:shadow-black/30 overflow-hidden"
 onClick={(e) => e.stopPropagation()}
 >
 <div className="max-h-[200px] overflow-y-auto py-1">
 <button
 type="button"
 onClick={() => {
 onTaskUpdate(task.id, { assignedToId: null });
 setHoverAssignTaskId(null);
 }}
 className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-accent-primary/10 transition-colors ${!task.assignedTo ? "bg-accent-primary/5" : ""}`}
 >
 <div className="w-6 h-6 rounded-full bg-bg-tertiary/50 flex items-center justify-center flex-shrink-0">
 <User size={11} className="text-fg-quaternary" />
 </div>
  <span className="text-[12px] text-fg-secondary">{t("taskForm.unassigned")}</span>
 </button>
 {availableUsers.map((u) => (
 <button
 key={u.id}
 type="button"
 onClick={() => {
 onTaskUpdate(task.id, { assignedToId: u.id });
 setHoverAssignTaskId(null);
 }}
 className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-accent-primary/10 transition-colors ${task.assignedTo?.id === u.id ? "bg-accent-primary/5" : ""}`}
 >
 <div className="w-6 h-6 rounded-full overflow-hidden bg-accent-primary/20 flex-shrink-0">
 {u.image ? (
 <Image src={u.image} alt={u.name ?? ""} width={24} height={24} className="w-full h-full object-cover" />
 ) : (
 <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent-primary to-accent-secondary">
 <User size={10} className="text-white" />
 </div>
 )}
 </div>
 <div className="flex-1 min-w-0">
  <p className="text-[12px] text-fg-primary font-medium truncate">{u.name ?? t("team.unknownUser")}</p>
 </div>
 {task.assignedTo?.id === u.id && (
 <CheckCircle2 size={12} className="text-accent-primary flex-shrink-0" />
 )}
 </button>
 ))}
 </div>
 </div>
 )}
 </div>
 )}
 
 <ChevronDown 
 size={20} 
 className={`text-fg-tertiary transition-transform ${isExpanded ?"rotate-180" :""}`}
 strokeWidth={2.5}
 />
 </div>
 </div>

 {/* Expanded Details */}
 {isExpanded && (
 <div className="px-4 pb-4 border-t border-slate-100 dark:border-white/[0.04] pt-4">
 {task.description && (
 <p className="text-[15px] leading-[1.4667] tracking-[-0.01em] text-fg-secondary mb-4">
 {task.description}
 </p>
 )}

 {!isReadOnly && task.id >= 0 && onTaskUpdate && (
 <div className="p-3 rounded-lg bg-bg-primary border border-border-light/20">
 <div className="flex items-center justify-between gap-3">
  <div className="text-[12px] uppercase tracking-wide text-fg-secondary">{t("timeline.adminEdit")}</div>
 <div className="flex items-center gap-2">
 {onTaskDiscard && (canDiscardTask?.(task) ?? false) && (
 <button
 type="button"
 className="px-2 py-1 rounded-md text-[12px] bg-error/10 text-error border border-border-light/20 hover:opacity-95"
 onClick={(e) => {
 e.stopPropagation();
 onTaskDiscard(task.id);
 }}
 >
  {t("timeline.discard")}
 </button>
 )}
 <button
 type="button"
 className="px-2 py-1 rounded-md text-[12px] bg-bg-secondary text-fg-primary border border-border-light/20 hover:opacity-95"
 onClick={(e) => {
 e.stopPropagation();
 const next = editingTaskId === task.id ? null : task.id;
 setEditingTaskId(next);
 if (next === task.id) {
 setEditTitle(task.title);
 setEditDescription(task.description ??"");
 setEditAssignedToId(task.assignedTo?.id ??"unassigned");
 setEditDueDate(task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) :"");
 }
 }}
 >
  {editingTaskId === task.id ? t("timeline.close") : t("timeline.edit")}
 </button>
 </div>
 </div>

 {editingTaskId === task.id && (
 <div className="mt-3 space-y-2">
 <div className="space-y-1">
  <label className="text-[12px] text-fg-secondary">{t("timeline.editTitle")}</label>
 <input
 value={editTitle}
 onChange={(e) => setEditTitle(e.target.value)}
 className="w-full rounded-lg px-3 py-2 text-[13px] outline-none bg-bg-secondary text-fg-primary border border-border-light/20 focus:border-accent-primary/40"
 />
 </div>

 <div className="space-y-1">
  <label className="text-[12px] text-fg-secondary">{t("common.description")}</label>
 <textarea
 value={editDescription}
 onChange={(e) => setEditDescription(e.target.value)}
 rows={3}
 className="w-full rounded-lg px-3 py-2 text-[13px] outline-none bg-bg-secondary text-fg-primary border border-border-light/20 focus:border-accent-primary/40"
 />
 </div>

 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
 <div className="space-y-1">
  <label className="text-[12px] text-fg-secondary">{t("taskForm.assignTo")}</label>
 <select
 value={editAssignedToId}
 onChange={(e) => setEditAssignedToId(e.target.value)}
 className="w-full rounded-lg px-3 py-2 text-[13px] outline-none bg-bg-secondary text-fg-primary border border-border-light/20 focus:border-accent-primary/40"
 >
  <option value="unassigned">{t("taskForm.unassigned")}</option>
 {availableUsers.map((u) => (
 <option key={u.id} value={u.id}>
 {u.name ?? u.id}
 </option>
 ))}
 </select>
 </div>

 <div className="space-y-1">
  <label className="text-[12px] text-fg-secondary">{t("taskForm.dueDate")}</label>
 <input
 type="date"
 value={editDueDate}
 onChange={(e) => setEditDueDate(e.target.value)}
 className="w-full rounded-lg px-3 py-2 text-[13px] outline-none bg-bg-secondary text-fg-primary border border-border-light/20 focus:border-accent-primary/40"
 />
 </div>
 </div>

 <div className="flex items-center gap-2 pt-1">
 <button
 type="button"
 className="px-3 py-2 rounded-lg text-[13px] font-medium bg-accent-primary text-white hover:opacity-95"
 onClick={(e) => {
 e.stopPropagation();
 onTaskUpdate(task.id, {
 title: editTitle.trim() || undefined,
 description: editDescription,
 assignedToId: editAssignedToId ==="unassigned" ? null : editAssignedToId,
 dueDate: editDueDate ? new Date(`${editDueDate}T00:00:00.000Z`) : null,
 });
 setEditingTaskId(null);
 }}
 >
  {t("timeline.save")}
 </button>
 <button
 type="button"
 className="px-3 py-2 rounded-lg text-[13px] font-medium bg-bg-secondary text-fg-primary border border-border-light/20 hover:opacity-95"
 onClick={(e) => {
 e.stopPropagation();
 setEditingTaskId(null);
 }}
 >
  {t("common.cancel")}
 </button>
 </div>
 </div>
 )}
 </div>
 )}

 <div className="space-y-3">
 {task.createdBy && (
 <div className="flex items-center gap-2 text-[13px] text-fg-secondary">
 <span className="opacity-70">{t("timeline.createdBy")}</span>
 <div className="flex items-center gap-1.5">
 {task.createdBy.image ? (
 <Image 
 src={task.createdBy.image} 
  alt={task.createdBy.name ?? t("team.unknownUser")}
 width={20}
 height={20}
 className="rounded-full"
 />
 ) : (
 <div className="w-5 h-5 rounded-full bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center">
 <span className="text-[11px] font-[590] text-white">
 {task.createdBy.name?.[0]?.toUpperCase() ??"?"}
 </span>
 </div>
 )}
 <span className="font-semibold">{task.createdBy.name ?? t("team.unknownUser")}</span>
 </div>
 </div>
 )}

 {task.lastEditedBy && task.lastEditedAt && (
 <div className="flex items-center gap-2 text-[13px] text-warning">
 <Clock size={12} strokeWidth={2.2} />
 <span className="opacity-70">{t("timeline.lastModified")}</span>
 <div className="flex items-center gap-1.5">
 {task.lastEditedBy.image ? (
 <Image 
 src={task.lastEditedBy.image} 
  alt={task.lastEditedBy.name ?? t("team.unknownUser")}
 width={20}
 height={20}
 className="rounded-full"
 />
 ) : (
 <div className="w-5 h-5 rounded-full bg-gradient-to-br from-warning to-warning/80 flex items-center justify-center">
 <span className="text-[11px] font-[590] text-white">
 {task.lastEditedBy.name?.[0]?.toUpperCase() ??"?"}
 </span>
 </div>
 )}
 <span className="font-semibold">{task.lastEditedBy.name ?? t("team.unknownUser")}</span>
 <span className="opacity-60">•</span>
 <span className="opacity-70">
 {formatShortDateTime(new Date(task.lastEditedAt))}
 </span>
 </div>
 </div>
 )}

 {isCompleted && task.completedBy && (
 <div className="flex items-center gap-2 text-[13px] text-success">
 <CheckCircle2 size={12} strokeWidth={2.2} />
 <span className="opacity-70">{t("timeline.completedBy")}</span>
 <div className="flex items-center gap-1.5">
 {task.completedBy.image ? (
 <Image
 src={task.completedBy.image}
  alt={task.completedBy.name ?? t("team.unknownUser")}
 width={20}
 height={20}
 className="rounded-full"
 />
 ) : (
 <div className="w-5 h-5 rounded-full bg-gradient-to-br from-success to-success/80 flex items-center justify-center">
 <span className="text-[11px] font-[590] text-white">
 {task.completedBy.name?.[0]?.toUpperCase() ??"?"}
 </span>
 </div>
 )}
 <span className="font-semibold">{task.completedBy.name ?? t("team.unknownUser")}</span>
 </div>
 </div>
 )}

 {(
 // show the completion note section inside the expanded task panel
 // (only meaningful when completed, but visible here as requested)
 isCompleted
 ) && (
 <div className="mt-2 p-3 rounded-lg bg-bg-primary border border-border-light/20">
 <div className="flex items-center justify-between gap-3 mb-2">
  <div className="text-[12px] uppercase tracking-wide text-fg-secondary">{t("timeline.completionNote")}</div>
 {!isReadOnly && onTaskCompletionNoteSave && (canEditCompletionNote?.(task) ?? false) && (
 <button
 type="button"
 className="px-2 py-1 rounded-md text-[12px] bg-bg-secondary text-fg-primary border border-border-light/20 hover:opacity-95"
 onClick={(e) => {
 e.stopPropagation();
 const next = editingCompletionNoteTaskId === task.id ? null : task.id;
 setEditingCompletionNoteTaskId(next);
 if (next === task.id) {
 setEditCompletionNote(task.completionNote ??"");
 }
 }}
 >
  {editingCompletionNoteTaskId === task.id ? t("timeline.close") : t("timeline.edit")}
 </button>
 )}
 </div>

 {editingCompletionNoteTaskId === task.id ? (
 <div className="space-y-2">
 <textarea
 value={editCompletionNote}
 onChange={(e) => setEditCompletionNote(e.target.value)}
 rows={3}
  placeholder={t("timeline.completionNotePlaceholder")}
 className="w-full rounded-lg px-3 py-2 text-[13px] outline-none bg-bg-secondary text-fg-primary border border-border-light/20 focus:border-accent-primary/40"
 />
 <div className="flex items-center gap-2">
 <button
 type="button"
 className="px-3 py-2 rounded-lg text-[13px] font-medium bg-accent-primary text-white hover:opacity-95"
 onClick={(e) => {
 e.stopPropagation();
 if (!onTaskCompletionNoteSave) return;
 onTaskCompletionNoteSave(
 task.id,
 editCompletionNote.trim() ? editCompletionNote.trim() : null,
 );
 setEditingCompletionNoteTaskId(null);
 }}
 >
  {t("timeline.saveNote")}
 </button>
 <button
 type="button"
 className="px-3 py-2 rounded-lg text-[13px] font-medium bg-bg-secondary text-fg-primary border border-border-light/20 hover:opacity-95"
 onClick={(e) => {
 e.stopPropagation();
 setEditingCompletionNoteTaskId(null);
 }}
 >
  {t("common.cancel")}
 </button>
 </div>
 </div>
 ) : (
 <div className="text-[13px] text-fg-secondary whitespace-pre-wrap">
 {task.completionNote?.trim() ? task.completionNote :"—"}
 </div>
 )}
 </div>
 )}
 
 {/* Mark Complete/Incomplete Button */}
 {!isReadOnly && task.id >= 0 && (
 <button
 onClick={(e) => {
 e.stopPropagation();
 handleCheckboxToggle(task);
 }}
 className={`mt-2 py-2 px-4 rounded-lg text-[13px] font-medium tracking-tight transition-all duration-300 flex items-center gap-2 w-fit ${
 isCompleted
 ?"bg-bg-tertiary text-fg-tertiary hover:bg-bg-tertiary/80"
 :"bg-accent-primary text-white hover:bg-accent-primary/90"
 }`}
 >
 <Check size={14} strokeWidth={3} />
 <span>{isCompleted ? t("timeline.markIncomplete") : t("timeline.markComplete")}</span>
 </button>
 )}
 </div>
 </div>
 )}
 </div>
 );
 })}
 </div>
 </div>

 {/* Bottom Spacing */}
 <div className="h-8" />
 </div>
 </div>
 );
}
