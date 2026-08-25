"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Filter, Plus, Search } from "lucide-react";
import { api } from "~/trpc/react";
import { cn } from "~/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDrawer, type DrawerState } from "./CalendarDrawer";
import { CalendarMonthGrid } from "./CalendarMonthGrid";
import { CalendarTimeGrid } from "./CalendarTimeGrid";
import {
  ITEM_KINDS,
  KIND_CHIP_TONE,
  PRIORITY_LABEL_KEYS,
  STATUS_LABEL_KEYS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  addDays,
  addMonths,
  dayKey,
  endOfDayLocal,
  fromYmd,
  hourWindow,
  isoWeek,
  matchesFilters,
  priorityTone,
  startOfDayLocal,
  toCalendarItems,
  toYmd,
  visibleDays,
  type CalendarItem,
  type CalendarKind,
  type ViewMode,
} from "./calendarModel";

const WEEKDAY_KEYS = [
  "weekdayMon",
  "weekdayTue",
  "weekdayWed",
  "weekdayThu",
  "weekdayFri",
  "weekdaySat",
  "weekdaySun",
] as const;

const VIEWS: ViewMode[] = ["day", "week", "month"];

const CHIP_BASE =
  "flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors";
const SMALL_CHIP =
  "flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition-colors";
const IDLE_CHIP = "border-border-medium text-fg-tertiary hover:bg-bg-secondary";
const MICRO_LABEL = "text-[10px] uppercase tracking-[0.14em] text-fg-tertiary";
const DATE_INPUT =
  "h-[30px] rounded-md border border-border-medium bg-bg-surface px-2 text-[11px] tabular-nums text-fg-primary outline-none transition-colors focus:border-accent-primary/60";

type Range = { from: string; to: string };

/**
 * Every date on this page is read off the client clock: which week is "this"
 * week, which cell is today, what the range inputs are pre-filled with. The
 * server renders in its own timezone and at its own instant, so rendering the
 * grid during SSR guarantees a hydration mismatch on the day numbers, the
 * input values and the period title. Hold a skeleton until the browser clock
 * is known, then build the calendar from it — client-side only, once.
 */
export function CalendarClient() {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(startOfDayLocal(new Date())), []);

  if (!today) return <CalendarSkeleton />;
  return <CalendarWorkspace today={today} />;
}

function CalendarSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 px-4 py-5 sm:px-6 md:px-8">
      <div className="h-[30px] w-72 animate-pulse rounded-lg bg-bg-secondary" />
      <div className="h-8 w-full max-w-2xl animate-pulse rounded-lg bg-bg-secondary" />
      <div className="min-h-0 flex-1 rounded-xl border border-border-light bg-bg-elevated" />
    </div>
  );
}

function CalendarWorkspace({ today }: { today: Date }) {
  const t = useTranslations("calendar.filters");
  const locale = useLocale();
  const dateLocale = locale === "bg" ? "bg-BG" : "en-US";
  const fmt = useCallback(
    (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString(dateLocale, opts),
    [dateLocale],
  );

  const [view, setView] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState<Date>(today);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<Set<CalendarKind>>(() => new Set(ITEM_KINDS));
  const [statuses, setStatuses] = useState<Set<string>>(() => new Set(TASK_STATUSES));
  const [priorities, setPriorities] = useState<Set<string>>(() => new Set(TASK_PRIORITIES));
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** `null` means "follow the period being viewed"; navigation resets to that. */
  const [range, setRange] = useState<Range | null>(null);

  // Drives the red now-line, so it has to keep up with the wall clock.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const filterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filtersOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFiltersOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [filtersOpen]);

  /* ---------------- period + query range ---------------- */

  const days = useMemo(() => visibleDays(view, anchor), [view, anchor]);
  const periodFrom = startOfDayLocal(days[0]!);
  const periodTo = endOfDayLocal(days[days.length - 1]!);

  const { data, isLoading } = api.calendar.getForRange.useQuery(
    { from: periodFrom, to: periodTo },
    { staleTime: 30_000 },
  );

  const utils = api.useUtils();
  const refreshCalendar = useCallback(() => {
    void utils.calendar.getForRange.invalidate();
  }, [utils]);

  // The range inputs narrow what the period shows; by default they mirror it.
  const shownRange: Range = range ?? { from: toYmd(periodFrom), to: toYmd(periodTo) };
  const rangeBounds = useMemo(() => {
    if (!range) return null;
    const from = fromYmd(range.from);
    const to = fromYmd(range.to, true);
    if (!from || !to) return null;
    return from <= to ? { from, to } : { from: to, to: from };
  }, [range]);

  /* ---------------- items ---------------- */

  const untitledNote = t("untitledNote");
  const allItems = useMemo(
    () => toCalendarItems(data, untitledNote),
    [data, untitledNote],
  );

  const inRange = useMemo(() => {
    if (!rangeBounds) return allItems;
    return allItems.filter(
      (item) => item.date >= rangeBounds.from && item.date <= rangeBounds.to,
    );
  }, [allItems, rangeBounds]);

  const visibleItems = useMemo(
    () => inRange.filter((item) => matchesFilters(item, { query, kinds, statuses, priorities })),
    [inRange, kinds, statuses, priorities, query],
  );

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of visibleItems) {
      const key = dayKey(item.date);
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [visibleItems]);

  const kindCounts = useMemo(() => {
    const counts: Record<CalendarKind, number> = { task: 0, event: 0, note: 0 };
    for (const item of inRange) counts[item.kind] += 1;
    return counts;
  }, [inRange]);

  const hours = useMemo(() => hourWindow(visibleItems), [visibleItems]);
  const filtersOff =
    TASK_STATUSES.length - statuses.size + (TASK_PRIORITIES.length - priorities.size);

  /* ---------------- navigation ---------------- */

  const step = useCallback(
    (direction: -1 | 1) => {
      setRange(null);
      setAnchor((current) => {
        if (view === "month") return addMonths(current, direction);
        return addDays(current, direction * (view === "week" ? 7 : 1));
      });
    },
    [view],
  );

  const goToToday = useCallback(() => {
    setRange(null);
    setAnchor(today);
  }, [today]);

  const switchView = useCallback((next: ViewMode) => {
    setRange(null);
    setView(next);
  }, []);

  /* ---------------- labels ---------------- */

  const title = useMemo(() => {
    if (view === "month") return fmt(anchor, { month: "long", year: "numeric" });
    if (view === "day") return fmt(anchor, { weekday: "short", day: "numeric", month: "long" });

    const first = days[0]!;
    const last = days[days.length - 1]!;
    return first.getMonth() === last.getMonth()
      ? `${first.getDate()} – ${last.getDate()} ${fmt(first, { month: "long" })}`
      : `${first.getDate()} ${fmt(first, { month: "short" })} – ${last.getDate()} ${fmt(last, { month: "short" })}`;
  }, [anchor, days, fmt, view]);

  const subTitle =
    view === "month"
      ? fmt(anchor, { month: "short", year: "numeric" })
      : t("weekSubtitle", { week: isoWeek(anchor), year: anchor.getFullYear() });

  const weekdayLabels = WEEKDAY_KEYS.map((key) => t(key));
  const weekdayLabel = (date: Date) => weekdayLabels[(date.getDay() + 6) % 7]!;

  const openNew = useCallback((date: Date) => {
    setDrawer({ mode: "new", date });
  }, []);

  // The toolbar's New button has no cell to anchor to: prefer today when the
  // period on screen contains it, otherwise the first day of that period.
  const defaultNewDate = () =>
    today >= periodFrom && today <= periodTo ? today : days[0]!;

  return (
    <div className="relative flex h-full flex-col gap-4 overflow-hidden px-4 py-5 sm:px-6 md:px-8">
      {/* ── Period navigation ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-4 calendar-rise">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={t("previousPeriod")}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border-medium text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={t("nextPeriod")}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border-medium text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        <h1
          className="font-display text-[26px] leading-none font-semibold tracking-tight text-fg-primary"

        >
          {title}
        </h1>
        <span className="text-[11px] text-fg-tertiary">
          {subTitle}
        </span>

        <button
          type="button"
          onClick={goToToday}
          className="h-[30px] rounded-lg border border-accent-primary/30 bg-accent-primary/10 px-3 text-xs font-semibold text-accent-primary transition-colors hover:bg-accent-primary/20"
        >
          {t("today")}
        </button>

        <span className="flex-1" />

        <div className="flex items-center gap-2">
          <span className={MICRO_LABEL}>{t("range")}</span>
          <input
            type="date"
            value={shownRange.from}
            aria-label={t("from")}
            onChange={(e) => setRange({ ...shownRange, from: e.target.value })}
            className={DATE_INPUT}
          />
          <span className="text-xs text-fg-quaternary">→</span>
          <input
            type="date"
            value={shownRange.to}
            aria-label={t("to")}
            onChange={(e) => setRange({ ...shownRange, to: e.target.value })}
            className={DATE_INPUT}
          />
        </div>

        <div className="flex overflow-hidden rounded-lg border border-border-medium">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => switchView(v)}
              aria-pressed={view === v}
              className={cn(
                "h-[30px] px-3.5 text-xs font-semibold transition-colors",
                view === v
                  ? "bg-accent-primary/15 text-accent-primary"
                  : "text-fg-tertiary hover:bg-bg-secondary",
              )}
            >
              {t(v)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Type chips, search, filters ── */}
      <div
        className="relative z-20 flex shrink-0 flex-wrap items-center gap-3 calendar-rise"
        style={{ animationDelay: "70ms" }}
      >
        {ITEM_KINDS.map((kind) => {
          const active = kinds.has(kind);
          const tone = KIND_CHIP_TONE[kind];
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={active}
              onClick={() =>
                setKinds((current) => {
                  const next = new Set(current);
                  if (next.has(kind)) next.delete(kind);
                  else next.add(kind);
                  return next;
                })
              }
              className={cn(
                CHIP_BASE,
                active ? cn(tone.bg, tone.border, tone.text) : IDLE_CHIP,
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-sm",
                  active ? tone.dot : "bg-fg-quaternary/40",
                )}
              />
              {kind === "task" ? t("tasks") : kind === "event" ? t("events") : t("notes")}
              <span className="text-[11px] text-fg-tertiary">
                {kindCounts[kind]}
              </span>
            </button>
          );
        })}

        <span className="h-[22px] w-px bg-border-light" />

        <label className="flex h-8 w-[230px] items-center gap-2.5 rounded-lg border border-border-medium bg-bg-surface px-3">
          <Search size={14} className="shrink-0 text-fg-tertiary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchRange")}
            className="min-w-0 flex-1 border-none bg-transparent text-xs text-fg-primary outline-none placeholder:text-fg-quaternary"
          />
        </label>

        <div className="relative" ref={filterRef}>
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            className={cn(
              CHIP_BASE,
              filtersOpen || filtersOff
                ? "border-accent-primary/30 bg-accent-primary/10 text-accent-primary"
                : IDLE_CHIP,
            )}
          >
            <Filter size={14} />
            {t("filters")}
            {filtersOff > 0 && (
              <span className="text-[11px] text-fg-tertiary">
                {t("filtersOff", { count: filtersOff })}
              </span>
            )}
          </button>

          {filtersOpen && (
            <div className="absolute top-10 left-0 z-30 flex w-[330px] flex-col gap-4 rounded-xl border border-border-medium bg-bg-elevated p-4 shadow-2xl calendar-pop">
              <div className="flex flex-col gap-2.5">
                <span className={MICRO_LABEL}>{t("taskStatus")}</span>
                <div className="flex flex-wrap gap-2">
                  {TASK_STATUSES.map((status) => {
                    const active = statuses.has(status);
                    return (
                      <button
                        key={status}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setStatuses((current) => {
                            const next = new Set(current);
                            if (next.has(status)) next.delete(status);
                            else next.add(status);
                            return next;
                          })
                        }
                        className={cn(
                          SMALL_CHIP,
                          active
                            ? "border-accent-primary/30 bg-accent-primary/10 text-accent-primary"
                            : IDLE_CHIP,
                        )}
                      >
                        {t(STATUS_LABEL_KEYS[status]!)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <span className={MICRO_LABEL}>{t("priority")}</span>
                <div className="flex flex-wrap gap-2">
                  {TASK_PRIORITIES.map((priority) => {
                    const active = priorities.has(priority);
                    const tone = priorityTone(priority);
                    return (
                      <button
                        key={priority}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setPriorities((current) => {
                            const next = new Set(current);
                            if (next.has(priority)) next.delete(priority);
                            else next.add(priority);
                            return next;
                          })
                        }
                        className={cn(
                          SMALL_CHIP,
                          active ? cn(tone.bg, tone.border, tone.text) : IDLE_CHIP,
                        )}
                      >
                        <span className={cn("h-[7px] w-[7px] rounded-full", tone.dot)} />
                        {t(PRIORITY_LABEL_KEYS[priority]!)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setStatuses(new Set(TASK_STATUSES));
                  setPriorities(new Set(TASK_PRIORITIES));
                }}
                className="self-start rounded-md border border-border-medium px-2.5 py-1.5 text-[11px] font-semibold text-fg-secondary transition-colors hover:bg-bg-secondary"
              >
                {t("reset")}
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => openNew(defaultNewDate())}
          className="flex h-8 items-center gap-2 rounded-lg bg-accent-primary px-3.5 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          <Plus size={14} />
          {t("newButton")}
        </button>

        <span className="flex-1" />

        <span className="text-[11px] text-fg-tertiary">
          {isLoading ? t("loading") : t("itemsShown", { count: visibleItems.length })}
        </span>
      </div>

      {/* ── Grid ── */}
      <div className="flex min-h-0 flex-1 overflow-x-auto">
        <div className="flex min-h-0 min-w-[760px] flex-1 flex-col">
          {view === "month" ? (
            <CalendarMonthGrid
              days={days}
              month={anchor.getMonth()}
              today={today}
              itemsByDay={itemsByDay}
              weekdayLabels={weekdayLabels}
              moreLabel={(count) => t("moreCount", { count })}
              addLabel={t("addOnDay")}
              onSelectItem={(item) => setDrawer({ mode: "detail", item })}
              onCreate={openNew}
            />
          ) : (
            <CalendarTimeGrid
              days={days}
              today={today}
              now={now}
              itemsByDay={itemsByDay}
              hours={hours}
              weekdayLabel={weekdayLabel}
              allDayLabel={t("allDay")}
              addLabel={t("addOnDay")}
              countLabel={(count) => (count > 0 ? String(count) : "")}
              onSelectItem={(item) => setDrawer({ mode: "detail", item })}
              onCreate={openNew}
            />
          )}
        </div>
      </div>

      {drawer && (
        <CalendarDrawer
          state={drawer}
          onClose={() => setDrawer(null)}
          onCreated={() => {
            refreshCalendar();
            setDrawer(null);
          }}
        />
      )}
    </div>
  );
}
