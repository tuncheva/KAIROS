"use client";

import { useState, useMemo, useCallback } from "react";
import { api } from "~/trpc/react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  Zap,
  FolderOpen,
  X,
  StickyNote,
  Filter,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { useLocale, useTranslations } from "next-intl";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type CalendarTask = {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | string | null;
  projectId: number;
  projectTitle: string | null;
};

type CalendarEvent = {
  id: number;
  title: string;
  eventDate: Date | string;
  description: string;
};

type CalendarNote = {
  id: number;
  title: string | null;
  calendarDate: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  passwordHash: string | null;
  notebookId: number | null;
  createdById: string;
};

type CalendarData = {
  tasks: CalendarTask[];
  events: CalendarEvent[];
  notes: CalendarNote[];
};

type CalendarItem =
  | { kind: "task"; id: number; title: string; status: string; priority: string; projectTitle: string | null; date: Date }
  | { kind: "event"; id: number; title: string; description?: string; date: Date }
  | { kind: "note"; id: number; title: string; locked: boolean; date: Date };

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function startOfDayLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDayLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Monday-start week in local time.
function startOfWeekMondayLocal(d: Date) {
  const x = startOfDayLocal(d);
  // JS: Sun=0..Sat=6. Convert to Monday=0..Sunday=6.
  const mondayIndex = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - mondayIndex);
  return x;
}
function endOfWeekMondayLocal(d: Date) {
  const x = startOfWeekMondayLocal(d);
  x.setDate(x.getDate() + 6);
  x.setHours(23, 59, 59, 999);
  return x;
}

const WEEKDAYS = ["weekdaySun", "weekdayMon", "weekdayTue", "weekdayWed", "weekdayThu", "weekdayFri", "weekdaySat"] as const;
const STATUS_LABEL_KEYS: Record<string, string> = {
  pending: "statusPending",
  in_progress: "statusInProgress",
  blocked: "statusBlocked",
  completed: "statusCompleted",
};
const PRIORITY_LABEL_KEYS: Record<string, string> = {
  urgent: "priorityUrgent",
  high: "priorityHigh",
  medium: "priorityMedium",
  low: "priorityLow",
};

const priorityConfig: Record<string, { dot: string; bg: string; border: string; text: string; label: string }> = {
  urgent: { dot: "bg-error", bg: "bg-error/8", border: "border-l-error", text: "text-error", label: "Urgent" },
  high:   { dot: "bg-warning", bg: "bg-warning/8", border: "border-l-warning", text: "text-warning", label: "High" },
  medium: { dot: "bg-accent-primary", bg: "bg-accent-primary/8", border: "border-l-accent-primary", text: "text-accent-primary", label: "Medium" },
  low:    { dot: "bg-info", bg: "bg-info/8", border: "border-l-info", text: "text-info", label: "Low" },
};

const statusIcons: Record<string, typeof CheckCircle2> = {
  completed: CheckCircle2,
  blocked: AlertCircle,
  in_progress: Zap,
  pending: Clock,
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

type ViewMode = "month" | "week" | "day";

type DatePreset = "month" | "today" | "yesterday" | "tomorrow" | "this_week" | "last_week" | "custom";

type DateRange = {
  from: Date;
  to: Date;
};

type Filters = {
  q: string;
  view: ViewMode;
  types: Set<CalendarItem["kind"]>;
  taskStatuses: Set<string>;
  priorities: Set<string>;
  datePreset: DatePreset;
  customFrom: string; // YYYY-MM-DD
  customTo: string; // YYYY-MM-DD
};

const DEFAULT_FILTERS: Filters = {
  q: "",
  view: "month",
  types: new Set(["task", "event", "note"]),
  taskStatuses: new Set(["pending", "in_progress", "blocked", "completed"]),
  priorities: new Set(["urgent", "high", "medium", "low"]),
  datePreset: "month",
  customFrom: "",
  customTo: "",
};

export function CalendarClient() {
  const t = useTranslations("calendar.filters");
  const locale = useLocale();
  const dateLocale = locale === "bg" ? "bg-BG" : "en-US";
  const fmtDate = useCallback((d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString(dateLocale, opts), [dateLocale]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [expandedItem, setExpandedItem] = useState<{ kind: string; id: number } | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const presetRange = useMemo<DateRange>(() => {
    const now = new Date();

    switch (filters.datePreset) {
      case "today": {
        return { from: startOfDayLocal(now), to: endOfDayLocal(now) };
      }
      case "yesterday": {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        return { from: startOfDayLocal(d), to: endOfDayLocal(d) };
      }
      case "tomorrow": {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        return { from: startOfDayLocal(d), to: endOfDayLocal(d) };
      }
      case "this_week": {
        return { from: startOfWeekMondayLocal(now), to: endOfWeekMondayLocal(now) };
      }
      case "last_week": {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        return { from: startOfWeekMondayLocal(d), to: endOfWeekMondayLocal(d) };
      }
      case "custom": {
        // Interpret as local dates. Missing bounds fall back to month.
        const fallback = { from: startOfMonth(currentMonth), to: endOfMonth(currentMonth) };
        if (!filters.customFrom || !filters.customTo) return fallback;

        const [fy, fm, fd] = filters.customFrom.split("-").map((x) => Number(x));
        const [ty, tm, td] = filters.customTo.split("-").map((x) => Number(x));
        if (!fy || !fm || !fd || !ty || !tm || !td) return fallback;

        const f = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
        const t = new Date(ty, tm - 1, td, 23, 59, 59, 999);
        if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return fallback;

        return f.getTime() <= t.getTime() ? { from: f, to: t } : { from: t, to: f };
      }
      case "month":
      default: {
        return { from: startOfMonth(currentMonth), to: endOfMonth(currentMonth) };
      }
    }
  }, [currentMonth, filters.customFrom, filters.customTo, filters.datePreset]);

  const from = presetRange.from;
  const to = presetRange.to;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  const { data, isLoading } = (api as any).calendar.getForRange.useQuery(
    { from, to },
    { staleTime: 1000 * 30 }
  ) as { data: CalendarData | undefined; isLoading: boolean };

  /* ------------ derived grid ------------ */

  const calendarDays = useMemo(() => {
    const days: Date[] = [];
    const firstDay = startOfMonth(currentMonth);
    const startPad = firstDay.getDay(); // 0=Sun

    for (let i = startPad - 1; i >= 0; i--) {
      const d = new Date(firstDay);
      d.setDate(d.getDate() - i - 1);
      days.push(d);
    }

    const last = endOfMonth(currentMonth).getDate();
    for (let d = 1; d <= last; d++) {
      days.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d));
    }

    while (days.length < 42) {
      const d = new Date(days[days.length - 1]!);
      d.setDate(d.getDate() + 1);
      days.push(d);
    }

    return days;
  }, [currentMonth]);

  /* ------------ all month items for right panel ------------ */

  const allMonthItems = useMemo(() => {
    const items: CalendarItem[] = [];
    for (const t of data?.tasks ?? []) {
      if (!t.dueDate) continue;
      items.push({ kind: "task", id: t.id, title: t.title, status: t.status, priority: t.priority, projectTitle: t.projectTitle, date: new Date(t.dueDate) });
    }
    for (const e of data?.events ?? []) {
      items.push({ kind: "event", id: e.id, title: e.title, description: e.description, date: new Date(e.eventDate) });
    }
    for (const n of data?.notes ?? []) {
      if (!n.calendarDate) continue;
      items.push({ kind: "note", id: n.id, title: n.title ?? t("untitledNote"), locked: !!n.passwordHash, date: new Date(n.calendarDate) });
    }
    items.sort((a, b) => a.date.getTime() - b.date.getTime());
    return items;
  }, [data, t]);

  const filteredAllMonthItems = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return allMonthItems.filter((item) => {
      if (!filters.types.has(item.kind)) return false;

      if (item.kind === "task") {
        if (!filters.taskStatuses.has(item.status)) return false;
        if (!filters.priorities.has(item.priority)) return false;
      }

      if (q.length > 0) {
        const hay = (
          item.kind === "task"
            ? `${item.title} ${item.projectTitle ?? ""}`
            : item.kind === "event"
              ? `${item.title} ${item.description ?? ""}`
              : `${item.title}`
        ).toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [allMonthItems, filters]);

  const filteredItemsByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

    for (const item of filteredAllMonthItems) {
      const k = key(item.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }

    for (const [, v] of map) v.sort((a, b) => a.date.getTime() - b.date.getTime());
    return map;
  }, [filteredAllMonthItems]);

  const getFilteredItems = useCallback(
    (d: Date) => filteredItemsByDate.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? [],
    [filteredItemsByDate],
  );

  // Right-panel week view uses Monday-start week as well.
  const startOfWeek = startOfWeekMondayLocal;
  const endOfWeek = endOfWeekMondayLocal;

  const rightPanelItems = useMemo(() => {
    if (!selectedDate) return filteredAllMonthItems;
    if (filters.view === "day") return getFilteredItems(selectedDate);
    if (filters.view === "week") {
      const wStart = startOfWeek(selectedDate).getTime();
      const wEnd = endOfWeek(selectedDate).getTime();
      return filteredAllMonthItems.filter((it) => {
        const t = it.date.getTime();
        return t >= wStart && t <= wEnd;
      });
    }
    return getFilteredItems(selectedDate);
  }, [filters.view, filteredAllMonthItems, getFilteredItems, selectedDate, startOfWeek, endOfWeek]);

  /* ------------ navigation ------------ */

  const goToPrev = () => {
    setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
    setSelectedDate(null);
    setExpandedItem(null);
    setFilters((f) => ({ ...f, datePreset: "month" }));
  };
  const goToNext = () => {
    setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
    setSelectedDate(null);
    setExpandedItem(null);
    setFilters((f) => ({ ...f, datePreset: "month" }));
  };
  const goToToday = () => {
    setCurrentMonth(new Date());
    setSelectedDate(new Date());
    setExpandedItem(null);
    setFilters((f) => ({ ...f, datePreset: "today" }));
  };

  const today = new Date();

  const toggleExpand = (kind: string, id: number) => {
    setExpandedItem((prev) =>
      prev?.kind === kind && prev?.id === id ? null : { kind, id }
    );
  };

  return (
    <div className="w-full px-4 sm:px-6 md:px-8 py-6">
      {/* Header navigation */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={goToPrev}
            className="p-2 rounded-xl text-fg-secondary hover:text-fg-primary hover:bg-bg-secondary transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <h2 className="text-xl font-bold text-fg-primary tracking-tight font-display min-w-[180px] text-center" suppressHydrationWarning>
            {fmtDate(currentMonth, { month: "long", year: "numeric" })}
          </h2>
          <button
            onClick={goToNext}
            className="p-2 rounded-xl text-fg-secondary hover:text-fg-primary hover:bg-bg-secondary transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {selectedDate && (
            <button
              onClick={() => { setSelectedDate(null); setExpandedItem(null); }}
              className="px-3 py-2 rounded-xl text-sm font-medium text-fg-secondary hover:text-fg-primary hover:bg-bg-secondary transition-colors"
            >
                {t("showAll")}
            </button>
          )}
          <button
            onClick={goToToday}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-accent-primary/10 text-accent-primary border border-accent-primary/20 hover:bg-accent-primary/20 transition-colors"
          >
            {t("today")}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mb-5 rounded-2xl border border-white/[0.06] bg-bg-elevated shadow-xl p-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <input
                  value={filters.q}
                  onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                  placeholder={t("searchPlaceholder")}
                  className="w-[260px] max-w-[70vw] px-3 py-2 rounded-xl bg-bg-primary border border-white/[0.06] text-sm text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className={cn(
                  "px-3 py-2 rounded-xl border border-white/[0.06] text-sm font-medium flex items-center gap-2",
                  showFilters ? "bg-accent-primary/10 text-accent-primary" : "text-fg-secondary hover:bg-bg-secondary",
                )}
              >
                <Filter size={16} />
                {t("filters")}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(["task", "event", "note"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() =>
                  setFilters((f) => {
                    const next = new Set(f.types);
                    if (next.has(k)) next.delete(k);
                    else next.add(k);
                    return { ...f, types: next };
                  })
                }
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-semibold border border-white/[0.08]",
                  filters.types.has(k)
                    ? k === "task"
                      ? "bg-accent-primary/10 text-accent-primary"
                      : k === "event"
                        ? "bg-warning/10 text-warning"
                        : "bg-info/10 text-info"
                    : "text-fg-tertiary hover:bg-bg-secondary/50",
                )}
                aria-pressed={filters.types.has(k)}
              >
                {k === "task" ? t("tasks") : k === "event" ? t("events") : t("notes")}
              </button>
            ))}

            <div className="h-6 w-px bg-white/[0.06] mx-1" />

            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, view: v }))}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-semibold border border-white/[0.08]",
                  filters.view === v
                    ? "bg-accent-primary/10 text-accent-primary"
                    : "text-fg-tertiary hover:bg-bg-secondary/50",
                )}
                aria-pressed={filters.view === v}
              >
                {v === "day" ? t("day") : v === "week" ? t("week") : t("month")}
              </button>
            ))}
            </div>
          </div>

          {/* Quick date presets + custom range (local timezone; week starts Monday) */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {([
                ["today", t("today")],
                ["yesterday", t("yesterday")],
                ["tomorrow", t("tomorrow")],
                ["this_week", t("thisWeek")],
                ["last_week", t("lastWeek")],
              ] as const).map(([preset, label]) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      datePreset: preset,
                    }))
                  }
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-semibold border border-white/[0.08]",
                    filters.datePreset === preset
                      ? "bg-accent-primary/10 text-accent-primary"
                      : "text-fg-tertiary hover:bg-bg-secondary/50",
                  )}
                  aria-pressed={filters.datePreset === preset}
                >
                  {label}
                </button>
              ))}

              <div className="h-6 w-px bg-white/[0.06] mx-1" />

              <button
                type="button"
                onClick={() => setFilters((f) => ({ ...f, datePreset: "custom" }))}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-semibold border border-white/[0.08]",
                  filters.datePreset === "custom"
                    ? "bg-accent-primary/10 text-accent-primary"
                    : "text-fg-tertiary hover:bg-bg-secondary/50",
                )}
                aria-pressed={filters.datePreset === "custom"}
              >
                {t("custom")}
              </button>
            </div>

            {filters.datePreset === "custom" && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold text-fg-secondary">{t("from")}</label>
                  <input
                    type="date"
                    value={filters.customFrom}
                    onChange={(e) => setFilters((f) => ({ ...f, customFrom: e.target.value }))}
                    className="px-3 py-2 rounded-xl bg-bg-primary border border-white/[0.06] text-sm text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold text-fg-secondary">{t("to")}</label>
                  <input
                    type="date"
                    value={filters.customTo}
                    onChange={(e) => setFilters((f) => ({ ...f, customTo: e.target.value }))}
                    className="px-3 py-2 rounded-xl bg-bg-primary border border-white/[0.06] text-sm text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
                  />
                </div>
              </div>
            )}

            <div className="text-[11px] text-fg-tertiary">
              {t("showingRange", {
                from: fmtDate(from, { month: "short", day: "numeric", year: "numeric" }),
                to: fmtDate(to, { month: "short", day: "numeric", year: "numeric" }),
              })}
            </div>
          </div>
        </div>

        {showFilters && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/[0.06] bg-bg-primary p-3">
              <div className="text-[11px] font-bold text-fg-secondary mb-2">{t("taskStatus")}</div>
              <div className="flex flex-wrap gap-2">
                {(["pending", "in_progress", "blocked", "completed"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() =>
                      setFilters((f) => {
                        const next = new Set(f.taskStatuses);
                        if (next.has(s)) next.delete(s);
                        else next.add(s);
                        return { ...f, taskStatuses: next };
                      })
                    }
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-semibold border border-white/[0.08]",
                      filters.taskStatuses.has(s)
                        ? "bg-accent-primary/10 text-accent-primary"
                        : "text-fg-tertiary hover:bg-bg-secondary/50",
                    )}
                    aria-pressed={filters.taskStatuses.has(s)}
                  >
                    {t(STATUS_LABEL_KEYS[s] ?? "statusPending")}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-bg-primary p-3">
              <div className="text-[11px] font-bold text-fg-secondary mb-2">{t("priority")}</div>
              <div className="flex flex-wrap gap-2">
                {(["urgent", "high", "medium", "low"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() =>
                      setFilters((f) => {
                        const next = new Set(f.priorities);
                        if (next.has(p)) next.delete(p);
                        else next.add(p);
                        return { ...f, priorities: next };
                      })
                    }
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-semibold border border-white/[0.08]",
                      filters.priorities.has(p)
                        ? "bg-accent-primary/10 text-accent-primary"
                        : "text-fg-tertiary hover:bg-bg-secondary/50",
                    )}
                    aria-pressed={filters.priorities.has(p)}
                  >
                    {t(PRIORITY_LABEL_KEYS[p] ?? "priorityMedium")}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Split layout */}
      <div className="flex gap-5 items-start">
        {/* LEFT — Calendar grid */}
        <div className="flex-[3] min-w-0">
          <div className="rounded-2xl border border-white/[0.06] bg-bg-elevated shadow-xl overflow-hidden">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b border-white/[0.06]">
              {WEEKDAYS.map((day) => (
                <div
                  key={day}
                  className="py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-fg-tertiary"
                >
                  {t(day)}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7">
              {calendarDays.map((day, idx) => {
                const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
                const isToday = isSameDay(day, today);
                const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
                const dayItems = getFilteredItems(day);
                const hasItems = dayItems.length > 0;

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => { setSelectedDate(day); setExpandedItem(null); }}
                    className={cn(
                      "relative min-h-[68px] sm:min-h-[80px] p-1.5 text-left border-b border-r border-white/[0.04] transition-all duration-150",
                      !isCurrentMonth && "opacity-35",
                      isSelected
                        ? "bg-accent-primary/10 ring-1 ring-inset ring-accent-primary/30"
                        : "hover:bg-bg-secondary/40",
                    )}
                  >
                    {/* Day number */}
                    <span
                      className={cn(
                        "inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-semibold transition-colors",
                        isToday
                          ? "bg-accent-primary text-white shadow-sm"
                          : isSelected
                            ? "text-accent-primary font-bold"
                            : "text-fg-primary",
                      )}
                    >
                      {day.getDate()}
                    </span>

                    {/* Item dots */}
                    {hasItems && (
                      <div className="mt-0.5 space-y-0.5">
                        {dayItems.slice(0, 2).map((item, i) => (
                          <div
                            key={`${item.kind}-${item.id}-${i}`}
                            className={cn(
                              "flex items-center gap-1 px-1 py-0.5 rounded text-[9px] leading-tight font-medium truncate",
                              item.kind === "task"
                                ? "bg-accent-primary/10 text-accent-primary"
                                : item.kind === "event"
                                  ? "bg-warning/10 text-warning"
                                  : "bg-info/10 text-info",
                            )}
                          >
                            {item.kind === "task" ? (
                              <span
                                className={cn(
                                  "w-1.5 h-1.5 rounded-full shrink-0",
                                  priorityConfig[item.priority]?.dot ?? "bg-accent-primary",
                                )}
                              />
                            ) : item.kind === "event" ? (
                              <CalendarDays size={8} className="shrink-0" />
                            ) : (
                              <StickyNote size={8} className="shrink-0" />
                            )}
                            <span className="truncate">{item.title}</span>
                          </div>
                        ))}
                        {dayItems.length > 2 && (
                          <span className="text-[9px] text-fg-tertiary pl-1">
                            {t("moreCount", { count: dayItems.length - 2 })}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT — Task & event banners */}
        <div className="flex-[2] min-w-0 max-h-[calc(100vh-180px)] overflow-y-auto">
          <div className="rounded-2xl border border-white/[0.06] bg-bg-elevated shadow-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-fg-primary">
                {selectedDate
                  ? fmtDate(selectedDate, { weekday: "short", month: "short", day: "numeric" })
                  : t("allItems")}
              </h3>
              <span className="text-[11px] text-fg-tertiary font-medium">
                {t("itemsCount", { count: rightPanelItems.length })}
              </span>
            </div>

            {isLoading ? (
               <div className="py-10 text-center text-fg-tertiary text-sm">{t("loading")}</div>
            ) : rightPanelItems.length === 0 ? (
              <div className="py-10 text-center text-fg-tertiary text-sm">
                 {selectedDate ? t("noItemsDay") : t("noItemsMonth")}
              </div>
            ) : (
              <div className="space-y-2">
                {rightPanelItems.map((item) => {
                  const isExpanded = expandedItem?.kind === item.kind && expandedItem?.id === item.id;

                  if (item.kind === "task") {
                    const prio = priorityConfig[item.priority] ?? priorityConfig.medium!;
                    const StatusIcon = statusIcons[item.status] ?? Clock;

                    return (
                      <div key={`task-${item.id}`}>
                        {/* Banner */}
                        <button
                          type="button"
                          onClick={() => toggleExpand("task", item.id)}
                          className={cn(
                            "w-full text-left rounded-xl border-l-[3px] border border-white/[0.06] transition-all duration-150",
                            prio.border,
                            prio.bg,
                            isExpanded
                              ? "ring-1 ring-accent-primary/20 shadow-md"
                              : "hover:shadow-md hover:scale-[1.01]",
                          )}
                        >
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <div
                              className={cn(
                                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                                item.status === "completed"
                                  ? "bg-success/15 text-success"
                                  : item.status === "blocked"
                                    ? "bg-error/15 text-error"
                                    : "bg-accent-primary/15 text-accent-primary",
                              )}
                            >
                              <StatusIcon size={14} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p
                                className={cn(
                                  "text-[13px] font-semibold leading-tight truncate",
                                  item.status === "completed"
                                    ? "text-fg-tertiary line-through"
                                    : "text-fg-primary",
                                )}
                              >
                                {item.title}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="flex items-center gap-1 text-[10px]">
                                  <span className={cn("w-1.5 h-1.5 rounded-full", prio.dot)} />
                                   <span className={prio.text}>{t(PRIORITY_LABEL_KEYS[item.priority] ?? "priorityMedium")}</span>
                                </span>
                                {!selectedDate && (
                                  <span className="text-[10px] text-fg-tertiary">
                                    {fmtDate(item.date, { month: "short", day: "numeric" })}
                                  </span>
                                )}
                              </div>
                            </div>
                            <span
                              className={cn(
                                "text-[10px] font-medium px-2 py-0.5 rounded-full capitalize shrink-0",
                                item.status === "completed"
                                  ? "bg-success/10 text-success"
                                  : item.status === "blocked"
                                    ? "bg-error/10 text-error"
                                    : item.status === "in_progress"
                                      ? "bg-accent-primary/10 text-accent-primary"
                                      : "bg-fg-quaternary/10 text-fg-secondary",
                              )}
                            >
                               {t(STATUS_LABEL_KEYS[item.status] ?? "statusPending")}
                            </span>
                          </div>
                        </button>

                        {/* Expanded detail card */}
                        {isExpanded && (
                          <div className="mt-1 ml-3 rounded-xl border border-white/[0.06] bg-bg-surface p-4 animate-[popIn_200ms_cubic-bezier(0.34,1.56,0.64,1)]">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="text-[13px] font-bold text-fg-primary">{item.title}</h4>
                              <button
                                type="button"
                                onClick={() => setExpandedItem(null)}
                                className="p-1 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-bg-secondary transition-colors"
                              >
                                <X size={14} />
                              </button>
                            </div>
                            <div className="space-y-2">
                              {item.projectTitle && (
                                <div className="flex items-center gap-2 text-[12px]">
                                  <FolderOpen size={13} className="text-accent-primary shrink-0" />
                                   <span className="text-fg-secondary">{t("projectLabel")}</span>
                                  <span className="text-fg-primary font-medium">{item.projectTitle}</span>
                                </div>
                              )}
                              <div className="flex items-center gap-2 text-[12px]">
                                <StatusIcon size={13} className="text-fg-tertiary shrink-0" />
                                 <span className="text-fg-secondary">{t("statusLabel")}</span>
                                 <span className="text-fg-primary font-medium capitalize">{t(STATUS_LABEL_KEYS[item.status] ?? "statusPending")}</span>
                              </div>
                              <div className="flex items-center gap-2 text-[12px]">
                                <span className={cn("w-2 h-2 rounded-full shrink-0", prio.dot)} />
                                 <span className="text-fg-secondary">{t("priorityLabel")}</span>
                                 <span className={cn("font-medium", prio.text)}>{t(PRIORITY_LABEL_KEYS[item.priority] ?? "priorityMedium")}</span>
                              </div>
                              <div className="flex items-center gap-2 text-[12px]">
                                <CalendarDays size={13} className="text-fg-tertiary shrink-0" />
                                 <span className="text-fg-secondary">{t("dueLabel")}</span>
                                <span className="text-fg-primary font-medium">
                                  {fmtDate(item.date, { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (item.kind === "note") {
                    return (
                      <div key={`note-${item.id}`}>
                        <button
                          type="button"
                          onClick={() => toggleExpand("note", item.id)}
                          className={cn(
                            "w-full text-left rounded-xl border-l-[3px] border-l-info border border-white/[0.06] bg-info/8 transition-all duration-150",
                            isExpanded
                              ? "ring-1 ring-info/20 shadow-md"
                              : "hover:shadow-md hover:scale-[1.01]",
                          )}
                        >
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <div className="w-7 h-7 rounded-lg bg-info/15 text-info flex items-center justify-center shrink-0">
                              <StickyNote size={14} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold text-fg-primary leading-tight truncate">
                                {item.title}
                              </p>
                              <span className="text-[10px] text-info font-medium">
                                {t("noteType")}
                                {item.locked && <span className="text-fg-tertiary ml-2">{t("locked")}</span>}
                                {!selectedDate && (
                                  <span className="text-fg-tertiary ml-2">
                                    {fmtDate(item.date, { month: "short", day: "numeric" })}
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="mt-1 ml-3 rounded-xl border border-white/[0.06] bg-bg-surface p-4 animate-[popIn_200ms_cubic-bezier(0.34,1.56,0.64,1)]">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="text-[13px] font-bold text-fg-primary">{item.title}</h4>
                              <button
                                type="button"
                                onClick={() => setExpandedItem(null)}
                                className="p-1 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-bg-secondary transition-colors"
                              >
                                <X size={14} />
                              </button>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-[12px]">
                                <StickyNote size={13} className="text-info shrink-0" />
                                <span className="text-fg-secondary">{t("typeLabel")}</span>
                                <span className="text-fg-primary font-medium">{t("noteType")}</span>
                              </div>
                              <div className="flex items-center gap-2 text-[12px]">
                                <CalendarDays size={13} className="text-fg-tertiary shrink-0" />
                                <span className="text-fg-secondary">{t("dateLabel")}</span>
                                <span className="text-fg-primary font-medium">
                                  {fmtDate(item.date, { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
                                </span>
                              </div>
                              {item.locked && (
                                <div className="text-[12px] text-fg-tertiary">{t("notePasswordProtected")}</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  /* ---- Event banner ---- */
                  return (
                    <div key={`event-${item.id}`}>
                      <button
                        type="button"
                        onClick={() => toggleExpand("event", item.id)}
                        className={cn(
                          "w-full text-left rounded-xl border-l-[3px] border-l-warning border border-white/[0.06] bg-warning/8 transition-all duration-150",
                          isExpanded
                            ? "ring-1 ring-warning/20 shadow-md"
                            : "hover:shadow-md hover:scale-[1.01]",
                        )}
                      >
                        <div className="flex items-center gap-3 px-3 py-2.5">
                          <div className="w-7 h-7 rounded-lg bg-warning/15 text-warning flex items-center justify-center shrink-0">
                            <CalendarDays size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold text-fg-primary leading-tight truncate">
                              {item.title}
                            </p>
                            <span className="text-[10px] text-warning font-medium">
                              {t("eventType")}
                              {!selectedDate && (
                                <span className="text-fg-tertiary ml-2">
                                  {fmtDate(item.date, { month: "short", day: "numeric" })}
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="mt-1 ml-3 rounded-xl border border-white/[0.06] bg-bg-surface p-4 animate-[popIn_200ms_cubic-bezier(0.34,1.56,0.64,1)]">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-[13px] font-bold text-fg-primary">{item.title}</h4>
                            <button
                              type="button"
                              onClick={() => setExpandedItem(null)}
                              className="p-1 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-bg-secondary transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-[12px]">
                              <CalendarDays size={13} className="text-warning shrink-0" />
                               <span className="text-fg-secondary">{t("dateLabel")}</span>
                              <span className="text-fg-primary font-medium">
                                {fmtDate(item.date, { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
                              </span>
                            </div>
                            {item.description && (
                              <div className="text-[12px] text-fg-secondary mt-2 leading-relaxed">
                                {item.description}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
