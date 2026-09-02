"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Zap } from "~/components/ui/icons";

import { ProfileLink } from "~/components/profile/ProfileLink";
import { avatarGradientStyle } from "~/lib/avatarGradient";
import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { RadarFindings } from "./RadarFindings";
import {
  RING_DAY,
  RING_TASKS,
  dashOffset,
  dayFraction,
  headlineStats,
  momentum,
  projectStatusRows,
  relativeShort,
  startOfDay,
  type CalendarTask,
  type Momentum,
  type ProjectOwner,
  type ProjectStatusRow,
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
 * so this starts settled and only animates the *changes* — finishing a task
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

/** Blocks stage in on a shared curve; the delay is what separates them. */
const rise = (delay: number) => ({ animationDelay: `${delay}s` });

export function DashboardClient({ userName }: { userName: string | null }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();

  const projectsQuery = api.project.getMyProjects.useQuery();
  const activityQuery = api.task.getOrgActivity.useQuery({ limit: 6, scope: "all" });
  const pulseQuery = api.progress.getPulse.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  // Wide enough to date the overdue pile — the stat line says how old the
  // oldest one is, and a fortnight of slack keeps that honest.
  const range = useMemo(() => {
    const from = startOfDay(new Date());
    from.setDate(from.getDate() - 60);
    const to = startOfDay(new Date());
    to.setDate(to.getDate() + 21);
    return { from, to };
  }, []);

  const calendarQuery = api.task.getForCalendar.useQuery(range);

  const now = useMemo(() => new Date(), []);
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
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

  /* The two stat footnotes that are facts rather than restatements: how old the
     oldest overdue task is, and how much of today is already ticked off. */
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
    () => new Map(projects.map((project) => [project.id, project.title] as const)),
    [projects],
  );

  const activity = ((activityQuery.data?.rows ?? []) as ActivityRow[]).slice(0, 5);

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

  if (isFirstRun) {
    return <FirstRun dayGone={dayGone} now={now} locale={locale} />;
  }

  return (
    <div className="grid grid-cols-1 items-start xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-8 px-4 pt-8 pb-11 sm:px-[34px] xl:border-r xl:border-border-light/60">
        <div className="dash-rise flex flex-col gap-5" style={rise(0.05)}>
          <header className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-quaternary">
              {dateLine}
            </span>
            <h1 className="text-[28px] font-semibold leading-none tracking-[-0.028em] text-fg-primary sm:text-[34px]">
              {firstName
                ? t(`greeting.${greeting}`, { name: firstName })
                : t(`greetingPlain.${greeting}`)}
            </h1>
            <p className="max-w-3xl text-[15px] leading-[1.5] text-fg-tertiary">
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
              {
                label: t("stats.dueToday"),
                value: stats.dueToday,
                note: doneToday > 0 ? t("stats.notes.doneToday", { count: doneToday }) : "",
              },
              {
                label: t("stats.overdue"),
                value: stats.overdue,
                tone: "danger",
                note:
                  oldestOverdueDays > 0
                    ? t("stats.notes.oldest", { days: oldestOverdueDays })
                    : "",
              },
              {
                label: t("stats.openThisWeek"),
                value: stats.openThisWeek,
                note: t("stats.notes.across", { count: stats.projectCount }),
              },
              {
                label: t("stats.completed"),
                value: stats.completed,
                tone: "success",
                note: t("stats.notes.allTime"),
              },
            ]}
          />
        </div>

        {/*
          B-2/B-3. The radar sits directly under the headline, where the design
          puts it: a finding that arrives with its fix already drafted is worth
          reading before the work itself, which is the whole argument for
          letting the assistant speak unprompted.
        */}
        <RadarFindings
          className="dash-rise"
          style={rise(0.12)}
          now={now}
          projectTitles={projectTitles}
        />

        <section className="dash-rise flex flex-col gap-3" style={rise(0.19)}>
          <SectionHead
            title={t("projectStatus.title")}
            note={t("projectStatus.count", { count: rows.length })}
            actionLabel={t("projectStatus.action")}
            actionHref="/projects"
          />
          <ProjectStatusTable rows={rows} loading={isLoading} progress={p} locale={locale} />
        </section>

        {activity.length > 0 && (
          <section className="dash-rise flex flex-col gap-3" style={rise(0.26)}>
            <SectionHead
              title={t("activity.title")}
              actionLabel={t("activity.action")}
              actionHref="/progress"
            />
            <div className="flex flex-col">
              {activity.map((row) => (
                <ActivityItem key={row.id} row={row} now={now} />
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="dash-fade flex flex-col gap-[30px] px-4 pt-8 pb-11 sm:px-[26px]" style={rise(0.1)}>
        <WorkspaceRing
          progress={p}
          percent={stats.percent}
          completed={stats.completed}
          total={stats.totalTasks}
          inProgress={stats.inProgress}
          todo={stats.todo}
          dayGone={dayGone}
        />

        <MomentumCard momentum={pace} />

        <TeamToday members={team} loading={pulseQuery.isLoading} now={now} />
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
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-fg-secondary">{t("workspace.title")}</span>
        <span className="font-mono text-[11px] text-fg-quaternary">
          {completed} / {total}
        </span>
      </div>

      <div className="relative h-[196px] w-[196px] self-center">
        <svg viewBox="0 0 196 196" className="block h-[196px] w-[196px]">
          <circle
            cx="98"
            cy="98"
            r="82"
            fill="none"
            strokeWidth="12"
            className="stroke-border-light/70"
          />
          <circle
            cx="98"
            cy="98"
            r="82"
            fill="none"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={RING_TASKS}
            strokeDashoffset={dashOffset(RING_TASKS, shown / 100, progress)}
            transform="rotate(-90 98 98)"
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
                cx="98"
                cy="98"
                r="62"
                fill="none"
                strokeWidth="4"
                className="stroke-border-light/50"
              />
              <circle
                cx="98"
                cy="98"
                r="62"
                fill="none"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={RING_DAY}
                strokeDashoffset={dashOffset(RING_DAY, dayGone, progress)}
                transform="rotate(-90 98 98)"
                className="stroke-dash-day"
              />
            </>
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="text-[42px] font-semibold tabular-nums tracking-[-0.03em] text-fg-primary">
            {Math.round(shown * progress)}%
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-quaternary">
            {t("workspace.ofTasksDone")}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-3.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-quaternary">
        <span className="flex items-center gap-[7px] text-fg-tertiary">
          <span className="h-2 w-2 rounded-full bg-dash-day" aria-hidden />
          {t("workspace.dayGone", { percent: Math.round(dayGone * 100) })}
        </span>
        <span className="text-success">{t("workspace.done", { count: completed })}</span>
        <span className="text-warning">{t("workspace.active", { count: inProgress })}</span>
        <span>{t("workspace.todo", { count: todo })}</span>
      </div>
    </section>
  );
}

/**
 * Your momentum: a fortnight of finished work as bars, the streak that runs
 * through it, and the week-on-week pace.
 *
 * It answers a question the rest of the page cannot: the rings and the tables
 * are all about what is left, and none of them ever say that you are getting
 * through it.
 */
function MomentumCard({ momentum: data }: { momentum: Momentum }) {
  const t = useTranslations("dashboard");
  const max = Math.max(1, ...data.bars.map((day) => day.count));
  const last = data.bars.length - 1;

  return (
    <section className="flex flex-col gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-quaternary">
        {t("momentum.title")}
      </span>
      <div className="flex flex-col gap-3.5 rounded-xl border border-border-light/60 bg-bg-elevated p-[18px]">
        <div className="flex items-center gap-2.5">
          <Zap size={16} className="text-warning" aria-hidden />
          <span className="text-sm font-semibold text-fg-primary">
            {data.streak > 0 ? t("momentum.streak", { count: data.streak }) : t("momentum.noStreak")}
          </span>
          {data.pace !== null && (
            <span
              className={`ml-auto font-mono text-[11px] ${
                data.pace < 0 ? "text-fg-quaternary" : "text-success"
              }`}
            >
              {data.pace > 0 ? "+" : ""}
              {data.pace}%
            </span>
          )}
        </div>

        <div className="flex h-11 items-end gap-1.5" aria-hidden>
          {data.bars.map((day, index) => (
            <span
              key={day.date.toISOString()}
              className={`flex-1 rounded-sm ${
                day.count === 0
                  ? "bg-border-light/60"
                  : index >= last - 1
                    ? "bg-accent-primary"
                    : "bg-accent-primary/35"
              }`}
              style={{ height: `${Math.max(4, Math.round((day.count / max) * 40))}px` }}
            />
          ))}
        </div>

        <span className="text-xs leading-[1.5] text-fg-tertiary">
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
function TeamToday({
  members,
  loading,
  now,
}: {
  members: TeamMember[];
  loading: boolean;
  now: Date;
}) {
  const t = useTranslations("dashboard");
  const shown = members.slice(0, 5);

  return (
    <section className="flex flex-col gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-quaternary">
        {t("teamToday.title")}
      </span>
      {loading ? (
        <SkeletonRows rows={3} />
      ) : shown.length === 0 ? (
        <p className="text-[13px] text-fg-tertiary">{t("teamToday.empty")}</p>
      ) : (
        <div className="flex flex-col">
          {shown.map((member) => {
            const who = member.name ?? member.email ?? t("activity.someone");
            const ago = relativeShort(member.lastActiveAt, now);

            return (
              <div
                key={member.id}
                className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border-light/50 px-0.5 py-[11px]"
              >
                <ProfileLink userId={member.id} name={member.name}>
                  <span
                    style={avatarGradientStyle(member.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                  >
                    {who.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                </ProfileLink>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium text-fg-primary">
                    {member.isSelf ? t("teamToday.you", { name: who }) : who}
                  </span>
                  <span className="font-mono text-[10px] text-fg-quaternary">
                    {ago ? t("teamToday.active", { ago }) : t("teamToday.neverActive")}
                  </span>
                </span>
                <span
                  className={`font-mono text-[11px] ${
                    member.overdue > 0
                      ? "text-error"
                      : member.open === 0
                        ? "text-fg-quaternary"
                        : "text-fg-secondary"
                  }`}
                >
                  {t("teamToday.open", { count: member.open })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
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
  items: { label: string; value: number; note: string; tone?: "danger" | "success" }[];
  progress: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[11px] border border-border-light/60 bg-border-light/60 sm:grid-cols-4">
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
  item: { label: string; value: number; note: string; tone?: "danger" | "success" };
  progress: number;
}) {
  const shown = useTween(item.value);

  return (
    <div className="flex flex-col gap-2 bg-bg-elevated px-[18px] py-4 transition-colors duration-[350ms] hover:bg-bg-tertiary">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-quaternary">
        {item.label}
      </span>
      <div className="flex items-baseline gap-[9px]">
        <span
          className={`text-[27px] font-semibold tabular-nums tracking-[-0.02em] ${
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
        </span>
        {item.note && (
          <span className="truncate font-mono text-[11px] text-fg-quaternary">{item.note}</span>
        )}
      </div>
    </div>
  );
}

function SectionHead({
  title,
  note,
  actionLabel,
  actionHref,
}: {
  title: string;
  note?: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="m-0 text-base font-semibold tracking-[-0.012em] text-fg-primary">{title}</h2>
      {note && <span className="font-mono text-[11px] text-fg-quaternary">{note}</span>}
      <span className="flex-1" />
      <Link
        href={actionHref}
        className="text-[13px] text-fg-tertiary transition-colors hover:text-fg-primary"
      >
        {actionLabel}
      </Link>
    </div>
  );
}

/** Health is a text reading only — no fill, so a late project is not an alarm. */
const HEALTH_TEXT = {
  onTrack: "text-success",
  inProgress: "text-warning",
  atRisk: "text-error",
  empty: "text-fg-quaternary",
} as const;

/** The completion bar takes the same reading, because it is the same fact. */
const HEALTH_BAR = {
  onTrack: "bg-accent-primary",
  inProgress: "bg-warning",
  atRisk: "bg-error",
  empty: "bg-border-light",
} as const;

/**
 * Project status: six readings of every project in one row.
 *
 * The rail of cards this replaces could only show two of them, so "which
 * project is late, and who is on it" meant opening each one in turn.
 */
const TABLE_COLUMNS =
  "grid-cols-[minmax(0,1fr)_78px_56px] sm:grid-cols-[minmax(0,1fr)_96px_78px_78px] lg:grid-cols-[minmax(0,1fr)_96px_78px_78px_190px_56px]";

function ProjectStatusTable({
  rows,
  loading,
  progress,
  locale,
}: {
  rows: ProjectStatusRow[];
  loading: boolean;
  progress: number;
  locale: string;
}) {
  const t = useTranslations("dashboard");

  if (loading) return <SkeletonRows rows={4} />;

  if (rows.length === 0) {
    return (
      <Link
        href="/projects?new=1"
        className="flex items-center gap-2 rounded-[10px] border border-dashed border-border-light/70 px-4 py-5 text-sm text-fg-tertiary transition-colors hover:border-accent-primary/50 hover:text-fg-primary"
      >
        <Plus size={16} />
        {t("projects.empty")}
      </Link>
    );
  }

  return (
    <div className="flex flex-col">
      <div
        className={`grid ${TABLE_COLUMNS} items-center gap-4 border-b border-border-light/60 px-1 pb-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-quaternary`}
      >
        <span>{t("projectStatus.columns.project")}</span>
        <span className="hidden sm:block">{t("projectStatus.columns.team")}</span>
        <span className="text-right">{t("projectStatus.columns.open")}</span>
        <span className="hidden text-right sm:block">{t("projectStatus.columns.overdue")}</span>
        <span className="hidden lg:block">{t("projectStatus.columns.completion")}</span>
        <span className="text-right">{t("projectStatus.columns.health")}</span>
      </div>

      {rows.map((row) => (
        <ProjectStatusRowView key={row.id} row={row} progress={progress} locale={locale} />
      ))}
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
    /* The row is a plain grid with the title carrying the link, stretched over
       the whole row by its own overlay. Wrapping the row in the anchor instead
       would have put the avatars' profile buttons inside it, which is invalid
       HTML — and the avatars have their own job to do on a click. */
    <div
      className={`group relative grid ${TABLE_COLUMNS} items-center gap-4 border-b border-border-light/40 px-1 py-3.5 transition-colors duration-[350ms] hover:bg-accent-primary/[0.06]`}
    >
      <span className="flex min-w-0 flex-col gap-1">
        <Link
          href={projectHref(row.id)}
          className="truncate text-sm font-semibold text-fg-primary after:absolute after:inset-0 after:content-['']"
        >
          {(row.title?.trim() ?? "") || t("projects.untitled")}
        </Link>
        <span className="font-mono text-[10px] text-fg-quaternary">
          {row.endsAt
            ? t("projectStatus.ends", {
                date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(
                  row.endsAt,
                ),
              })
            : t("projectStatus.noDate")}
        </span>
      </span>

      {/* Above the row overlay, so a face opens the person and not the project. */}
      <span className="relative z-10 hidden items-center sm:flex">
        <OwnerStack owners={row.owners} />
      </span>

      <span className="text-right font-mono text-[13px] tabular-nums text-fg-secondary">
        {row.open}
      </span>

      <span
        className={`hidden text-right font-mono text-[13px] tabular-nums sm:block ${
          row.overdue > 0 ? "text-error" : "text-fg-quaternary"
        }`}
      >
        {row.overdue}
      </span>

      <span className="hidden items-center gap-[11px] lg:flex">
        <span className="h-1.5 flex-1 overflow-hidden rounded-sm bg-border-light/70">
          <span
            className={`block h-full rounded-sm ${HEALTH_BAR[row.health]}`}
            style={{ width: `${percent}%` }}
          />
        </span>
        <span className="w-8 text-right font-mono text-[11px] tabular-nums text-fg-tertiary">
          {percent}%
        </span>
      </span>

      <span
        className={`text-right font-mono text-[10px] uppercase tracking-[0.1em] ${HEALTH_TEXT[row.health]}`}
      >
        {t(`projects.health.${row.health}`)}
      </span>
    </div>
  );
}

/**
 * Up to three overlapping avatars, then a count for the rest.
 *
 * Each face opens that person's profile in the app-wide drawer rather than
 * following the row's link to the project — `ProfileLink` stops the click from
 * doing both.
 */
function OwnerStack({ owners }: { owners: ProjectOwner[] }) {
  const shown = owners.slice(0, 3);
  const rest = owners.length - shown.length;

  return (
    <>
      {shown.map((owner) => (
        <ProfileLink key={owner.id} userId={owner.id} name={owner.name} className="-mr-[7px]">
          <span
            style={avatarGradientStyle(owner.id)}
            title={owner.name ?? undefined}
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg-primary text-[10px] font-semibold text-white"
          >
            {(owner.name ?? "?").trim().charAt(0).toUpperCase() || "?"}
          </span>
        </ProfileLink>
      ))}
      {rest > 0 && (
        <span className="ml-3 font-mono text-[10px] text-fg-quaternary">+{rest}</span>
      )}
    </>
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

  return (
    /* Same shape as a project row: the sentence is the link, stretched across
       the row, and the avatar sits above it so tapping a face opens the person
       rather than the project they touched. */
    <div className="relative grid grid-cols-[26px_minmax(0,1fr)_52px] items-center gap-3.5 border-b border-border-light/40 px-1 py-3 transition-colors duration-[350ms] hover:bg-dash-day/[0.06] sm:grid-cols-[26px_minmax(0,1fr)_130px_52px]">
      <ProfileLink userId={row.user?.id} name={who} className="relative z-10">
        <span
          style={avatarGradientStyle(row.user?.id ?? row.user?.email ?? who)}
          className="flex h-[26px] w-[26px] items-center justify-center rounded-full text-[11px] font-semibold text-white"
        >
          {initial}
        </span>
      </ProfileLink>
      {row.projectId ? (
        <Link
          href={projectHref(row.projectId)}
          className="truncate text-sm text-fg-secondary after:absolute after:inset-0 after:content-['']"
        >
          {message}
        </Link>
      ) : (
        <span className="truncate text-sm text-fg-secondary">{message}</span>
      )}
      <span className="hidden truncate text-xs text-fg-quaternary sm:block">
        {row.projectTitle}
      </span>
      <span className="justify-self-end font-mono text-[11px] text-fg-quaternary">
        {relativeShort(row.createdAt, now).toUpperCase()}
      </span>
    </div>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-b border-border-light/40 px-1 py-4">
          <div className="h-4 w-2/3 animate-pulse rounded bg-bg-tertiary" />
        </div>
      ))}
    </div>
  );
}
