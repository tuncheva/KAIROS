"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useDateFormat } from "~/hooks/useDateFormat";
import {
  Calendar,
  User,
  Trash2,
  Loader2,
  Check,
  Clock,
  Zap,
  CheckSquare,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
} from "~/components/ui/icons";

type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";

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

interface MilestoneTimelineProps {
  entries: OrgActivityEntry[];
  taskStatusMap: Map<number, TaskStatus>;
  canDeleteTask: (entry: OrgActivityEntry) => boolean;
  onToggleDone: (taskId: number, currentlyDone: boolean) => void;
  onDelete: (taskId: number) => void;
  togglingId: number | null;
  deletingId: number | null;
}

function getStatusIcon(status: TaskStatus) {
  switch (status) {
    case "pending": return Clock;
    case "in_progress": return Zap;
    case "completed": return CheckSquare;
    case "blocked": return AlertCircle;
  }
}

function getStatusDotClasses(status: TaskStatus) {
  switch (status) {
    case "pending": return { bg: "bg-slate-400 dark:bg-slate-500", ring: "ring-slate-400/20 dark:ring-slate-500/20", shadow: "shadow-slate-400/30" };
    case "in_progress": return { bg: "bg-blue-500", ring: "ring-blue-500/20", shadow: "shadow-blue-500/30" };
    case "completed": return { bg: "bg-emerald-500", ring: "ring-emerald-500/20", shadow: "shadow-emerald-500/30" };
    case "blocked": return { bg: "bg-red-500", ring: "ring-red-500/20", shadow: "shadow-red-500/30" };
  }
}

function getStatusBadgeColor(status: TaskStatus) {
  switch (status) {
    case "pending": return "bg-slate-100 dark:bg-slate-500/15 text-slate-500 dark:text-slate-400";
    case "in_progress": return "bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400";
    case "completed": return "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "blocked": return "bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400";
  }
}

function getStatusLabel(status: TaskStatus, t: ReturnType<typeof useTranslations>) {
  switch (status) {
    case "pending": return t("status.pending");
    case "in_progress": return t("status.inProgress");
    case "completed": return t("status.completed");
    case "blocked": return t("status.blocked");
  }
}

const ACTION_LABEL_KEY: Record<string, string> = {
  created: "actions.created",
  updated: "actions.updated",
  deleted: "actions.deleted",
  status_changed: "actions.statusChanged",
};

function getActionLabel(action: string, t: ReturnType<typeof useTranslations>) {
  const key = ACTION_LABEL_KEY[action];
  return key ? t(key) : action.replace(/_/g, " ");
}

function getStatusValueLabel(value: string | null, t: ReturnType<typeof useTranslations>) {
  if (!value) return "";
  if (value === "in_progress") return t("status.inProgress");
  if (value === "pending") return t("status.pending");
  if (value === "completed") return t("status.completed");
  if (value === "blocked") return t("status.blocked");
  return value.replace(/_/g, " ");
}

function formatTime(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(date));
}

/* ─── Portal Tooltip ─── */
function PortalTooltip({
  anchorRef,
  children,
  position,
}: {
  anchorRef: HTMLDivElement | null;
  children: React.ReactNode;
  position: "above" | "below";
}) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!anchorRef) return;
    const rect = anchorRef.getBoundingClientRect();
    setCoords({
      x: rect.left + rect.width / 2,
      y: position === "above" ? rect.top : rect.bottom,
    });
  }, [anchorRef, position]);

  if (!coords) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{
        left: coords.x,
        top: position === "above" ? coords.y - 12 : coords.y + 12,
        transform: position === "above" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ─── Portal Card (click-to-expand, needs pointer events) ─── */
function PortalCard({
  anchorRef,
  children,
}: {
  anchorRef: HTMLDivElement | null;
  children: React.ReactNode;
}) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!anchorRef) return;
    const rect = anchorRef.getBoundingClientRect();
    setCoords({
      x: rect.left + rect.width / 2,
      y: rect.bottom + 12,
    });
  }, [anchorRef]);

  if (!coords) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed z-[9999]"
      style={{
        left: coords.x,
        top: coords.y,
        transform: "translate(-50%, 0)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ─── Main Milestone Timeline (Horizontal) ─── */
export function MilestoneTimeline({
  entries,
  taskStatusMap,
  canDeleteTask,
  onToggleDone,
  onDelete,
  togglingId,
  deletingId,
}: MilestoneTimelineProps) {
  const t = useTranslations("progress.tasks");
  const locale = useLocale();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const { formatDate: formatDatePref } = useDateFormat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const setDotRef = useCallback((taskId: number, el: HTMLDivElement | null) => {
    if (el) dotRefs.current.set(taskId, el);
    else dotRefs.current.delete(taskId);
  }, []);

  const sortedEntries = useMemo(() => {
    return [...entries].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [entries]);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -320 : 320,
      behavior: "smooth",
    });
  };

  // Close expanded card on click outside
  useEffect(() => {
    if (expandedId === null) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-milestone-card]") && !target.closest("[data-milestone-dot]")) {
        setExpandedId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expandedId]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 rounded-full bg-accent-primary/10 flex items-center justify-center mb-4">
          <Calendar size={24} className="text-accent-primary" />
        </div>
        <h3 className="text-base font-semibold text-fg-primary mb-1">{t("noMilestonesYet")}</h3>
        <p className="text-sm text-fg-tertiary max-w-xs">{t("createTasksToBuildTimeline")}</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="md:hidden space-y-4">
        {sortedEntries.map((entry) => {
          const status = taskStatusMap.get(entry.taskId) ?? "pending";
          const isCompleted = status === "completed";
          const date = new Date(entry.createdAt);
          const IconComponent = getStatusIcon(status);
          const canDelete = canDeleteTask(entry);

          return (
            <div key={entry.id} className="relative pl-8">
              <div className="absolute left-3 top-0 h-full w-px bg-border-medium/60 dark:bg-white/[0.08]" />
              <div className={`absolute left-[7px] top-1.5 h-3.5 w-3.5 rounded-full ${getStatusDotClasses(status).bg} ring-2 ${getStatusDotClasses(status).ring}`} />
              <div className="rounded-xl border border-border-medium bg-bg-elevated p-3 dark:border-white/[0.1] dark:bg-[rgb(22,22,28)]">
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <h4 className={`text-sm font-semibold ${isCompleted ? "line-through text-fg-tertiary" : "text-fg-primary"}`}>{entry.taskTitle}</h4>
                  <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${getStatusBadgeColor(status)}`}>
                    <IconComponent size={10} />
                    {getStatusLabel(status, t)}
                  </span>
                </div>
                <p className="text-xs text-fg-secondary">{entry.projectTitle}</p>
                <p className="mt-0.5 text-xs text-fg-tertiary">{t("dateTimeAt", { date: formatDatePref(date, "withYear"), time: formatTime(date, locale) })}</p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onToggleDone(entry.taskId, isCompleted)}
                    disabled={togglingId === entry.taskId}
                    className={`inline-flex h-11 items-center justify-center gap-1 rounded-lg px-3 text-xs font-semibold transition-all ${
                      isCompleted
                        ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400 dark:hover:bg-emerald-500/25"
                        : "bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20"
                    }`}
                  >
                    {togglingId === entry.taskId ? <Loader2 size={12} className="animate-spin" /> : <><Check size={12} />{isCompleted ? t("markAsPending") : t("markAsDone")}</>}
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(entry.taskId)}
                      disabled={deletingId === entry.taskId}
                      className="inline-flex h-11 items-center justify-center gap-1 rounded-lg bg-red-500 px-3 text-xs font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                    >
                      {deletingId === entry.taskId ? <Loader2 size={12} className="animate-spin" /> : <><Trash2 size={12} />{t("common.delete")}</>}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="relative hidden w-full md:block">
      {/* Scroll buttons */}
      <button
        onClick={() => scroll("left")}
        className="absolute left-0 top-[72px] -translate-y-1/2 z-30 w-9 h-9 rounded-full bg-bg-elevated border border-border-medium shadow-lg flex items-center justify-center hover:bg-bg-secondary transition-colors"
        aria-label={t("scrollLeft")}
      >
        <ChevronLeft size={16} className="text-fg-secondary" />
      </button>
      <button
        onClick={() => scroll("right")}
        className="absolute right-0 top-[72px] -translate-y-1/2 z-30 w-9 h-9 rounded-full bg-bg-elevated border border-border-medium shadow-lg flex items-center justify-center hover:bg-bg-secondary transition-colors"
        aria-label={t("scrollRight")}
      >
        <ChevronRight size={16} className="text-fg-secondary" />
      </button>

      {/* Scrollable container */}
      <div
        ref={scrollRef}
        className="overflow-x-auto mx-12 pb-8 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-transparent"
        style={{ scrollbarWidth: "thin" }}
      >
        <div
          className="relative flex items-start"
          style={{ minWidth: `${Math.max(sortedEntries.length * 140 + 60, 500)}px` }}
        >
          {/* Horizontal line */}
          <div className="absolute left-0 right-0 top-[72px] h-[2px] bg-border-medium/60 dark:bg-white/[0.08]" />
          <div className="absolute left-2 right-2 top-[71px] h-[3px] rounded-full bg-accent-primary/15" />

          {sortedEntries.map((entry, idx) => {
            const status = taskStatusMap.get(entry.taskId) ?? "pending";
            const isExpanded = expandedId === entry.taskId;
            const isHovered = hoveredId === entry.taskId;
            const dotClasses = getStatusDotClasses(status);
            const IconComponent = getStatusIcon(status);
            const date = new Date(entry.createdAt);

            return (
              <div
                key={entry.id}
                className="relative flex flex-col items-center"
                style={{ width: 140, flexShrink: 0 }}
              >
                {/* Date label ABOVE the line */}
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 + 0.1 }}
                  className="mb-4 text-center h-[42px] flex flex-col justify-end"
                >
                  <p className="text-[11px] font-semibold text-fg-tertiary leading-tight">{formatDatePref(date, "short")}</p>
                  <p className="text-[10px] text-fg-quaternary truncate max-w-[120px] leading-tight mt-0.5">{formatTime(date, locale)}</p>
                </motion.div>

                {/* The DOT */}
                <div
                  ref={(el) => setDotRef(entry.taskId, el)}
                  data-milestone-dot
                  className="relative z-20 cursor-pointer"
                  onMouseEnter={() => setHoveredId(entry.taskId)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => setExpandedId(isExpanded ? null : entry.taskId)}
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20, delay: idx * 0.03 }}
                    whileHover={{ scale: 1.4 }}
                    whileTap={{ scale: 0.9 }}
                    className={`w-[14px] h-[14px] rounded-full ${dotClasses.bg} ring-[3px] ${dotClasses.ring} shadow-sm transition-shadow duration-200 ${
                      isExpanded ? "ring-[5px] scale-[1.3]" : ""
                    } ${isHovered ? `shadow-md ${dotClasses.shadow}` : ""}`}
                  />
                </div>

                {/* Hover tooltip — rendered via portal */}
                {isHovered && !isExpanded && (
                  <PortalTooltip anchorRef={dotRefs.current.get(entry.taskId) ?? null} position="above">
                    <motion.div
                      initial={{ opacity: 0, y: 6, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.96 }}
                      transition={{ duration: 0.15 }}
                      className="w-60 pointer-events-none"
                    >
                      <div className="bg-bg-elevated dark:bg-[rgb(22,22,28)] rounded-lg border border-border-medium dark:border-white/[0.1] shadow-xl p-3.5 space-y-2">
                        <h4 className={`text-[13px] font-semibold leading-snug ${status === "completed" ? "text-fg-tertiary line-through" : "text-fg-primary"}`}>
                          {entry.taskTitle}
                        </h4>
                        <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${getStatusBadgeColor(status)}`}>
                          <IconComponent size={10} />
                          {getStatusLabel(status, t)}
                        </div>
                        <div className="space-y-1 text-[11px] text-fg-secondary border-t border-border-medium/50 dark:border-white/[0.06] pt-2">
                          <div className="flex items-center gap-1.5">
                            <FolderOpen size={10} className="text-fg-quaternary shrink-0" />
                            <span className="truncate">{entry.projectTitle}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Calendar size={10} className="text-fg-quaternary shrink-0" />
                            <span>{t("dateTimeAt", { date: formatDatePref(date, "withYear"), time: formatTime(date, locale) })}</span>
                          </div>
                          {entry.user && (
                            <div className="flex items-center gap-1.5">
                              <User size={10} className="text-fg-quaternary shrink-0" />
                              <span>{t("byUser", { name: entry.user.name ?? t("unknown") })}</span>
                            </div>
                          )}
                          {entry.assignee && (
                            <div className="flex items-center gap-1.5">
                              <div className="w-4 h-4 rounded-full overflow-hidden bg-accent-primary/20 shrink-0">
                                {entry.assignee.image ? (
                                  <Image src={entry.assignee.image} alt={entry.assignee.name ?? ""} width={16} height={16} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-accent-primary/30">
                                    <User size={8} className="text-accent-primary" />
                                  </div>
                                )}
                              </div>
                              <span>{t("assignedTo", { name: entry.assignee.name ?? t("unknown") })}</span>
                            </div>
                          )}
                          {entry.action && (
                            <p className="text-[10px] text-fg-quaternary italic mt-0.5">
                              {getStatusValueLabel(entry.newValue, t)
                                ? t("lastActionWithValue", {
                                    action: getActionLabel(entry.action, t),
                                    value: getStatusValueLabel(entry.newValue, t),
                                  })
                                : t("lastActionOnly", {
                                    action: getActionLabel(entry.action, t),
                                  })}
                            </p>
                          )}
                        </div>
                        <div className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-bg-elevated dark:bg-[rgb(22,22,28)] border-r border-b border-border-medium dark:border-white/[0.1] rotate-45" />
                      </div>
                    </motion.div>
                  </PortalTooltip>
                )}

                {/* Task title BELOW the line */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03 + 0.15 }}
                  className="mt-4 text-center px-1"
                >
                  <p className={`text-[11px] font-medium leading-tight truncate max-w-[120px] ${status === "completed" ? "text-fg-quaternary line-through" : "text-fg-secondary"}`}>
                    {entry.taskTitle}
                  </p>
                </motion.div>

                {/* Expanded card — rendered via portal */}
                <AnimatePresence>
                  {isExpanded && (
                    <PortalCard anchorRef={dotRefs.current.get(entry.taskId) ?? null}>
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.96 }}
                        transition={{ duration: 0.2 }}
                        className="w-72"
                        data-milestone-card
                      >
                        <ExpandedMilestoneCard
                          entry={entry}
                          status={status}
                          isToggling={togglingId === entry.taskId}
                          isDeleting={deletingId === entry.taskId}
                          canDelete={canDeleteTask(entry)}
                          onToggleDone={onToggleDone}
                          onDelete={onDelete}
                        />
                      </motion.div>
                    </PortalCard>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {/* End marker */}
          <div className="relative flex flex-col items-center" style={{ width: 60, flexShrink: 0 }}>
            <div className="h-[42px] mb-4" />
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: sortedEntries.length * 0.03 }}
              className="w-[10px] h-[10px] rounded-full bg-accent-primary/25 ring-[3px] ring-accent-primary/10 z-20"
            />
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: sortedEntries.length * 0.03 + 0.1 }}
              className="mt-4 text-[10px] font-medium text-fg-quaternary"
            >
              {t("now")}
            </motion.p>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

/* ─── Expanded card (shown on dot click) ─── */
function ExpandedMilestoneCard({
  entry, status, isToggling, isDeleting, canDelete, onToggleDone, onDelete,
}: {
  entry: OrgActivityEntry; status: TaskStatus; isToggling: boolean; isDeleting: boolean;
  canDelete: boolean; onToggleDone: (taskId: number, currentlyDone: boolean) => void;
  onDelete: (taskId: number) => void;
}) {
  const t = useTranslations("progress.tasks");
  const locale = useLocale();
  const isCompleted = status === "completed";
  const { formatDate: formatDatePref } = useDateFormat();
  const date = new Date(entry.createdAt);
  const IconComponent = getStatusIcon(status);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="bg-bg-elevated dark:bg-[rgb(22,22,28)] rounded-xl border border-border-medium dark:border-white/[0.1] shadow-2xl p-4 space-y-3 relative">
      {/* Arrow pointing up */}
      <div className="absolute -top-[5px] left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-bg-elevated dark:bg-[rgb(22,22,28)] border-l border-t border-border-medium dark:border-white/[0.1] rotate-45" />

      <div className="flex items-start justify-between gap-2">
        <h4 className={`text-[13px] font-semibold leading-snug flex-1 ${isCompleted ? "text-fg-tertiary line-through" : "text-fg-primary"}`}>
          {entry.taskTitle}
        </h4>
        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase shrink-0 ${getStatusBadgeColor(status)}`}>
          <IconComponent size={10} />
          {getStatusLabel(status, t)}
        </div>
      </div>

      <div className="space-y-1.5 text-xs text-fg-secondary border-t border-border-medium/40 dark:border-white/[0.06] pt-2">
        <div className="flex items-center gap-1.5">
          <FolderOpen size={11} className="text-fg-quaternary shrink-0" />
          <span className="font-medium">{entry.projectTitle}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Calendar size={11} className="text-fg-quaternary shrink-0" />
          <span>{t("dateTimeAt", { date: formatDatePref(date, "withYear"), time: formatTime(date, locale) })}</span>
        </div>
        {entry.user && (
          <div className="flex items-center gap-1.5">
            <User size={11} className="text-fg-quaternary shrink-0" />
            <span>{t("createdBy", { name: entry.user.name ?? t("unknown") })}</span>
          </div>
        )}
        {entry.assignee && (
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full overflow-hidden bg-accent-primary/20 shrink-0">
              {entry.assignee.image ? (
                <Image src={entry.assignee.image} alt={entry.assignee.name ?? ""} width={20} height={20} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-accent-primary/30">
                  <User size={10} className="text-accent-primary" />
                </div>
              )}
            </div>
            <span>{t("assignedTo", { name: entry.assignee.name ?? t("unknown") })}</span>
          </div>
        )}
        {entry.action && (
          <p className="text-[10px] text-fg-quaternary italic">
            {getStatusValueLabel(entry.newValue, t)
              ? t("lastActionWithValue", {
                  action: getActionLabel(entry.action, t),
                  value: getStatusValueLabel(entry.newValue, t),
                })
              : t("lastActionOnly", {
                  action: getActionLabel(entry.action, t),
                })}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border-medium/40 dark:border-white/[0.06] pt-3">
        <button
          type="button"
          onClick={() => onToggleDone(entry.taskId, isCompleted)}
          disabled={isToggling}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            isCompleted
              ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/25"
              : "bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20"
          }`}
        >
          {isToggling ? <Loader2 size={12} className="animate-spin" /> : <><Check size={12} />{isCompleted ? t("markAsPending") : t("markAsDone")}</>}
        </button>
        {canDelete && (
          <>
            {confirmDelete && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setConfirmDelete(false)}>
                <div className="bg-bg-secondary rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in fade-in slide-in-from-bottom-4" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-lg font-bold text-fg-primary mb-2">{t("deleteTaskTitle")}</h3>
                  <p className="text-sm text-fg-secondary mb-6">{t("deleteTaskConfirm")}</p>
                  <div className="flex items-center justify-end gap-3">
                    <button type="button" onClick={() => setConfirmDelete(false)}
                      className="px-4 py-2 text-sm font-medium text-fg-secondary hover:bg-bg-surface rounded-lg transition-colors"
                    >
                      {t("common.cancel")}
                    </button>
                    <button type="button" onClick={() => { onDelete(entry.taskId); setConfirmDelete(false); }} disabled={isDeleting}
                      className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isDeleting ? t("deleting") : t("common.delete")}
                    </button>
                  </div>
                </div>
              </div>
            )}
            <button type="button" onClick={() => setConfirmDelete(true)}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-bg-tertiary/50 text-fg-tertiary hover:bg-red-50 dark:hover:bg-red-500/15 hover:text-red-500 dark:hover:text-red-400 transition-all"
              title={t("deleteTask")}
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
