"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { useAgentLabel } from "~/components/agents/useAgentLabel";
import { useSkeletonHold } from "~/hooks/useSkeletonHold";
import { DashboardSkeleton } from "./DashboardSkeleton";
import { RadarFindings } from "./RadarFindings";
import {
  daysLate,
  headlineStats,
  nextRunAt,
  nextUp,
  projectStatusRows,
  relativeShort,
  startOfDay,
  weekOutput,
  weekStrip,
  type CalendarEvent,
  type CalendarTask,
  type ProjectStatusRow,
  type WeekDay,
} from "./dashboardData";

/** Project detail lives behind the create flow — see `ProjectsWorkspace`. */
const projectHref = (id: number) => `/projects?projectId=${id}`;

/** A chat with its first message already typed — how the page hands off to the crew. */
const chatHref = (prompt: string) =>
  `/chat/ai?prefill=${encodeURIComponent(prompt)}`;

/** The card shell shared by every panel on the page. */
const CARD =
  "overflow-hidden rounded-[14px] border border-tui-ink/10 bg-tui-pane shadow-[var(--tui-pane-shadow)]";

/** Side padding every card row shares, so their contents line up. */
const PAD = "px-[18px] sm:px-7";

/** The small spaced capitals used for labels across the page. */
const EYEBROW =
  "text-tui-ink3 text-[10.5px] font-medium tracking-[0.18em] uppercase";

/** A day with this many open tasks is called out in the week strip. */
const HEAVY_DAY = 6;

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
 * Eased 0 → 1 over the entrance, driving both the counting numbers and the bar
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
 * so this starts settled and only animates the *changes*.
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

/** Blocks stage in on a shared curve; the delay is what separates them. */
const rise = (delay: number) => ({ animationDelay: `${delay}s` });

/** Health is a dot beside a word; colour stays off everything else. */
const HEALTH_DOT = {
  onTrack: "bg-tui-ok",
  inProgress: "bg-tui-warn",
  atRisk: "bg-tui-danger",
  empty: "bg-tui-ink/30",
} as const;

/** A serif monogram in a bordered circle — the refined edition's avatar. */
function Initial({
  label,
  size = 26,
  agent = false,
}: {
  label: string;
  size?: number;
  agent?: boolean;
}) {
  return (
    <span
      className={`font-display flex shrink-0 items-center justify-center rounded-full border ${
        agent
          ? "border-tui-accent/35 text-tui-accent bg-tui-pane italic"
          : "border-tui-ink/14 bg-tui-pane text-tui-ink2"
      }`}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {label.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** The header row a card wears: a serif title, a caption, an optional link, a hairline. */
function CardHead({
  title,
  meta,
  actionLabel,
  actionHref,
}: {
  title: string;
  meta?: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <>
      <div className={`flex items-baseline gap-3 ${PAD} pt-[22px] pb-4`}>
        <h2 className="font-display text-tui-ink m-0 text-[24px] leading-none tracking-[-0.005em]">
          {title}
        </h2>
        {meta && (
          <span className="text-tui-ink3 hidden truncate text-[12.5px] sm:inline">
            {meta}
          </span>
        )}
        <span className="flex-1" />
        {actionLabel && actionHref && (
          <Link
            href={actionHref}
            className="text-tui-ink3 hover:text-tui-ink shrink-0 text-[12.5px] transition-colors"
          >
            {actionLabel} →
          </Link>
        )}
      </div>
      <div className="bg-tui-ink/8 mx-[18px] h-px sm:mx-7" />
    </>
  );
}

export function DashboardClient({
  userName,
  userId = null,
}: {
  userName: string | null;
  /** Whose "next up" this is — tasks assigned to anyone else are left out. */
  userId?: string | null;
}) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const agents = useAgentLabel();

  const projectsQuery = api.project.getMyProjects.useQuery();
  const activityQuery = api.task.getOrgActivity.useQuery({
    limit: 6,
    scope: "all",
  });
  const pulseQuery = api.progress.getPulse.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const briefQuery = api.agent.latestBrief.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const range = useMemo(() => {
    const from = startOfDay(new Date());
    from.setDate(from.getDate() - 60);
    const to = startOfDay(new Date());
    to.setDate(to.getDate() + 21);
    return { from, to };
  }, []);

  const calendarQuery = api.task.getForCalendar.useQuery(range);

  const now = useMemo(() => new Date(), []);
  const projects = useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data],
  );
  const calendarTasks = useMemo<CalendarTask[]>(
    () => calendarQuery.data?.tasks ?? [],
    [calendarQuery.data],
  );
  const calendarEvents = useMemo<CalendarEvent[]>(
    () => calendarQuery.data?.events ?? [],
    [calendarQuery.data],
  );

  const stats = useMemo(() => headlineStats(projects, now), [projects, now]);
  const rows = useMemo(() => projectStatusRows(projects, now), [projects, now]);
  const output = useMemo(
    () => weekOutput(pulseQuery.data?.completions ?? [], now),
    [pulseQuery.data, now],
  );
  const queue = useMemo(
    () => nextUp(calendarTasks, userId),
    [calendarTasks, userId],
  );
  const week = useMemo(
    () => weekStrip(calendarTasks, calendarEvents, now),
    [calendarTasks, calendarEvents, now],
  );
  const team = pulseQuery.data?.team ?? [];

  const oldestOverdueDays = useMemo(() => {
    let oldest = 0;
    for (const task of calendarTasks) {
      if (task.status === "completed") continue;
      oldest = Math.max(oldest, daysLate(task.dueDate, now));
    }
    return oldest;
  }, [calendarTasks, now]);

  const doneToday = useMemo(() => {
    const today = startOfDay(now).getTime();
    return calendarTasks.filter(
      (task) =>
        task.status === "completed" &&
        !!task.dueDate &&
        startOfDay(new Date(task.dueDate)).getTime() === today,
    ).length;
  }, [calendarTasks, now]);

  const projectTitles = useMemo(
    () =>
      new Map(projects.map((project) => [project.id, project.title] as const)),
    [projects],
  );

  const activity = ((activityQuery.data?.rows ?? []) as ActivityRow[]).slice(
    0,
    5,
  );

  const isLoading = useSkeletonHold(
    projectsQuery.isLoading || calendarQuery.isLoading,
  );
  const isFirstRun = !isLoading && projects.length === 0;

  const p = useEntrance(!isLoading);

  const dateLine = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const clock = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);

  const hour = now.getHours();
  const greeting = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = (userName ?? "").trim().split(" ")[0] ?? "";

  if (isLoading) {
    return (
      <DashboardSkeleton
        userName={userName}
        onRetry={() => {
          void projectsQuery.refetch();
          void calendarQuery.refetch();
        }}
      />
    );
  }
  if (isFirstRun) {
    return (
      <div className="min-h-full">
        <FirstRun
          now={now}
          locale={locale}
          userName={userName}
        />
      </div>
    );
  }

  const brief = briefQuery.data?.message?.trim() ?? "";
  const briefAt = briefQuery.data?.createdAt
    ? new Date(briefQuery.data.createdAt)
    : null;

  const dueTotal = stats.dueToday + doneToday;
  const weekDiff = output.thisWeek - output.lastWeek;

  return (
    <div className="text-tui-ink min-h-full">
      <div className="mx-auto max-w-[1240px] px-4 pt-8 pb-16 sm:px-8 sm:pt-14 lg:px-12 lg:pb-24">
        {/* The headline: open on the page, no card. */}
        <section
          className="dash-rise border-tui-ink/10 grid grid-cols-1 items-end gap-6 border-b pb-7 sm:pb-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-12"
          style={rise(0.04)}
        >
          <div className="min-w-0">
            <span className={EYEBROW}>{dateLine}</span>
            <h1 className="font-display mt-3.5 mb-5 text-[44px] leading-[0.98] font-normal tracking-[-0.025em] sm:text-[60px] lg:text-[72px]">
              {firstName ? (
                <>
                  {t(`greetingPlain.${greeting}`)},{" "}
                  <em className="text-tui-accent">{firstName}.</em>
                </>
              ) : (
                t(`greetingPlain.${greeting}`)
              )}
            </h1>
            <p className="text-tui-ink2 m-0 max-w-[620px] text-[16px] leading-[1.7] text-pretty">
              {brief ||
                (stats.totalTasks === 0
                  ? t("summaryEmpty")
                  : t("summary", {
                      due: stats.dueToday,
                      overdue: stats.overdue,
                      projects: stats.projectCount,
                    }))}
            </p>
            {brief && briefAt && (
              <div className="text-tui-ink3 mt-5 flex items-center gap-2.5 text-[12.5px]">
                <span className="bg-tui-ink/25 h-px w-6" aria-hidden />
                <span>
                  {t.rich("brief.signed", {
                    name: agents.name("daily_brief"),
                    time: clock(briefAt),
                    agent: (chunks) => (
                      <i className="font-display text-tui-ink2 text-[15px]">
                        {chunks}
                      </i>
                    ),
                  })}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 lg:flex-col lg:items-end">
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("kairos:openAI"))
              }
              className="border-tui-ink/14 text-tui-ink2 hover:border-tui-ink/30 hover:text-tui-ink flex h-[34px] items-center rounded-full border px-3.5 text-[13px] whitespace-nowrap transition-colors"
            >
              {t("brief.ask")}
            </button>
            <Link
              href={chatHref(t("brief.planPrompt"))}
              className="border-tui-ink/14 text-tui-ink2 hover:border-tui-ink/30 hover:text-tui-ink flex h-[34px] items-center rounded-full border px-3.5 text-[13px] whitespace-nowrap transition-colors"
            >
              {t("brief.planWeek")}
            </Link>
          </div>
        </section>

        {/* The day in four figures, set like a printed report. */}
        <section
          className="dash-rise grid grid-cols-2 gap-y-6 pt-6 pb-9 sm:pt-7 sm:pb-14 lg:grid-cols-4"
          style={rise(0.1)}
        >
          <Figure
            index={0}
            label={t("stats.dueToday")}
            value={doneToday}
            of={dueTotal}
            note={
              dueTotal === 0
                ? t("stats.notes.nothingDue")
                : t("stats.notes.left", { count: stats.dueToday })
            }
            progress={p}
          />
          <Figure
            index={1}
            label={t("stats.overdue")}
            value={stats.overdue}
            tone={stats.overdue > 0 ? "danger" : undefined}
            note={
              stats.overdue > 0 && oldestOverdueDays > 0
                ? t("stats.notes.oldestDays", { days: oldestOverdueDays })
                : t("stats.notes.onTime")
            }
            progress={p}
          />
          <Figure
            index={2}
            label={t("stats.openThisWeek")}
            value={stats.openThisWeek}
            note={t("stats.notes.acrossProjects", {
              count: stats.projectCount,
            })}
            progress={p}
          />
          <Figure
            index={3}
            label={t("stats.doneThisWeek")}
            value={output.thisWeek}
            note={
              weekDiff > 0
                ? t("stats.notes.more", { count: weekDiff })
                : weekDiff < 0
                  ? t("stats.notes.fewer", { count: -weekDiff })
                  : t("stats.notes.same")
            }
            progress={p}
          />
        </section>

        <div className="grid grid-cols-1 items-start gap-7 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-7">
            <NextUpCard
              tasks={queue}
              now={now}
              locale={locale}
              plannerName={agents.name("task_planner")}
            />

            <RadarFindings
              className="dash-rise"
              style={rise(0.2)}
              now={now}
              projectTitles={projectTitles}
              agentName={agents.name("risk_radar")}
            />

            <section className={`dash-rise ${CARD}`} style={rise(0.26)}>
              <CardHead
                title={t("projectStatus.title")}
                meta={t("projectStatus.count", { count: rows.length })}
                actionLabel={t("projectStatus.action")}
                actionHref="/projects"
              />
              <ProjectList rows={rows} progress={p} locale={locale} />
            </section>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-7 sm:grid-cols-2 xl:grid-cols-1">
            <WeekCard days={week} locale={locale} />
            <TeamCard members={team} now={now} />
            {activity.length > 0 && (
              <section className={`dash-rise ${CARD}`} style={rise(0.3)}>
                <CardHead
                  title={t("activity.title")}
                  actionLabel={t("activity.action")}
                  actionHref="/progress"
                />
                <ul className="m-0 list-none py-1.5 pb-3.5">
                  {activity.map((row) => (
                    <ActivityItem key={row.id} row={row} now={now} />
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>

        <CrewLine now={now} locale={locale} />
      </div>
    </div>
  );
}

/** One of the four headline figures: a label, a big serif number, a footnote. */
function Figure({
  index,
  label,
  value,
  of,
  note,
  tone,
  progress,
}: {
  index: number;
  label: string;
  value: number;
  /** Set for a "done of total" figure: prints `/total` and draws a hairline bar. */
  of?: number;
  note: string;
  tone?: "danger";
  progress: number;
}) {
  const shown = Math.round(useTween(value) * progress);
  // Hairlines between figures: every other one on a phone, all but the first wide.
  const divider =
    index === 0
      ? ""
      : index % 2 === 1
        ? "border-l pl-5 sm:pl-7 lg:px-7"
        : "pr-5 lg:border-l lg:px-7";

  return (
    <div
      className={`border-tui-ink/10 flex min-w-0 flex-col gap-2 ${divider}`}
    >
      <span className={EYEBROW}>{label}</span>
      <b
        className={`font-display text-[42px] leading-[0.9] font-normal tracking-[-0.02em] tabular-nums sm:text-[52px] ${
          tone === "danger" ? "text-tui-danger" : ""
        }`}
      >
        {shown}
        {of !== undefined && of > 0 && (
          <span className="text-tui-ink3 text-[24px] tracking-normal">
            /{of}
          </span>
        )}
      </b>
      {of !== undefined && (
        <span className="bg-tui-ink/8 mt-1 h-[2px] max-w-[200px] overflow-hidden rounded-full">
          <span
            className="bg-tui-ink block h-full rounded-full"
            style={{
              width: `${of > 0 ? (value / of) * 100 * progress : 0}%`,
            }}
          />
        </span>
      )}
      <small className="text-tui-ink3 text-[12.5px]">{note}</small>
    </div>
  );
}

const ROMAN = ["i.", "ii.", "iii.", "iv.", "v."];

/** The reader's next few tasks, checkable in place. */
function NextUpCard({
  tasks,
  now,
  locale,
  plannerName,
}: {
  tasks: CalendarTask[];
  now: Date;
  locale: string;
  plannerName: string;
}) {
  const t = useTranslations("dashboard");
  const toast = useToast();
  const utils = api.useUtils();
  // Ticked tasks strike through at once and stay until the refetch drops them.
  const [ticked, setTicked] = useState<Set<number>>(() => new Set());

  const complete = api.task.updateStatus.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.task.getForCalendar.invalidate(),
        utils.project.getMyProjects.invalidate(),
        utils.progress.getPulse.invalidate(),
      ]),
    onError: (error, input) => {
      setTicked((prev) => {
        const next = new Set(prev);
        next.delete(input.taskId);
        return next;
      });
      toast.error(error.message);
    },
  });

  const dueLabel = (task: CalendarTask) => {
    const late = daysLate(task.dueDate, now);
    if (late > 0)
      return { tone: "bg-tui-danger", text: t("nextUp.overdue", { days: late }) };
    const due = new Date(task.dueDate!);
    if (startOfDay(due).getTime() === startOfDay(now).getTime())
      return { tone: "bg-tui-warn", text: t("nextUp.today") };
    return {
      tone: "bg-tui-day",
      text: new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "short",
      }).format(due),
    };
  };

  return (
    <section className={`dash-rise ${CARD}`} style={rise(0.14)}>
      <CardHead
        title={t("nextUp.title")}
        meta={t("nextUp.meta")}
        actionLabel={t("nextUp.replan", { name: plannerName })}
        actionHref={chatHref(t("brief.planPrompt"))}
      />
      {tasks.length === 0 ? (
        <p className={`text-tui-ink2 m-0 ${PAD} py-6 text-[14px]`}>
          {t("nextUp.empty")}
        </p>
      ) : (
        <ol className="m-0 list-none py-1 pb-2.5">
          {tasks.map((task, index) => {
            const done = ticked.has(task.id);
            const due = dueLabel(task);
            const urgent =
              task.priority === "urgent" || task.priority === "high";

            return (
              <li
                key={task.id}
                className={`border-tui-ink/6 hover:bg-tui-ink/[0.022] relative grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-2.5 border-t py-4 transition-colors first:border-t-0 sm:grid-cols-[34px_minmax(0,1fr)_auto] sm:gap-3.5 ${PAD}`}
              >
                <span className="font-display text-tui-ink3 text-[20px] leading-[1.2] italic">
                  {ROMAN[index]}
                </span>
                <div className="min-w-0">
                  <Link
                    href={projectHref(task.projectId)}
                    className={`block truncate text-[15px] font-medium tracking-[-0.005em] ${
                      done
                        ? "text-tui-ink3 decoration-tui-ink/30 line-through"
                        : ""
                    }`}
                  >
                    {task.title}
                  </Link>
                  <div className="text-tui-ink3 mt-1 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px]">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${due.tone}`}
                        aria-hidden
                      />
                      {due.text}
                    </span>
                    <span>
                      {(task.projectTitle?.trim() ?? "") ||
                        t("projects.untitled")}
                    </span>
                    {urgent && (
                      <span>{t(`nextUp.priority.${task.priority}`)}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={t("nextUp.markDone", { task: task.title })}
                  aria-pressed={done}
                  disabled={done}
                  onClick={() => {
                    setTicked((prev) => new Set(prev).add(task.id));
                    complete.mutate({ taskId: task.id, status: "completed" });
                  }}
                  className={`mt-0.5 grid h-5 w-5 place-items-center rounded-full border-[1.25px] transition-colors ${
                    done
                      ? "border-tui-ink bg-tui-ink"
                      : "border-tui-ink/28 hover:border-tui-ink/60"
                  }`}
                >
                  {done && (
                    <svg
                      viewBox="0 0 12 12"
                      className="stroke-tui-pane h-2.5 w-2.5"
                      fill="none"
                      strokeWidth="1.8"
                      aria-hidden
                    >
                      <path d="M2.5 6.2 5 8.5l4.5-5" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Each project as a pace line: how much is done against how much time has gone. */
function ProjectList({
  rows,
  progress,
  locale,
}: {
  rows: ProjectStatusRow[];
  progress: number;
  locale: string;
}) {
  const t = useTranslations("dashboard");

  if (rows.length === 0) {
    return (
      <div className={`${PAD} py-6`}>
        <Link
          href="/projects?new=1"
          className="border-tui-ink/16 text-tui-ink2 hover:border-tui-accent/50 hover:text-tui-ink flex items-center gap-2 rounded-lg border border-dashed px-4 py-5 text-[13px] transition-colors"
        >
          <Plus size={16} />
          {t("projects.empty")}
        </Link>
      </div>
    );
  }

  return (
    <div className="py-1 pb-2">
      {rows.map((row) => (
        <ProjectRow
          key={row.id}
          row={row}
          progress={progress}
          locale={locale}
        />
      ))}
    </div>
  );
}

function ProjectRow({
  row,
  progress,
  locale,
}: {
  row: ProjectStatusRow;
  progress: number;
  locale: string;
}) {
  const t = useTranslations("dashboard");
  const percent = Math.round(useTween(row.percent) * progress);
  const behind = row.elapsed !== null && row.percent + 5 < row.elapsed;

  return (
    <div
      className={`group border-tui-ink/6 hover:bg-tui-ink/[0.022] relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 border-t py-4 transition-colors first:border-t-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_110px] sm:gap-x-7 ${PAD}`}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <Link
          href={projectHref(row.id)}
          className="truncate text-[14.5px] font-medium after:absolute after:inset-0 after:content-['']"
        >
          {(row.title?.trim() ?? "") || t("projects.untitled")}
        </Link>
        <span className="text-tui-ink3 truncate text-[12px]">
          {row.endsAt
            ? t("projectStatus.ends", {
                date: new Intl.DateTimeFormat(locale, {
                  day: "numeric",
                  month: "short",
                }).format(row.endsAt),
              })
            : t("projectStatus.noDate")}
          {" · "}
          {t("projectStatus.openCount", { count: row.open })}
        </span>
      </span>

      <span className="order-3 col-span-full sm:order-none sm:col-span-1">
        <span className="bg-tui-ink/8 relative block h-[3px] rounded-full">
          <span
            className={`absolute inset-y-0 left-0 rounded-full ${
              behind ? "bg-tui-danger" : "bg-tui-ink/75"
            }`}
            style={{ width: `${percent}%` }}
          />
          {row.elapsed !== null && (
            <span
              className="bg-tui-accent absolute -top-[5px] h-[13px] w-px"
              style={{ left: `${row.elapsed}%` }}
              aria-hidden
            />
          )}
        </span>
        <span className="text-tui-ink3 mt-2 flex justify-between text-[11.5px] tabular-nums">
          <span>{t("projectStatus.done", { percent })}</span>
          <span>
            {!row.endsAt
              ? t("projectStatus.noDeadline")
              : row.elapsed !== null
                ? t("projectStatus.timeUsed", { percent: row.elapsed })
                : null}
          </span>
        </span>
      </span>

      <span className="text-tui-ink2 flex items-center justify-end gap-2 text-[12.5px]">
        <span
          className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT[row.health]}`}
          aria-hidden
        />
        {t(`projects.health.${row.health}`)}
      </span>
    </div>
  );
}

/** Monday to Sunday: what is due each day, and what is on the calendar. */
function WeekCard({ days, locale }: { days: WeekDay[]; locale: string }) {
  const t = useTranslations("dashboard");
  const narrow = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  const long = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <section className={`dash-rise ${CARD}`} style={rise(0.18)}>
      <CardHead
        title={t("week.title")}
        actionLabel={t("week.action")}
        actionHref="/calendar"
      />
      <ol className="m-0 grid list-none grid-cols-7 px-2 pt-1.5 pb-5 sm:px-5">
        {days.map((day) => {
          const heavy = day.open >= HEAVY_DAY;
          const missed = day.isPast && day.open > 0;
          const label = [
            long.format(day.date),
            t("week.tasks", { count: day.total }),
            t("week.events", { count: day.events }),
          ].join(", ");

          return (
            <li
              key={day.date.toISOString()}
              aria-label={label}
              title={label}
              className={`flex flex-col items-center gap-1.5 rounded-[10px] py-2.5 ${
                day.isToday ? "bg-tui-ink/[0.045]" : ""
              }`}
            >
              <span className="text-tui-ink3 text-[10px] tracking-[0.12em] uppercase">
                {narrow.format(day.date)}
              </span>
              <span
                className={`font-display text-[21px] leading-none ${
                  day.isToday ? "text-tui-accent" : ""
                } ${day.isPast ? "opacity-45" : ""}`}
              >
                {day.date.getDate()}
              </span>
              <span
                className={`text-[11px] tabular-nums ${
                  heavy ? "text-tui-danger" : "text-tui-ink3"
                } ${day.isPast ? "opacity-45" : ""}`}
              >
                {day.total || "–"}
              </span>
              <span className="flex h-1.5 gap-[3px]" aria-hidden>
                {missed && (
                  <span className="bg-tui-danger h-1.5 w-1.5 rounded-full" />
                )}
                {Array.from({ length: Math.min(3, day.events) }, (_, i) => (
                  <span key={i} className="bg-tui-ink/30 h-1.5 w-1.5 rounded-full" />
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

type TeamMember = {
  id: string;
  name: string | null;
  email: string | null;
  isSelf: boolean;
  open: number;
  overdue: number;
  lastActiveAt: Date | string | null;
};

/** Who is carrying what: open tasks as ten ticks, red only when some are late. */
function TeamCard({ members, now }: { members: TeamMember[]; now: Date }) {
  const t = useTranslations("dashboard");
  const shown = members.slice(0, 5);

  return (
    <section className={`dash-rise ${CARD}`} style={rise(0.24)}>
      <CardHead title={t("teamToday.title")} meta={t("teamToday.meta")} />
      {shown.length === 0 ? (
        <p className={`text-tui-ink2 m-0 ${PAD} py-5 text-[13px]`}>
          {t("teamToday.empty")}
        </p>
      ) : (
        <ul className="m-0 list-none pt-1.5 pb-3">
          {shown.map((member) => {
            const who = member.name ?? member.email ?? t("activity.someone");
            const ago = relativeShort(member.lastActiveAt, now);
            const late = member.overdue > 0;

            return (
              <li
                key={member.id}
                className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-3 px-[18px] py-2.5 sm:px-6"
              >
                <Initial label={who} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13.5px] font-medium">
                    {member.isSelf ? t("teamToday.you", { name: who }) : who}
                  </span>
                  <span className="text-tui-ink3 truncate text-[11.5px]">
                    {ago
                      ? t("teamToday.active", { ago })
                      : t("teamToday.neverActive")}
                  </span>
                </span>
                <span
                  className="flex flex-col items-end gap-1"
                  aria-label={t("teamToday.open", { count: member.open })}
                  title={t("teamToday.open", { count: member.open })}
                >
                  <span
                    className={`text-[13px] tabular-nums ${late ? "text-tui-danger" : "text-tui-ink2"}`}
                    aria-hidden
                  >
                    {member.open}
                  </span>
                  <span className="flex gap-0.5" aria-hidden>
                    {Array.from({ length: 10 }, (_, i) => (
                      <span
                        key={i}
                        className={`h-3 w-1 rounded-[1px] ${
                          i < member.open
                            ? late
                              ? "bg-tui-danger"
                              : "bg-tui-ink/60"
                            : "bg-tui-ink/10"
                        }`}
                      />
                    ))}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ActivityItem({ row, now }: { row: ActivityRow; now: Date }) {
  const t = useTranslations("dashboard");
  const who = row.user?.name ?? row.user?.email ?? t("activity.someone");

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

  return (
    <li className="relative grid grid-cols-[26px_minmax(0,1fr)] gap-3 px-[18px] py-[9px] sm:px-6">
      <Initial label={who} />
      <span className="min-w-0">
        {row.projectId ? (
          <Link
            href={projectHref(row.projectId)}
            className="text-tui-ink2 hover:text-tui-ink block text-[13px] leading-[1.45] transition-colors after:absolute after:inset-0 after:content-['']"
          >
            {message}
          </Link>
        ) : (
          <span className="text-tui-ink2 block text-[13px] leading-[1.45]">
            {message}
          </span>
        )}
        <time className="text-tui-ink3 mt-px block text-[11.5px]">
          {relativeShort(row.createdAt, now)}
        </time>
      </span>
    </li>
  );
}

/** The scheduled agents and when each next runs — one quiet line, not a card. */
function CrewLine({ now, locale }: { now: Date; locale: string }) {
  const t = useTranslations("dashboard");
  const agents = useAgentLabel();
  const schedules = api.agent.schedules.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const on = (schedules.data ?? []).filter((row) => row.enabled);
  if (schedules.isLoading) return null;

  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" });
  const tomorrow = startOfDay(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const when = (hourLocal: number, dayOfWeek: number | null) => {
    const at = nextRunAt(hourLocal, dayOfWeek, now);
    const day = startOfDay(at).getTime();
    if (day === startOfDay(now).getTime())
      return t("crew.today", { time: time.format(at) });
    if (day === tomorrow.getTime())
      return t("crew.tomorrow", { time: time.format(at) });
    return t("crew.day", { day: weekday.format(at), time: time.format(at) });
  };

  return (
    <footer
      className="dash-rise border-tui-ink/10 text-tui-ink3 mt-10 flex flex-wrap items-center gap-x-[22px] gap-y-2 border-t pt-[18px] text-[12.5px]"
      style={rise(0.36)}
    >
      <span className={EYEBROW}>{t("crew.title")}</span>
      {on.length === 0 ? (
        <span>{t("crew.off")}</span>
      ) : (
        on.map((row) => (
          <span key={row.kind} className="inline-flex items-center gap-1.5">
            {row.kind === "risk_radar" && (
              <span className="bg-tui-ok h-1.5 w-1.5 rounded-full" aria-hidden />
            )}
            <b className="text-tui-ink2 font-medium">{agents.name(row.kind)}</b>
            <span>
              {row.kind === "meeting_prep"
                ? t("crew.meetings")
                : when(row.hourLocal, row.dayOfWeek)}
            </span>
          </span>
        ))
      )}
      <span className="flex-1" />
      <Link
        href="/settings?section=ai"
        className="hover:text-tui-ink transition-colors"
      >
        {t("crew.settings")} →
      </Link>
    </footer>
  );
}

/**
 * First run: no projects at all. Same frame as the populated page — the open
 * headline, then how the page fills in, then the crew — so the first thing a
 * new workspace sees is the dashboard it is about to get, not a different one.
 */
function FirstRun({
  now,
  locale,
  userName,
}: {
  now: Date;
  locale: string;
  userName?: string | null;
}) {
  const t = useTranslations("dashboard");
  const toast = useToast();
  const [code, setCode] = useState("");
  const utils = api.useUtils();

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

  const dateLine = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const firstName = (userName ?? "").trim().split(" ")[0] ?? "";

  const STEPS = [
    { title: t("firstRun.stepCreateTitle"), body: t("firstRun.step1") },
    { title: t("firstRun.stepTeamTitle"), body: t("firstRun.step2") },
    { title: t("firstRun.stepRadarTitle"), body: t("firstRun.step3") },
  ];

  return (
    <div className="text-tui-ink mx-auto max-w-[1240px] px-4 pt-8 pb-16 sm:px-8 sm:pt-14 lg:px-12 lg:pb-24">
      <section
        className="dash-rise border-tui-ink/10 grid grid-cols-1 items-end gap-6 border-b pb-7 sm:pb-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-12"
        style={rise(0.04)}
      >
        <div className="min-w-0">
          <span className={EYEBROW}>
            {t("firstRun.newWorkspace")} · {dateLine}
          </span>
          <h1 className="font-display mt-3.5 mb-5 text-[44px] leading-[0.98] font-normal tracking-[-0.025em] text-pretty sm:text-[60px] lg:text-[72px]">
            {t("firstRun.headline")}
            {firstName ? (
              <>
                , <em className="text-tui-accent">{firstName}.</em>
              </>
            ) : (
              "."
            )}
          </h1>
          <p className="text-tui-ink2 m-0 max-w-[620px] text-[16px] leading-[1.7] text-pretty">
            {t("firstRun.body")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 lg:flex-col lg:items-end">
          {/* Creating a project is the top bar's "New Project" — one button for
              it on the page, not two. Joining has no other way in. */}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = code.trim();
              if (trimmed) join.mutate({ code: trimmed });
            }}
            className="border-tui-ink/14 flex h-[38px] items-center overflow-hidden rounded-full border"
          >
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              aria-label={t("firstRun.codeLabel")}
              placeholder={t("firstRun.codePlaceholder")}
              className="text-tui-ink placeholder:text-tui-ink3 h-full w-[120px] bg-transparent px-4 text-[13px] tracking-[0.12em] outline-none"
            />
            <span className="bg-tui-ink/14 h-5 w-px" aria-hidden />
            <button
              type="submit"
              disabled={join.isPending || code.trim().length === 0}
              className="text-tui-ink2 hover:text-tui-ink h-full px-4 text-[13px] whitespace-nowrap transition-colors disabled:opacity-50"
            >
              {t("firstRun.joinCode")}
            </button>
          </form>
        </div>
      </section>

      <section className={`dash-rise mt-9 sm:mt-14 ${CARD}`} style={rise(0.12)}>
        <CardHead
          title={t("firstRun.howItFills")}
          meta={t("firstRun.steps3")}
        />
        <ol className="m-0 grid list-none grid-cols-1 py-1 sm:grid-cols-3 sm:py-0">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className={`grid grid-cols-[24px_minmax(0,1fr)] gap-2.5 py-5 sm:grid-cols-[34px_minmax(0,1fr)] sm:gap-3.5 sm:py-7 ${PAD} ${
                index > 0
                  ? "border-tui-ink/6 border-t sm:border-t-0 sm:border-l"
                  : ""
              }`}
            >
              <span className="font-display text-tui-ink3 text-[20px] leading-[1.2] italic">
                {ROMAN[index]}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-[15px] font-medium tracking-[-0.005em]">
                  {step.title}
                </span>
                <span className="text-tui-ink3 text-[13px] leading-[1.55]">
                  {step.body}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <CrewLine now={now} locale={locale} />
    </div>
  );
}
