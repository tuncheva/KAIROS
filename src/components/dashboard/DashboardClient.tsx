"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { RadarFindings } from "./RadarFindings";
import {
  dayFraction,
  headlineStats,
  momentum,
  projectStatusRows,
  relativeShort,
  startOfDay,
  type CalendarTask,
  type Momentum,
  type ProjectStatusRow,
} from "./dashboardData";

/** Project detail lives behind the create flow — see `ProjectsWorkspace`. */
const projectHref = (id: number) => `/projects?projectId=${id}`;

/** The card shell shared by every panel on the page. */
const CARD =
  "overflow-hidden rounded-lg border border-tui-ink/12 bg-tui-pane shadow-[var(--tui-pane-shadow)]";

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

/** Health is a tone; it paints text and a dot, never a fill. */
const HEALTH_TONE = {
  onTrack: "text-tui-ok",
  inProgress: "text-tui-warn",
  atRisk: "text-tui-danger",
  empty: "text-tui-ink3",
} as const;

const HEALTH_DOT = {
  onTrack: "bg-tui-ok",
  inProgress: "bg-tui-warn",
  atRisk: "bg-tui-danger",
  empty: "bg-tui-ink/30",
} as const;

/** A serif monogram in a bordered circle — the refined edition's avatar. */
function Initial({ label, size = 26 }: { label: string; size?: number }) {
  return (
    <span
      className="border-tui-ink/16 bg-tui-pane font-display text-tui-ink2 flex items-center justify-center rounded-full border"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {label.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** The header row a card wears: a serif title, a caption, and an optional link. */
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
    <div className="border-tui-ink/8 flex items-baseline gap-3 border-b px-7 pt-5 pb-4">
      <h2 className="font-display text-tui-ink m-0 text-[22px] leading-none">
        {title}
      </h2>
      {meta && <span className="text-tui-ink3 text-[12.5px]">{meta}</span>}
      <span className="flex-1" />
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="text-tui-ink2 hover:text-tui-ink text-[13px] transition-colors"
        >
          {actionLabel} →
        </Link>
      )}
    </div>
  );
}

export function DashboardClient({ userName }: { userName: string | null }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();

  const projectsQuery = api.project.getMyProjects.useQuery();
  const activityQuery = api.task.getOrgActivity.useQuery({
    limit: 6,
    scope: "all",
  });
  const pulseQuery = api.progress.getPulse.useQuery(undefined, {
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

  const stats = useMemo(() => headlineStats(projects, now), [projects, now]);
  const rows = useMemo(() => projectStatusRows(projects, now), [projects, now]);
  const dayGone = useMemo(() => dayFraction(now), [now]);
  const pace = useMemo(
    () => momentum(pulseQuery.data?.completions ?? [], now),
    [pulseQuery.data, now],
  );
  const team = pulseQuery.data?.team ?? [];

  const oldestOverdueDays = useMemo(() => {
    const today = startOfDay(now).getTime();
    let oldest = 0;
    for (const task of calendarTasks) {
      if (task.status === "completed" || !task.dueDate) continue;
      const due = startOfDay(new Date(task.dueDate)).getTime();
      if (due >= today) continue;
      oldest = Math.max(oldest, Math.round((today - due) / 86_400_000));
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

  const isLoading = projectsQuery.isLoading || calendarQuery.isLoading;
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

  if (isLoading) return <BootScreen />;
  if (isFirstRun) {
    return (
      <div className="tui-screen min-h-full">
        <FirstRun
          dayGone={dayGone}
          now={now}
          locale={locale}
          userName={userName}
        />
      </div>
    );
  }

  return (
    <div className="tui-screen text-tui-ink min-h-full">
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-6 px-4 pt-10 pb-12 sm:px-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Hero */}
        <div className={`dash-rise ${CARD} xl:order-1`} style={rise(0.05)}>
          <div className="flex flex-col gap-4 px-8 py-9 sm:px-10">
            <span className="text-tui-ink3 text-[11px] font-medium tracking-[0.18em] uppercase">
              {dateLine}
            </span>
            <h1 className="font-display m-0 text-[40px] leading-[1.02] font-light tracking-[-0.02em] sm:text-[58px]">
              {firstName ? (
                <>
                  {t(`greetingPlain.${greeting}`)},{" "}
                  <span className="text-tui-accent italic">{firstName}.</span>
                </>
              ) : (
                t(`greetingPlain.${greeting}`)
              )}
            </h1>
            <p className="text-tui-ink2 m-0 max-w-[640px] text-[16px] leading-[1.6] text-pretty">
              {stats.totalTasks === 0
                ? t("summaryEmpty")
                : t("summary", {
                    due: stats.dueToday,
                    overdue: stats.overdue,
                    projects: stats.projectCount,
                  })}
            </p>
          </div>
        </div>

        {/* Today */}
        <div className={`dash-rise ${CARD} xl:order-2`} style={rise(0.1)}>
          <div className="flex flex-col gap-3.5 px-7 py-6">
            <span className="font-display text-[21px] capitalize">
              {t("tui.today")}
            </span>
            <TodayStat
              label={t("stats.dueToday")}
              value={stats.dueToday}
              note={
                doneToday > 0
                  ? t("stats.notes.doneToday", { count: doneToday })
                  : ""
              }
              progress={p}
            />
            <TodayStat
              label={t("stats.overdue")}
              value={stats.overdue}
              tone="danger"
              note={
                oldestOverdueDays > 0
                  ? t("stats.notes.oldest", { days: oldestOverdueDays })
                  : ""
              }
              progress={p}
            />
            <TodayStat
              label={t("stats.openThisWeek")}
              value={stats.openThisWeek}
              note={t("stats.notes.across", { count: stats.projectCount })}
              progress={p}
            />
            <TodayStat
              label={t("stats.completed")}
              value={stats.completed}
              tone="ok"
              note={t("stats.notes.allTime")}
              progress={p}
            />
          </div>
        </div>

        {/* Left column */}
        <div className="flex min-w-0 flex-col gap-6 xl:order-3">
          <RadarFindings
            className="dash-rise"
            style={rise(0.16)}
            now={now}
            projectTitles={projectTitles}
          />

          <section className={`dash-rise ${CARD}`} style={rise(0.22)}>
            <CardHead
              title={t("projectStatus.title")}
              meta={t("projectStatus.count", { count: rows.length })}
              actionLabel={t("projectStatus.action")}
              actionHref="/projects"
            />
            <ProjectStatusTable rows={rows} progress={p} locale={locale} />
          </section>

          {activity.length > 0 && (
            <section className={`dash-rise ${CARD}`} style={rise(0.28)}>
              <CardHead
                title={t("activity.title")}
                actionLabel={t("activity.action")}
                actionHref="/progress"
              />
              {activity.map((row) => (
                <ActivityItem key={row.id} row={row} now={now} />
              ))}
            </section>
          )}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6 xl:order-4">
          <WorkspaceRing
            progress={p}
            percent={stats.percent}
            completed={stats.completed}
            total={stats.totalTasks}
            inProgress={stats.inProgress}
            todo={stats.todo}
            dayGone={dayGone}
          />
          <MomentumCard momentum={pace} locale={locale} />
          <TeamToday members={team} now={now} />
        </div>
      </div>
    </div>
  );
}

/** One dotted-leader stat: label · note · big serif number. */
function TodayStat({
  label,
  value,
  note,
  tone,
  progress,
}: {
  label: string;
  value: number;
  note: string;
  tone?: "danger" | "ok";
  progress: number;
}) {
  const shown = useTween(value);
  const toneClass =
    tone === "danger"
      ? "text-tui-danger"
      : tone === "ok"
        ? "text-tui-ok"
        : "text-tui-ink";

  return (
    <div className="flex items-baseline gap-2.5 text-[14px]">
      <span className="text-tui-ink2">{label}</span>
      <span className="border-tui-ink/16 flex-1 -translate-y-1 border-b border-dotted" />
      {note && <span className="text-tui-ink3 text-[12px]">{note}</span>}
      <span
        className={`font-display min-w-[34px] text-right text-[26px] leading-none tabular-nums ${toneClass}`}
      >
        {Math.round(shown * progress)}
      </span>
    </div>
  );
}

const RING_CX = 120;
type Seg = { x1: number; y1: number; x2: number; y2: number; lit: boolean };

function ringSegments(n: number, r1: number, r2: number, frac: number): Seg[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return {
      x1: RING_CX + Math.cos(a) * r1,
      y1: RING_CX + Math.sin(a) * r1,
      x2: RING_CX + Math.cos(a) * r2,
      y2: RING_CX + Math.sin(a) * r2,
      lit: (i + 0.5) / n < frac,
    };
  });
}

/** Completion on the outer ring, the day on the thin inner one — fine segments. */
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
  const shown = useTween(percent);
  const outer = ringSegments(120, 102, 114, (shown / 100) * progress);
  const inner = total > 0 ? ringSegments(60, 88, 93, dayGone * progress) : [];

  return (
    <section className={`dash-fade ${CARD}`} style={rise(0.12)}>
      <div className="flex flex-col gap-[18px] px-7 pt-6 pb-6">
        <div className="flex items-baseline">
          <span className="font-display text-[21px]">
            {t("workspace.title")}
          </span>
          <span className="flex-1" />
          <span className="text-tui-ink3 text-[12.5px]">
            {completed} / {total}
          </span>
        </div>

        <div className="relative mx-auto h-[240px] w-[240px]">
          <svg viewBox="0 0 240 240" width="240" height="240" className="block">
            {outer.map((s, i) => (
              <line
                key={`o${i}`}
                x1={s.x1}
                y1={s.y1}
                x2={s.x2}
                y2={s.y2}
                strokeWidth="1.5"
                strokeLinecap="round"
                className={s.lit ? "stroke-tui-accent" : "stroke-tui-ink/16"}
              />
            ))}
            {inner.map((s, i) => (
              <line
                key={`i${i}`}
                x1={s.x1}
                y1={s.y1}
                x2={s.x2}
                y2={s.y2}
                strokeWidth="1.2"
                strokeLinecap="round"
                className={s.lit ? "stroke-tui-day" : "stroke-tui-ink/12"}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="font-display text-tui-ok text-[60px] leading-none font-light tracking-[-0.03em] tabular-nums">
              {Math.round(shown * progress)}
              <span className="text-[26px]">%</span>
            </span>
            <span className="text-tui-ink3 text-[12.5px]">
              {t("workspace.ofTasksDone")}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 text-[14px]">
          <RingLegend
            dot="bg-tui-accent"
            label={t("workspace.doneLabel")}
            value={completed}
          />
          <RingLegend
            dot="bg-tui-warn"
            label={t("workspace.activeLabel")}
            value={inProgress}
          />
          <RingLegend
            dot="bg-tui-ink/25"
            label={t("workspace.todoLabel")}
            value={todo}
          />
          <RingLegend
            dot="bg-tui-day"
            label={t("workspace.dayGoneLabel")}
            value={`${Math.round(dayGone * 100)}%`}
          />
        </div>
      </div>
    </section>
  );
}

function RingLegend({
  dot,
  label,
  value,
}: {
  dot: string;
  label: string;
  value: number | string;
}) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span
        className={`h-2 w-2 -translate-y-px rounded-full ${dot}`}
        aria-hidden
      />
      <span className="text-tui-ink2">{label}</span>
      <span className="border-tui-ink/16 flex-1 -translate-y-1 border-b border-dotted" />
      <span className="font-display text-[19px] tabular-nums">{value}</span>
    </div>
  );
}

/** A fortnight of finished work as soft bars, the streak, and the pace. */
function MomentumCard({
  momentum: data,
  locale,
}: {
  momentum: Momentum;
  locale: string;
}) {
  const t = useTranslations("dashboard");
  const max = Math.max(1, ...data.bars.map((day) => day.count));
  const last = data.bars.length - 1;
  const dayMonth = (d: Date) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(
      d,
    );

  return (
    <section className={`dash-fade ${CARD}`} style={rise(0.18)}>
      <div className="flex flex-col gap-4 px-7 py-6">
        <div className="flex items-baseline">
          <span className="font-display text-[21px]">
            {t("momentum.title")}
          </span>
          <span className="flex-1" />
          {data.pace !== null && (
            <span
              className={`text-[12.5px] font-semibold ${
                data.pace < 0 ? "text-tui-ink3" : "text-tui-ok"
              }`}
            >
              {data.pace > 0 ? "+" : ""}
              {data.pace}%
            </span>
          )}
        </div>

        <span className="font-display text-[34px] leading-none font-light">
          {data.streak > 0
            ? t("momentum.streak", { count: data.streak })
            : t("momentum.noStreak")}
        </span>

        <div className="flex h-16 items-end gap-[7px]" aria-hidden>
          {data.bars.map((day, index) => (
            <span
              key={day.date.toISOString()}
              className={`flex-1 rounded-[3px] ${
                index >= last - 1 ? "bg-tui-accent" : "bg-tui-accent/[0.32]"
              }`}
              style={{
                height: `${Math.max(4, Math.round((day.count / max) * 64))}px`,
              }}
            />
          ))}
        </div>

        <div className="text-tui-ink3 flex justify-between text-[12px]">
          <span>{data.bars[0] ? dayMonth(data.bars[0].date) : ""}</span>
          <span className="capitalize">{t("tui.today")}</span>
        </div>
        <span className="text-tui-ink2 text-[13.5px] leading-[1.6]">
          {t("momentum.line", { total: data.total, today: data.today })}
        </span>
      </div>
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

/** Who is carrying what, right now. Heaviest load first. */
function TeamToday({ members, now }: { members: TeamMember[]; now: Date }) {
  const t = useTranslations("dashboard");
  const shown = members.slice(0, 5);

  return (
    <section className={`dash-fade ${CARD}`} style={rise(0.24)}>
      <div className="px-7 pt-6 pb-3">
        <span className="font-display text-[21px]">{t("teamToday.title")}</span>
        {shown.length === 0 ? (
          <p className="text-tui-ink2 pt-3 text-[13px]">
            {t("teamToday.empty")}
          </p>
        ) : (
          <div className="mt-2 flex flex-col">
            {shown.map((member) => {
              const who = member.name ?? member.email ?? t("activity.someone");
              const ago = relativeShort(member.lastActiveAt, now);
              const active = ago === "now" || (!!ago && ago.endsWith("m"));
              const dot =
                member.overdue > 0
                  ? "bg-tui-danger"
                  : active
                    ? "bg-tui-ok"
                    : "bg-tui-warn";

              return (
                <div
                  key={member.id}
                  className="border-tui-ink/8 grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-t py-[11px] first:border-t-0"
                >
                  <Initial label={who} size={32} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-tui-ink truncate text-[14px] font-medium">
                      {member.isSelf ? t("teamToday.you", { name: who }) : who}
                    </span>
                    <span className="text-tui-ink3 flex items-center gap-1.5 text-[12.5px]">
                      <span
                        className={`h-[5px] w-[5px] rounded-full ${dot}`}
                        aria-hidden
                      />
                      {ago
                        ? t("teamToday.active", { ago })
                        : t("teamToday.neverActive")}
                    </span>
                  </span>
                  <span
                    className={`text-[13.5px] font-semibold ${
                      member.overdue > 0 ? "text-tui-danger" : "text-tui-ink"
                    }`}
                  >
                    {t("teamToday.open", { count: member.open })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

const TABLE_GRID =
  "grid grid-cols-[minmax(0,1fr)_90px_50px_64px_minmax(0,190px)_52px_110px] items-center gap-4";

/** Project status: eight readings of every project in one row. */
function ProjectStatusTable({
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
      <div className="px-7 py-6">
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
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div
          className={`${TABLE_GRID} border-tui-ink/8 text-tui-ink3 border-b px-7 py-3 text-[11px] font-medium tracking-[0.14em] uppercase`}
        >
          <span>{t("projectStatus.columns.project")}</span>
          <span>{t("projectStatus.columns.team")}</span>
          <span className="text-right">{t("projectStatus.columns.open")}</span>
          <span className="text-right">
            {t("projectStatus.columns.overdue")}
          </span>
          <span>{t("projectStatus.columns.completion")}</span>
          <span className="text-right">%</span>
          <span className="text-right">
            {t("projectStatus.columns.health")}
          </span>
        </div>
        {rows.map((row) => (
          <ProjectStatusRowView
            key={row.id}
            row={row}
            progress={progress}
            locale={locale}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectStatusRowView({
  row,
  progress,
  locale,
}: {
  row: ProjectStatusRow;
  progress: number;
  locale: string;
}) {
  const t = useTranslations("dashboard");
  const shown = useTween(row.percent);
  const percent = Math.round(shown * progress);

  return (
    <div
      className={`group relative ${TABLE_GRID} border-tui-ink/8 hover:bg-tui-accent/[0.05] border-b px-7 py-4 text-[14px] transition-colors last:border-b-0`}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <Link
          href={projectHref(row.id)}
          className="font-display truncate text-[19px] after:absolute after:inset-0 after:content-['']"
        >
          {(row.title?.trim() ?? "") || t("projects.untitled")}
        </Link>
        <span className="text-tui-ink3 truncate text-[12.5px]">
          {row.endsAt
            ? t("projectStatus.ends", {
                date: new Intl.DateTimeFormat(locale, {
                  day: "numeric",
                  month: "short",
                }).format(row.endsAt),
              })
            : t("projectStatus.noDate")}
        </span>
      </span>
      <span className="relative z-10 flex">
        {row.owners.slice(0, 3).map((owner) => (
          <span key={owner.id} className="-mr-1.5">
            <Initial label={owner.name ?? "?"} />
          </span>
        ))}
        {row.owners.length === 0 && <Initial label="—" />}
      </span>
      <span className="text-tui-ink2 text-right tabular-nums">{row.open}</span>
      <span
        className={`text-right tabular-nums ${row.overdue > 0 ? "text-tui-danger" : "text-tui-ink3"}`}
      >
        {row.overdue}
      </span>
      <span className="bg-tui-ink/12 relative h-[3px] overflow-hidden rounded-sm">
        <span
          className="bg-tui-accent absolute inset-y-0 left-0 rounded-sm"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span
        className={`text-right font-semibold tabular-nums ${HEALTH_TONE[row.health]}`}
      >
        {percent}%
      </span>
      <span className="text-tui-ink2 flex items-center justify-end gap-2 text-[13px]">
        <span
          className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT[row.health]}`}
          aria-hidden
        />
        {t(`projects.health.${row.health}`)}
      </span>
    </div>
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
    <div className="border-tui-ink/8 relative grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-4 border-b px-7 py-3.5 last:border-b-0">
      <Initial label={who} size={30} />
      {row.projectId ? (
        <Link
          href={projectHref(row.projectId)}
          className="text-tui-ink2 truncate text-[14.5px] after:absolute after:inset-0 after:content-['']"
        >
          {message}
        </Link>
      ) : (
        <span className="text-tui-ink2 truncate text-[14.5px]">{message}</span>
      )}
      <span className="text-tui-ink3 text-right text-[12.5px]">
        {relativeShort(row.createdAt, now)}
      </span>
    </div>
  );
}

/** Warming the queries — a shimmer of the page to come. */
function BootScreen() {
  return (
    <div className="tui-screen min-h-full">
      <div className="mx-auto max-w-[1440px] px-4 pt-10 pb-12 sm:px-8">
        <div className={CARD}>
          <div className="flex flex-col gap-3 px-8 py-9">
            {[62, 44, 70, 52, 66].map((w, i) => (
              <div
                key={i}
                className="bg-tui-ink/8 h-5 animate-pulse rounded"
                style={{ width: `${w}%`, animationDelay: `${i * 0.08}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const TAU = Math.PI * 2;

/**
 * First run: no projects at all. The welcome — how the page fills in, and the
 * day dial, which runs and carries the screen until there is work.
 */
function FirstRun({
  dayGone,
  now,
  locale,
  userName,
}: {
  dayGone: number;
  now: Date;
  locale: string;
  userName?: string | null;
}) {
  const t = useTranslations("dashboard");
  const toast = useToast();
  const [code, setCode] = useState("");
  const p = useEntrance(true);
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

  const clockShort = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const dateLine = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);

  const hours = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * TAU - Math.PI / 2;
    return {
      x1: 150 + Math.cos(a) * 132,
      y1: 150 + Math.sin(a) * 132,
      x2: 150 + Math.cos(a) * 140,
      y2: 150 + Math.sin(a) * 140,
      quarter: i % 6 === 0,
    };
  });
  const fine = Array.from({ length: 144 }, (_, i) => {
    const a = (i / 144) * TAU - Math.PI / 2;
    return {
      x1: 150 + Math.cos(a) * 112,
      y1: 150 + Math.sin(a) * 112,
      x2: 150 + Math.cos(a) * 124,
      y2: 150 + Math.sin(a) * 124,
      lit: (i + 0.5) / 144 < dayGone * p,
    };
  });
  const nowAngle = dayGone * p * TAU - Math.PI / 2;

  const STEPS = [
    { n: "i", title: t("firstRun.stepCreateTitle"), body: t("firstRun.step1") },
    { n: "ii", title: t("firstRun.stepTeamTitle"), body: t("firstRun.step2") },
    {
      n: "iii",
      title: t("firstRun.stepRadarTitle"),
      body: t("firstRun.step3"),
    },
  ];

  return (
    <div className="text-tui-ink mx-auto grid max-w-[1440px] grid-cols-1 items-start gap-6 px-4 pt-12 pb-14 sm:px-8 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="flex flex-col gap-6">
        <div className={`dash-rise ${CARD}`} style={rise(0.05)}>
          <div className="flex flex-col gap-5 px-8 py-10 sm:px-12">
            <span className="text-tui-ink3 text-[11px] font-medium tracking-[0.18em] uppercase">
              {t("firstRun.newWorkspace")}
            </span>
            <h1 className="font-display m-0 max-w-[720px] text-[40px] leading-[1.03] font-light tracking-[-0.02em] text-pretty sm:text-[58px]">
              {t("firstRun.headline")}
              {userName?.trim() ? (
                <>
                  ,{" "}
                  <span className="text-tui-accent italic">
                    {userName.trim().split(" ")[0]}.
                  </span>
                </>
              ) : (
                "."
              )}
            </h1>
            <p className="text-tui-ink2 m-0 max-w-[580px] text-[16px] leading-[1.65] text-pretty">
              {t("firstRun.body")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <Link
                href="/projects?new=1"
                className="bg-tui-accent text-tui-on-accent flex h-12 items-center gap-2.5 rounded-full px-[22px] text-[14.5px] font-semibold transition-transform hover:-translate-y-0.5"
              >
                <Plus size={16} />
                {t("firstRun.createProject")}
              </Link>
              <span className="text-tui-ink3 text-[13px]">
                {t("firstRun.or")}
              </span>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const trimmed = code.trim();
                  if (trimmed) join.mutate({ code: trimmed });
                }}
                className="border-tui-ink/16 bg-tui-bg flex h-12 items-center overflow-hidden rounded-full border"
              >
                <input
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.toUpperCase())
                  }
                  aria-label={t("firstRun.codeLabel")}
                  placeholder={t("firstRun.codePlaceholder")}
                  className="text-tui-ink placeholder:text-tui-ink3 h-full w-[170px] bg-transparent px-5 text-[14px] tracking-[0.12em] outline-none"
                />
                <span className="bg-tui-ink/16 h-6 w-px" aria-hidden />
                <button
                  type="submit"
                  disabled={join.isPending || code.trim().length === 0}
                  className="text-tui-ink h-full px-5 text-[14px] font-medium transition-opacity disabled:opacity-50"
                >
                  {t("firstRun.joinCode")}
                </button>
              </form>
            </div>
          </div>
        </div>

        <div
          className={`dash-rise ${CARD} grid grid-cols-1 sm:grid-cols-3`}
          style={rise(0.12)}
        >
          {STEPS.map((step, index) => (
            <div
              key={step.n}
              className={`flex flex-col gap-2.5 px-7 py-7 ${
                index > 0
                  ? "border-tui-ink/8 border-t sm:border-t-0 sm:border-l"
                  : ""
              }`}
            >
              <span className="font-display text-tui-accent text-[24px] leading-none italic">
                {step.n}
              </span>
              <span className="font-display text-[21px]">{step.title}</span>
              <span className="text-tui-ink2 text-[14px] leading-[1.6]">
                {step.body}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={`dash-fade ${CARD}`} style={rise(0.16)}>
        <div className="flex flex-col gap-[22px] px-8 py-7">
          <div className="flex items-baseline">
            <span className="font-display text-[21px] capitalize">
              {t("tui.today")}
            </span>
            <span className="flex-1" />
            <span className="text-tui-ink3 text-[12.5px]">{dateLine}</span>
          </div>
          <div className="relative mx-auto h-[300px] w-[300px]">
            <svg
              viewBox="0 0 300 300"
              width="300"
              height="300"
              className="block"
            >
              {hours.map((h, i) => (
                <line
                  key={`h${i}`}
                  x1={h.x1}
                  y1={h.y1}
                  x2={h.x2}
                  y2={h.y2}
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  className={
                    h.quarter ? "stroke-tui-ink3" : "stroke-tui-ink/16"
                  }
                />
              ))}
              {fine.map((f, i) => (
                <line
                  key={`f${i}`}
                  x1={f.x1}
                  y1={f.y1}
                  x2={f.x2}
                  y2={f.y2}
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  className={f.lit ? "stroke-tui-accent" : "stroke-tui-ink/10"}
                />
              ))}
              <circle
                cx={150 + Math.cos(nowAngle) * 104}
                cy={150 + Math.sin(nowAngle) * 104}
                r="4"
                className="fill-tui-accent"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <span className="font-display text-[58px] leading-none font-light tracking-[-0.02em] tabular-nums">
                {clockShort}
              </span>
              <span className="text-tui-ink3 text-[13px]">
                {t("workspace.dayGone", { percent: Math.round(dayGone * 100) })}
              </span>
            </div>
          </div>
          <p className="text-tui-ink3 m-0 text-center text-[13.5px] leading-[1.65] text-pretty">
            {t("firstRun.dayCaption")}
          </p>
        </div>
      </div>
    </div>
  );
}
