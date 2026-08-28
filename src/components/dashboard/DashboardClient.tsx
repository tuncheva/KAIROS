"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronRight, Plus } from "lucide-react";

import { avatarGradientStyle } from "~/lib/avatarGradient";
import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import {
  RING_DAY,
  RING_PROJECT,
  RING_TASKS,
  dashOffset,
  dayFraction,
  headlineStats,
  projectSummaries,
  startOfDay,
  taskState,
  todayTasks,
  weekStrip,
  type CalendarTask,
  type ProjectSummary,
  type TaskState,
  type WeekDay,
} from "./dashboardData";

/** Project detail lives behind the create flow — see `ProjectsWorkspace`. */
const projectHref = (id: number) => `/projects?projectId=${id}`;

type ActivityRow = {
  id: number;
  action: string;
  newValue: string | null;
  createdAt: Date | string | null;
  taskTitle: string | null;
  projectId: number | null;
  projectTitle: string | null;
  user: { id: string | null; name: string | null; email: string | null } | null;
};

/**
 * Eased 0 → 1 over the entrance, driving both the counting numbers and the ring
 * sweeps so they land together. Reduced-motion users get the final frame.
 */
function useEntrance(active: boolean): number {
  const [progress, setProgress] = useState(0);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!active) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setProgress(1);
      return;
    }

    const start = performance.now();
    const duration = 1100;
    const tick = (now: number) => {
      const x = Math.min(1, (now - start) / duration);
      setProgress(1 - Math.pow(1 - x, 3));
      if (x < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);

    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [active]);

  return active ? progress : 0;
}

/**
 * Tweens a number toward its latest target. The entrance handles first paint,
 * so this starts settled and only animates the *changes* — ticking a task off
 * sweeps the ring and counts the percent across instead of snapping.
 */
function useTween(target: number, duration = 700): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (current.current === target) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      current.current = target;
      setValue(target);
      return;
    }

    const origin = current.current;
    const start = performance.now();
    const tick = (now: number) => {
      const x = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - x, 3);
      const next = origin + (target - origin) * eased;
      current.current = x < 1 ? next : target;
      setValue(current.current);
      if (x < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);

    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [target, duration]);

  return value;
}

/**
 * Completing a task usually drops it out of the list. React has no exit phase,
 * so rows that vanish are held at their old index for the length of the
 * collapse animation and then let go.
 */
function useExitList<T extends { id: number }>(
  items: T[],
  hold = 420,
): Array<{ item: T; leaving: boolean }> {
  const [leaving, setLeaving] = useState<Array<{ item: T; index: number }>>([]);
  const previous = useRef<T[]>(items);

  useEffect(() => {
    const live = new Set(items.map((item) => item.id));
    const gone = previous.current
      .map((item, index) => ({ item, index }))
      .filter((entry) => !live.has(entry.item.id));
    previous.current = items;
    if (gone.length === 0) return;

    setLeaving((rows) => [
      ...rows.filter((row) => !gone.some((entry) => entry.item.id === row.item.id)),
      ...gone,
    ]);
    const timer = setTimeout(() => {
      setLeaving((rows) =>
        rows.filter((row) => !gone.some((entry) => entry.item.id === row.item.id)),
      );
    }, hold);

    return () => clearTimeout(timer);
  }, [items, hold]);

  const live = new Set(items.map((item) => item.id));
  const rows = items.map((item) => ({ item, leaving: false }));
  for (const entry of leaving) {
    if (live.has(entry.item.id)) continue;
    rows.splice(Math.min(entry.index, rows.length), 0, { item: entry.item, leaving: true });
  }
  return rows;
}

/** Blocks stage in on a shared curve; the delay is what separates them. */
const rise = (delay: number) => ({ animationDelay: `${delay}s` });

export function DashboardClient({ userName }: { userName: string | null }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const toast = useToast();
  const utils = api.useUtils();

  const projectsQuery = api.project.getMyProjects.useQuery();
  const notesQuery = api.note.getAll.useQuery();
  const activityQuery = api.task.getOrgActivity.useQuery({ limit: 6, scope: "all" });

  // A fortnight is wide enough for the five-column strip even when it starts on
  // a Friday and has to jump the weekend.
  const range = useMemo(() => {
    const from = startOfDay(new Date());
    from.setDate(from.getDate() - 60);
    const to = startOfDay(new Date());
    to.setDate(to.getDate() + 21);
    return { from, to };
  }, []);

  const calendarQuery = api.task.getForCalendar.useQuery(range);

  const updateStatus = api.task.updateStatus.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.task.getForCalendar.invalidate(),
        utils.project.getMyProjects.invalidate(),
        utils.task.getOrgActivity.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const now = useMemo(() => new Date(), []);
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const calendarTasks = useMemo<CalendarTask[]>(
    () => calendarQuery.data?.tasks ?? [],
    [calendarQuery.data],
  );

  const stats = useMemo(() => headlineStats(projects, now), [projects, now]);
  const summaries = useMemo(() => projectSummaries(projects, now), [projects, now]);
  const today = useMemo(() => todayTasks(calendarTasks, now), [calendarTasks, now]);
  const todayRows = useExitList(today);
  const [pendingDone, setPendingDone] = useState<Map<number, boolean>>(new Map());
  const week = useMemo(() => weekStrip(calendarTasks, now), [calendarTasks, now]);
  const dayGone = useMemo(() => dayFraction(now), [now]);

  const notes = (notesQuery.data ?? []).slice(0, 2);
  const activity = ((activityQuery.data?.rows ?? []) as ActivityRow[]).slice(0, 3);

  const isLoading = projectsQuery.isLoading || calendarQuery.isLoading;

  // First run is the state where there is nothing to lay out at all: no projects
  // to summarise, so the populated grid would render as a page of zeroes.
  const isFirstRun = !isLoading && projects.length === 0;

  const p = useEntrance(!isLoading);

  const dateLine = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);

  const hour = now.getHours();
  const greeting = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = (userName ?? "").trim().split(" ")[0] ?? "";

  const toggleTask = (task: CalendarTask) => {
    const done = task.status !== "completed";
    // The tick fills straight away; the row only leaves once the refetch drops
    // it from the list, which is what the collapse animation covers.
    setPendingDone((map) => new Map(map).set(task.id, done));
    updateStatus.mutate(
      { taskId: task.id, status: done ? "completed" : "pending" },
      {
        onSettled: () =>
          setPendingDone((map) => {
            const next = new Map(map);
            next.delete(task.id);
            return next;
          }),
      },
    );
  };

  if (isFirstRun) {
    return <FirstRun dayGone={dayGone} now={now} locale={locale} />;
  }

  return (
    <div className="grid grid-cols-1 items-start xl:grid-cols-[minmax(0,1fr)_392px]">
      <div className="flex flex-col gap-9 px-4 pt-9 pb-14 sm:px-10 xl:border-r xl:border-border-light/60">
        <header className="dash-rise" style={rise(0.05)}>
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-quaternary">
            {dateLine}
          </div>
          <h1 className="mt-3 text-3xl font-semibold leading-[1.1] tracking-[-0.025em] text-fg-primary sm:text-[40px]">
            {firstName
              ? t(`greeting.${greeting}`, { name: firstName })
              : t(`greetingPlain.${greeting}`)}
          </h1>
          <p className="mt-2.5 max-w-2xl text-base leading-[1.55] text-fg-tertiary">
            {stats.totalTasks === 0
              ? t("summaryEmpty")
              : t("summary", {
                  due: stats.dueToday,
                  overdue: stats.overdue,
                  projects: stats.projectCount,
                })}
          </p>
        </header>

        <StatGrid
          progress={p}
          items={[
            { label: t("stats.dueToday"), value: stats.dueToday },
            { label: t("stats.overdue"), value: stats.overdue, tone: "danger" },
            { label: t("stats.openThisWeek"), value: stats.openThisWeek },
            { label: t("stats.completed"), value: stats.completed, tone: "success" },
          ]}
        />

        <section className="dash-rise" style={rise(0.19)}>
          <SectionHead
            title={t("today.title")}
            count={
              today.filter(
                (task) =>
                  task.status !== "completed" && pendingDone.get(task.id) !== true,
              ).length
            }
            actionLabel={t("today.action")}
            actionHref="/progress"
          />
          <div className="border-t border-border-light/60">
            {isLoading ? (
              <SkeletonRows rows={3} />
            ) : today.length === 0 ? (
              <EmptyRow message={t("today.empty")} />
            ) : (
              todayRows.map(({ item: task, leaving }) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  state={
                    pendingDone.get(task.id) === true
                      ? "done"
                      : taskState(task, now)
                  }
                  disabled={updateStatus.isPending}
                  leaving={leaving}
                  onToggle={() => toggleTask(task)}
                />
              ))
            )}
          </div>
        </section>

        <section className="dash-rise" style={rise(0.26)}>
          <SectionHead title={t("week.title")} actionLabel={t("week.action")} actionHref="/calendar" />
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-border-light/60 bg-border-light/60 sm:grid-cols-5">
            {week.map((day, index) => (
              <WeekCell
                key={day.date.toISOString()}
                day={day}
                index={index}
                max={Math.max(1, ...week.map((d) => d.count))}
                locale={locale}
                todayLabel={t("week.today")}
              />
            ))}
          </div>
        </section>

        {activity.length > 0 && (
          <section className="dash-rise" style={rise(0.33)}>
            <SectionHead
              title={t("activity.title")}
              actionLabel={t("activity.action")}
              actionHref="/progress"
            />
            <div className="border-t border-border-light/60">
              {activity.map((row) => (
                <ActivityItem key={row.id} row={row} now={now} />
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="flex flex-col gap-[30px] px-4 pt-9 pb-14 sm:px-8">
        <WorkspaceRing
          progress={p}
          percent={stats.percent}
          completed={stats.completed}
          total={stats.totalTasks}
          inProgress={stats.inProgress}
          todo={stats.todo}
          dayGone={dayGone}
        />

        <section className="dash-rise" style={rise(0.2)}>
          <SectionHead
            small
            title={t("projects.title")}
            count={summaries.length}
            actionLabel={t("projects.action")}
            actionHref="/projects"
          />
          {summaries.length === 0 ? (
            <Link
              href="/projects?new=1"
              className="flex items-center gap-2 rounded-[10px] border border-dashed border-border-light/70 px-4 py-5 text-sm text-fg-tertiary transition-colors hover:border-accent-primary/50 hover:text-fg-primary"
            >
              <Plus size={16} />
              {t("projects.empty")}
            </Link>
          ) : (
            <div className="flex flex-col gap-2.5">
              {summaries.slice(0, 4).map((project) => (
                <ProjectCard key={project.id} project={project} progress={p} />
              ))}
            </div>
          )}
        </section>

        <section className="dash-rise" style={rise(0.28)}>
          <SectionHead small title={t("notes.title")} actionLabel={t("notes.action")} actionHref="/notes" />
          {notes.length === 0 ? (
            <Link
              href="/notes"
              className="flex items-center gap-2 rounded-[10px] border border-dashed border-border-light/70 px-4 py-5 text-sm text-fg-tertiary transition-colors hover:border-accent-primary/50 hover:text-fg-primary"
            >
              <Plus size={16} />
              {t("notes.empty")}
            </Link>
          ) : (
            <div className="flex flex-col gap-px overflow-hidden rounded-[10px] border border-border-light/60 bg-border-light/60">
              {notes.map((note) => (
                <Link
                  key={note.id}
                  href="/notes"
                  className="bg-bg-elevated px-[18px] py-4 transition-colors duration-[350ms] hover:bg-accent-primary/[0.06]"
                >
                  <div className="truncate text-sm font-semibold text-fg-primary">
                    {(note.title?.trim() ?? "") || t("notes.untitled")}
                  </div>
                  <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-quaternary">
                    {note.shareStatus === "private" ? t("notes.private") : t("notes.shared")} ·{" "}
                    {relativeTime(note.updatedAt ?? note.createdAt, now)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

/**
 * The workspace ring: completion on the outer arc, the day itself on the thin
 * inner one. Two unrelated readings share the space because they answer the
 * same question — how much is left.
 */
function WorkspaceRing({
  progress,
  percent,
  completed,
  total,
  inProgress,
  todo,
  dayGone,
}: {
  progress: number;
  percent: number;
  completed: number;
  total: number;
  inProgress: number;
  todo: number;
  dayGone: number;
}) {
  const t = useTranslations("dashboard");
  // The entrance sweeps from zero via `progress`; afterwards the tween is what
  // carries the ring and the number to a new completion figure.
  const shown = useTween(percent);

  return (
    <div
      className="dash-rise flex flex-col items-center gap-[18px] rounded-xl border border-border-light/60 bg-bg-elevated p-6"
      style={rise(0.1)}
    >
      <div className="flex w-full items-baseline justify-between">
        <span className="text-[13px] font-semibold text-fg-secondary">{t("workspace.title")}</span>
        <span className="font-mono text-[11px] text-fg-quaternary">
          {completed} / {total}
        </span>
      </div>

      <div className="relative h-[200px] w-[200px]">
        <svg viewBox="0 0 200 200" className="dash-fade block h-[200px] w-[200px]" style={rise(0.15)}>
          <circle
            cx="100"
            cy="100"
            r="82"
            fill="none"
            strokeWidth="12"
            className="stroke-border-light/70"
          />
          <circle
            cx="100"
            cy="100"
            r="82"
            fill="none"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={RING_TASKS}
            strokeDashoffset={dashOffset(RING_TASKS, shown / 100, progress)}
            transform="rotate(-90 100 100)"
            className="stroke-accent-primary"
          />
          {/* The day ring is only legible next to the task ring. With no tasks
              the outer arc is empty, and this inner one — which tracks the
              clock, not the work — became the only arc on the card, reading as
              though the workspace were three-quarters done at 0%. Drop both it
              and its track in that case. */}
          {total > 0 && (
            <>
              <circle
                cx="100"
                cy="100"
                r="62"
                fill="none"
                strokeWidth="4"
                className="stroke-border-light/50"
              />
              <circle
                cx="100"
                cy="100"
                r="62"
                fill="none"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={RING_DAY}
                strokeDashoffset={dashOffset(RING_DAY, dayGone, progress)}
                transform="rotate(-90 100 100)"
                className="stroke-dash-day"
              />
            </>
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="text-[44px] font-semibold tabular-nums tracking-[-0.03em] text-fg-primary">
            {Math.round(shown * progress)}%
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-quaternary">
            {t("workspace.ofTasks", { done: completed, total })}
          </span>
        </div>
      </div>

      <div className="flex w-full flex-col gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-tertiary">
          <span className="h-2 w-2 rounded-full bg-dash-day" aria-hidden />
          <span>{t("workspace.dayGone", { percent: Math.round(dayGone * 100) })}</span>
        </div>
        <div className="flex flex-wrap gap-3.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-quaternary">
          <span className="text-success">{t("workspace.done", { count: completed })}</span>
          <span className="text-warning">{t("workspace.active", { count: inProgress })}</span>
          <span>{t("workspace.todo", { count: todo })}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * First run: no projects at all. The populated grid would be a page of zeroes,
 * so this says what to do instead — and the day arc still runs, which is the
 * point the design makes about an empty dashboard.
 */
function FirstRun({
  dayGone,
  now,
  locale,
}: {
  dayGone: number;
  now: Date;
  locale: string;
}) {
  const t = useTranslations("dashboard");
  const toast = useToast();
  const utils = api.useUtils();
  const [code, setCode] = useState("");
  const p = useEntrance(true);

  const join = api.organization.join.useMutation({
    onSuccess: async () => {
      setCode("");
      toast.success(t("firstRun.joined"));
      await Promise.all([
        utils.organization.invalidate(),
        utils.project.getMyProjects.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const timeLeft = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);

  return (
    <div className="grid min-h-[760px] grid-cols-1 items-stretch xl:grid-cols-[minmax(0,1fr)_392px]">
      <div className="flex flex-col justify-center gap-9 px-6 py-16 sm:px-16 sm:py-24 xl:border-r xl:border-border-light/60">
        <div className="dash-rise" style={rise(0.08)}>
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-dash-day">
            {t("firstRun.tag")}
          </div>
          <h1 className="mt-4 max-w-[620px] text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-fg-primary sm:text-[46px]">
            {t("firstRun.title")}
          </h1>
          <p className="mt-3.5 max-w-[520px] text-[17px] leading-[1.6] text-fg-tertiary">
            {t("firstRun.body")}
          </p>
        </div>

        <div className="dash-rise flex flex-wrap items-center gap-3.5" style={rise(0.18)}>
          <Link
            href="/projects?new=1"
            className="flex items-center gap-2.5 rounded-[10px] bg-accent-primary px-[22px] py-[15px] text-[15px] font-semibold text-white transition-all duration-[350ms] hover:-translate-y-0.5 hover:bg-accent-hover"
          >
            <Plus size={17} />
            {t("firstRun.createProject")}
          </Link>

          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-quaternary">
            {t("firstRun.or")}
          </span>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = code.trim();
              if (trimmed) join.mutate({ code: trimmed });
            }}
            className="flex items-stretch overflow-hidden rounded-[10px] border border-border-medium/70 transition-colors duration-[350ms] focus-within:border-dash-day/60 hover:border-dash-day/60"
          >
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              aria-label={t("firstRun.codeLabel")}
              placeholder={t("firstRun.codePlaceholder")}
              className="w-[150px] bg-transparent px-4 py-3.5 font-mono text-[13px] tracking-[0.22em] text-fg-primary outline-none placeholder:text-fg-quaternary"
            />
            <span className="w-px self-stretch bg-border-medium/70" aria-hidden />
            <button
              type="submit"
              disabled={join.isPending || code.trim().length === 0}
              className="px-[18px] py-3.5 text-sm font-semibold text-dash-day transition-opacity disabled:opacity-50"
            >
              {t("firstRun.joinCode")}
            </button>
          </form>
        </div>

        <div className="dash-rise flex flex-wrap gap-[34px]" style={rise(0.28)}>
          {(["step1", "step2", "step3"] as const).map((step, index) => (
            <div key={step} className="max-w-[210px]">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-quaternary">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="mt-2 text-sm leading-[1.55] text-fg-tertiary">
                {t(`firstRun.${step}`)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <aside className="flex flex-col items-center justify-center gap-[22px] px-8 py-16 sm:py-24">
        <div className="dash-fade relative h-[200px] w-[200px]" style={rise(0.3)}>
          <svg viewBox="0 0 200 200" className="block h-[200px] w-[200px]">
            <circle
              cx="100"
              cy="100"
              r="82"
              fill="none"
              strokeWidth="12"
              strokeDasharray="3 9"
              className="stroke-border-light/60"
            />
            <circle
              cx="100"
              cy="100"
              r="62"
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={RING_DAY}
              strokeDashoffset={dashOffset(RING_DAY, dayGone, p)}
              transform="rotate(-90 100 100)"
              opacity="0.8"
              className="stroke-dash-day"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-quaternary">
              {t("workspace.dayGone", { percent: Math.round(dayGone * 100) })}
            </span>
            <span className="text-[15px] font-semibold text-fg-secondary">{timeLeft}</span>
          </div>
        </div>
        <p className="max-w-[250px] text-center text-sm leading-[1.6] text-fg-quaternary">
          {t("firstRun.aside")}
        </p>
      </aside>
    </div>
  );
}

function StatGrid({
  items,
  progress,
}: {
  items: { label: string; value: number; tone?: "danger" | "success" }[];
  progress: number;
}) {
  return (
    <div
      className="dash-rise grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-border-light/60 bg-border-light/60 sm:grid-cols-4"
      style={rise(0.12)}
    >
      {items.map((item) => (
        <StatCell key={item.label} item={item} progress={progress} />
      ))}
    </div>
  );
}

function StatCell({
  item,
  progress,
}: {
  item: { label: string; value: number; tone?: "danger" | "success" };
  progress: number;
}) {
  const shown = useTween(item.value);

  return (
    <div className="bg-bg-elevated px-5 py-[18px] transition-colors duration-[350ms] hover:bg-bg-tertiary">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-quaternary">
        {item.label}
      </div>
      <div
        className={`mt-2 text-[28px] font-semibold tabular-nums tracking-[-0.02em] ${
          item.value === 0
            ? "text-fg-primary"
            : item.tone === "danger"
              ? "text-error"
              : item.tone === "success"
                ? "text-success"
                : "text-fg-primary"
        }`}
      >
        {Math.round(shown * progress)}
      </div>
    </div>
  );
}

function SectionHead({
  title,
  count,
  actionLabel,
  actionHref,
  small = false,
}: {
  title: string;
  count?: number;
  actionLabel: string;
  actionHref: string;
  small?: boolean;
}) {
  return (
    <div className="flex items-center justify-between pb-3">
      <h2
        className={`m-0 font-semibold tracking-[-0.01em] text-fg-primary ${
          small ? "text-[15px]" : "text-[17px]"
        }`}
      >
        {title}
        {typeof count === "number" && (
          <span className="ml-2 font-normal text-fg-quaternary">{count}</span>
        )}
      </h2>
      <Link
        href={actionHref}
        className={`font-medium text-fg-tertiary transition-colors hover:text-fg-primary ${
          small ? "text-xs" : "text-[13px]"
        }`}
      >
        {actionLabel}
      </Link>
    </div>
  );
}

/** Status reads as a tinted outline only — no fill, so the rows stay quiet. */
const STATE_BADGE: Record<TaskState, string> = {
  done: "border-success/40 text-success",
  overdue: "border-error/40 text-error",
  inProgress: "border-warning/40 text-warning",
  todo: "border-border-medium/60 text-fg-tertiary",
};

function TaskRow({
  task,
  state,
  disabled,
  leaving,
  onToggle,
}: {
  task: CalendarTask;
  state: TaskState;
  disabled: boolean;
  leaving: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("dashboard");
  const isDone = state === "done";

  return (
    <div
      className={`grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-[18px] border-b border-border-light/50 px-1 py-[17px] transition-all duration-[350ms] hover:bg-accent-primary/[0.07] sm:grid-cols-[24px_minmax(0,1fr)_160px_112px_20px] ${
        isDone ? "opacity-50" : ""
      } ${leaving ? "dash-row-out" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={isDone ? t("today.reopen") : t("today.complete")}
        aria-pressed={isDone}
        className={`flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-[1.5px] transition-colors duration-[350ms] disabled:opacity-50 ${
          isDone
            ? "border-accent-primary bg-accent-primary"
            : "border-border-strong/70 hover:border-accent-primary"
        }`}
      >
        <Check
          size={12}
          strokeWidth={3}
          className={`text-white transition-opacity duration-300 ${isDone ? "opacity-100" : "opacity-0"}`}
          aria-hidden
        />
      </button>
      <Link
        href={projectHref(task.projectId)}
        className={`truncate text-base font-medium text-fg-primary hover:text-accent-primary ${
          isDone ? "line-through" : ""
        }`}
      >
        {task.title}
      </Link>
      <span className="hidden truncate text-[13px] text-fg-tertiary sm:block">
        {task.projectTitle}
      </span>
      <span
        className={`justify-self-start rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${STATE_BADGE[state]}`}
      >
        {t(`status.${state}`)}
      </span>
      <Link
        href={projectHref(task.projectId)}
        aria-label={task.title}
        className="hidden text-fg-quaternary transition-colors hover:text-fg-primary sm:block"
      >
        <ChevronRight size={16} aria-hidden />
      </Link>
    </div>
  );
}

/**
 * Weekday column. The rule under each count is the load: purple for today, cyan
 * fading with volume for the days ahead, flat when a day is clear.
 */
function WeekCell({
  day,
  index,
  max,
  locale,
  todayLabel,
}: {
  day: WeekDay;
  index: number;
  max: number;
  locale: string;
  todayLabel: string;
}) {
  const label = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" })
    .format(day.date)
    .toUpperCase();

  const share = day.count / max;
  const bar = day.isToday
    ? "bg-accent-primary"
    : day.count === 0
      ? "bg-border-light/70"
      : share >= 0.6
        ? "bg-dash-day/50"
        : "bg-dash-day/[0.32]";

  return (
    <div className="flex flex-col gap-3 bg-bg-elevated px-4 py-[18px] transition-colors duration-[350ms] hover:bg-bg-tertiary">
      <span
        className={`font-mono text-[10px] tracking-[0.12em] ${
          day.isToday ? "text-accent-secondary" : "text-fg-quaternary"
        }`}
      >
        {label}
        {day.isToday ? ` · ${todayLabel}` : ""}
      </span>
      <span
        className={`text-[26px] font-semibold tabular-nums tracking-[-0.02em] ${
          day.count === 0 ? "text-fg-quaternary" : "text-fg-primary"
        }`}
      >
        {day.count}
      </span>
      <span
        className={`h-[3px] rounded-sm ${bar} ${day.count === 0 ? "" : "dash-grow"}`}
        style={day.count === 0 ? undefined : { animationDelay: `${0.3 + index * 0.07}s` }}
        aria-hidden
      />
    </div>
  );
}

/**
 * A card's own chrome — its outline and completion ring — is always the accent,
 * so the projects rail belongs to whatever theme the user picked. Health is a
 * separate reading and lives only in the status line beneath the title; letting
 * it repaint the whole card made a project with one overdue task look like an
 * error state rather than a project.
 */
const PROJECT_BORDER = "border-accent-primary/35 hover:border-accent-primary/70";
const PROJECT_RING = "stroke-accent-primary";

const PROJECT_HEALTH_TEXT = {
  onTrack: "text-accent-secondary",
  inProgress: "text-warning",
  atRisk: "text-error",
} as const;

function ProjectCard({ project, progress }: { project: ProjectSummary; progress: number }) {
  const t = useTranslations("dashboard");
  const title = (project.title?.trim() ?? "") || t("projects.untitled");
  const percent = project.percent ?? 0;
  const shown = useTween(percent);

  if (project.health === "empty") {
    return (
      <Link
        href={projectHref(project.id)}
        className="flex items-center justify-between gap-3 rounded-[10px] border border-border-light/60 bg-bg-elevated px-[18px] py-4 transition-all duration-[400ms] hover:-translate-y-0.5 hover:border-border-strong/60"
      >
        <span className="truncate text-[15px] font-semibold text-fg-tertiary">{title}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-fg-quaternary">
          {t("projects.noTasks")}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={projectHref(project.id)}
      className={`flex items-center gap-4 rounded-[10px] border bg-bg-elevated px-[18px] py-4 transition-all duration-[400ms] hover:-translate-y-0.5 ${PROJECT_BORDER}`}
    >
      <span className="relative h-[46px] w-[46px] flex-none">
        <svg viewBox="0 0 46 46" className="block h-[46px] w-[46px]">
          <circle cx="23" cy="23" r="19" fill="none" strokeWidth="5" className="stroke-border-light/70" />
          <circle
            cx="23"
            cy="23"
            r="19"
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={RING_PROJECT}
            strokeDashoffset={dashOffset(RING_PROJECT, shown / 100, progress)}
            transform="rotate(-90 23 23)"
            className={PROJECT_RING}
          />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-fg-primary">{title}</span>
        <span
          className={`mt-1 block font-mono text-[10px] uppercase tracking-[0.1em] ${PROJECT_HEALTH_TEXT[project.health]}`}
        >
          {t(`projects.health.${project.health}`)} · {t("projects.open", { count: project.openCount })}
        </span>
      </span>
      <span className="font-mono text-[13px] tabular-nums text-fg-primary">
        {Math.round(shown * progress)}%
      </span>
    </Link>
  );
}

function ActivityItem({ row, now }: { row: ActivityRow; now: Date }) {
  const t = useTranslations("dashboard");
  const who = row.user?.name ?? row.user?.email ?? t("activity.someone");
  const initial = who.trim().charAt(0).toUpperCase() || "?";

  const kind =
    row.action === "status_changed" && row.newValue === "completed"
      ? "completed"
      : row.action === "created"
        ? "created"
        : row.action === "deleted"
          ? "deleted"
          : "updated";

  const message = t(`activity.actions.${kind}`, {
    user: who,
    task: row.taskTitle ?? t("activity.aTask"),
    project: row.projectTitle ?? t("projects.untitled"),
  });

  const body = (
    <>
      <span
        style={avatarGradientStyle(row.user?.id ?? row.user?.email ?? who)}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-full text-[11px] font-semibold text-white"
      >
        {initial}
      </span>
      <span className="truncate text-[15px] text-fg-secondary">{message}</span>
      <span className="justify-self-end font-mono text-[10px] text-fg-quaternary">
        {relativeTime(row.createdAt, now)}
      </span>
    </>
  );

  const className =
    "grid grid-cols-[28px_minmax(0,1fr)_64px] items-center gap-4 border-b border-border-light/50 px-1 py-[15px] transition-colors duration-[350ms] hover:bg-dash-day/[0.06]";

  return row.projectId ? (
    <Link href={projectHref(row.projectId)} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-b border-border-light/50 px-1 py-4">
          <div className="h-4 w-2/3 animate-pulse rounded bg-bg-tertiary" />
        </div>
      ))}
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return <div className="px-1 py-6 text-sm text-fg-tertiary">{message}</div>;
}

/** Compact age stamp — `20M`, `3H`, `1D` — matching the mono accents. */
function relativeTime(value: Date | string | null, now: Date): string {
  if (!value) return "";
  const then = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(then.getTime())) return "";
  const minutes = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60000));
  if (minutes < 1) return "NOW";
  if (minutes < 60) return `${minutes}M`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}H`;
  return `${Math.round(hours / 24)}D`;
}
