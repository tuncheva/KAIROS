"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Flag,
  LayoutGrid,
  List,
  Plus,
  Search,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { Overlay } from "~/components/ui/Overlay";
import {
  isRecent,
  isSameDay,
  matchesFilter,
  matchesTimelineFilter,
  projectRows,
  toTimelineEvent,
  upcomingEvents,
  visibleRows,
  workspaceTotals,
  type ActivityRow,
  type EventKind,
  type FilterKey,
  type Health,
  type Person,
  type ProjectRow,
  type RawProject,
  type SortKey,
  type TimelineEvent,
  type TimelineFilter,
  type UpcomingTask,
  type ViewMode,
} from "./projectsData";

/** Blocks stage in on the shared dashboard curve; the delay separates them. */
const rise = (delay: number) => ({ animationDelay: `${delay}s` });

/** Tasks and the board still live behind the create flow. */
const projectHref = (id: number) => `/create?action=new_project&projectId=${id}`;

const FILTERS: FilterKey[] = ["all", "track", "risk", "done"];
const SORTS: SortKey[] = ["updated", "progress", "name"];
const TIMELINE_FILTERS: TimelineFilter[] = ["all", "task", "status", "note", "due"];

/**
 * Health only ever paints text and a rule, never a fill. A project one task
 * behind should not look like an error state, which is what a red card did.
 */
const HEALTH_TEXT: Record<Health, string> = {
  empty: "text-fg-quaternary",
  complete: "text-success",
  onTrack: "text-success",
  inProgress: "text-warning",
  atRisk: "text-error",
};

const HEALTH_BAR: Record<Health, string> = {
  empty: "bg-border-light/70",
  complete: "bg-success",
  onTrack: "bg-success",
  inProgress: "bg-warning",
  atRisk: "bg-error",
};

const HEALTH_BORDER: Record<Health, string> = {
  empty: "border-border-medium/60",
  complete: "border-success/40",
  onTrack: "border-success/40",
  inProgress: "border-warning/40",
  atRisk: "border-error/40",
};

/**
 * Identity colours for the avatar stack. These are deliberately not theme
 * tokens: they distinguish people from each other, so an accent switch must not
 * collapse four collaborators into one colour.
 */
const AVATAR_TINTS = ["#c084fc", "#22d3ee", "#fbbf24", "#4ade80", "#f87171", "#a5b4fc"];

const EVENT_ICON: Record<EventKind, typeof Check> = {
  task: Check,
  status: Flag,
  note: StickyNote,
  due: CalendarClock,
};

const EVENT_TINT: Record<EventKind, string> = {
  task: "text-success",
  status: "text-warning",
  note: "text-accent-secondary",
  due: "text-fg-tertiary",
};

export function ProjectsWorkspace({ userId }: { userId: string }) {
  const t = useTranslations("projects");
  const toast = useToast();
  const locale = useLocale();
  const utils = api.useUtils();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("updated");
  const [view, setView] = useState<ViewMode>("list");
  const [openId, setOpenId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const projectsQuery = api.project.getMyProjects.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
  });

  const deleteProject = api.project.delete.useMutation({
    onSuccess: async () => {
      setConfirmDeleteId(null);
      setOpenId(null);
      toast.success(t("deleted"));
      await utils.project.getMyProjects.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  // One clock for the whole page, so a row cannot say "today" while the
  // timeline below it files the same event under yesterday.
  const now = useMemo(() => new Date(), []);

  const rows = useMemo(
    () => projectRows((projectsQuery.data ?? []) as RawProject[], now),
    [projectsQuery.data, now],
  );

  const shown = useMemo(() => visibleRows(rows, { query, filter, sort }), [rows, query, filter, sort]);
  const totals = useMemo(() => workspaceTotals(rows), [rows]);
  const opened = useMemo(() => rows.find((row) => row.id === openId) ?? null, [rows, openId]);

  if (projectsQuery.isLoading) {
    return <LoadingState />;
  }

  if (rows.length === 0) {
    return <FirstRun />;
  }

  return (
    <div className="flex flex-col gap-[26px] px-4 pt-9 pb-14 sm:px-10">
      {confirmDeleteId !== null && (
        <DeleteDialog
          pending={deleteProject.isPending}
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => deleteProject.mutate({ id: confirmDeleteId })}
        />
      )}

      {opened ? (
        <ProjectDetail
          project={opened}
          userId={userId}
          locale={locale}
          now={now}
          onBack={() => setOpenId(null)}
          onDelete={() => setConfirmDeleteId(opened.id)}
        />
      ) : (
        <>
          <header className="dash-rise" style={rise(0.05)}>
            <h1 className="m-0 text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] text-fg-primary">
              {t("title")}
            </h1>
            <p className="mt-2.5 text-[15px] text-fg-tertiary">
              {t("summary", {
                shown: shown.length,
                projects: rows.length,
                done: totals.completed,
                tasks: totals.tasks,
              })}
            </p>
          </header>

          <div className="dash-rise flex flex-wrap items-center gap-3" style={rise(0.1)}>
            <label className="flex h-9 w-full items-center gap-2.5 rounded-lg border border-border-light/60 bg-bg-secondary px-3 sm:w-[260px]">
              <Search size={15} className="flex-none text-fg-quaternary" aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
                className="min-w-0 flex-1 bg-transparent text-sm text-fg-primary outline-none placeholder:text-fg-quaternary"
              />
            </label>

            <div className="flex gap-1.5">
              {FILTERS.map((key) => (
                <Toggle key={key} active={filter === key} onClick={() => setFilter(key)}>
                  {t(`filters.${key}`)}
                  <span className="font-mono text-[11px] text-fg-quaternary">
                    {rows.filter((row) => matchesFilter(row, key)).length}
                  </span>
                </Toggle>
              ))}
            </div>

            <span className="hidden flex-1 lg:block" />

            <div className="flex items-center gap-2">
              <span className="kairos-stamp text-[10px] tracking-[0.14em] text-fg-quaternary">
                {t("sortLabel")}
              </span>
              <div className="flex overflow-hidden rounded-lg border border-border-light/60">
                {SORTS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSort(key)}
                    aria-pressed={sort === key}
                    className={`h-[34px] px-3 text-[13px] font-medium transition-colors duration-300 ${
                      sort === key
                        ? "bg-accent-primary/[0.16] text-fg-primary"
                        : "text-fg-tertiary hover:text-fg-secondary"
                    }`}
                  >
                    {t(`sorts.${key}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex overflow-hidden rounded-lg border border-border-light/60">
              {(
                [
                  { key: "list" as ViewMode, Icon: List },
                  { key: "grid" as ViewMode, Icon: LayoutGrid },
                ]
              ).map(({ key, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  aria-pressed={view === key}
                  aria-label={t(`views.${key}`)}
                  title={t(`views.${key}`)}
                  className={`flex h-[34px] w-9 items-center justify-center transition-colors duration-300 ${
                    view === key
                      ? "bg-accent-primary/[0.16] text-fg-primary"
                      : "text-fg-quaternary hover:text-fg-secondary"
                  }`}
                >
                  <Icon size={16} aria-hidden />
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="dash-fade px-1 py-9 text-sm text-fg-tertiary">
              {query.trim() ? t("noMatch", { query: query.trim() }) : t("noneInFilter")}
            </div>
          ) : view === "list" ? (
            <ProjectTable rows={shown} locale={locale} onOpen={setOpenId} />
          ) : (
            <ProjectGrid rows={shown} locale={locale} onOpen={setOpenId} />
          )}

          <StatStrip
            items={[
              { label: t("stats.active"), value: String(totals.active) },
              { label: t("stats.tasks"), value: String(totals.tasks) },
              { label: t("stats.completed"), value: String(totals.completed), tone: "text-success" },
              { label: t("stats.overall"), value: `${totals.percent}%`, tone: "text-accent-secondary" },
            ]}
          />
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- browse */

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-9 items-center gap-[7px] rounded-lg border px-3 text-[13px] font-medium transition-colors duration-300 ${
        active
          ? "border-accent-primary/55 bg-accent-primary/[0.14] text-fg-primary"
          : "border-border-light/60 text-fg-tertiary hover:border-border-strong/60 hover:text-fg-secondary"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The list view. A row is one project's whole reading: name and purpose, the
 * completion rule, the team and when it last moved. The rule is the width of
 * the progress, not a bar in a box — at this density a boxed bar was louder
 * than the name above it.
 */
function ProjectTable({
  rows,
  locale,
  onOpen,
}: {
  rows: ProjectRow[];
  locale: string;
  onOpen: (id: number) => void;
}) {
  const t = useTranslations("projects");

  return (
    <div className="dash-fade border-t border-border-light/60">
      <div className="hidden grid-cols-[minmax(0,1fr)_190px_52px_96px_116px_16px] items-center gap-5 border-b border-border-light/50 px-1 py-3 lg:grid">
        {(["colProject", "colProgress", "", "colTeam", "colUpdated", ""] as const).map(
          (key, index) => (
            <span
              key={index}
              className="kairos-stamp text-[10px] tracking-[0.14em] text-fg-quaternary"
            >
              {key ? t(key) : ""}
            </span>
          ),
        )}
      </div>

      {rows.map((row, index) => (
        <button
          key={row.id}
          type="button"
          onClick={() => onOpen(row.id)}
          style={rise(0.14 + index * 0.05)}
          className="dash-rise grid w-full grid-cols-[minmax(0,1fr)_52px] items-center gap-5 border-b border-border-light/50 px-1 py-4 text-left transition-colors duration-[350ms] hover:bg-accent-primary/[0.07] lg:grid-cols-[minmax(0,1fr)_190px_52px_96px_116px_16px]"
        >
          <span className="min-w-0">
            <span className="block truncate text-base font-medium tracking-[-0.01em] text-fg-primary">
              {row.title || t("untitled")}
            </span>
            <span className="mt-1 block truncate text-[13px] text-fg-tertiary">
              {row.description || t("noDescription")}
            </span>
          </span>

          <span className="hidden h-[3px] overflow-hidden rounded-sm bg-border-light/70 lg:block">
            <span
              className={`dash-grow block h-full rounded-sm ${HEALTH_BAR[row.health]}`}
              style={{ width: `${row.percent}%`, animationDelay: `${0.14 + index * 0.05}s` }}
            />
          </span>

          <span
            className={`text-right text-sm font-medium tabular-nums lg:text-left ${HEALTH_TEXT[row.health]}`}
          >
            {row.total > 0 ? `${row.percent}%` : "—"}
          </span>

          <span className="hidden lg:block">
            <AvatarStack people={row.people} ringClass="border-bg-primary" />
          </span>

          <span className="hidden font-mono text-[11px] text-fg-quaternary lg:block">
            <UpdatedStamp row={row} locale={locale} />
          </span>

          <ChevronRight size={16} className="hidden text-fg-quaternary lg:block" aria-hidden />
        </button>
      ))}
    </div>
  );
}

/** The grid view leads with the number, because at card size that is the row. */
function ProjectGrid({
  rows,
  locale,
  onOpen,
}: {
  rows: ProjectRow[];
  locale: string;
  onOpen: (id: number) => void;
}) {
  const t = useTranslations("projects");

  return (
    <div className="dash-fade grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row, index) => (
        <button
          key={row.id}
          type="button"
          onClick={() => onOpen(row.id)}
          style={rise(0.14 + index * 0.05)}
          className="dash-rise flex flex-col gap-[18px] rounded-xl border border-border-light/60 bg-bg-elevated p-[22px] pb-[18px] text-left transition-colors duration-[350ms] hover:border-accent-primary/40 hover:bg-bg-tertiary"
        >
          <span>
            <span className="block truncate text-base font-semibold tracking-[-0.01em] text-fg-primary">
              {row.title || t("untitled")}
            </span>
            <span className="mt-1.5 block text-[13px] leading-[1.45] text-fg-tertiary">
              {row.description || t("noDescription")}
            </span>
          </span>

          <span className="flex items-end justify-between gap-3">
            <span
              className={`text-[38px] font-semibold leading-none tabular-nums tracking-[-0.03em] ${HEALTH_TEXT[row.health]}`}
            >
              {row.total > 0 ? `${row.percent}%` : "—"}
            </span>
            <HealthBadge health={row.health} />
          </span>

          <span className="h-1 overflow-hidden rounded-sm bg-border-light/70">
            <span
              className={`dash-grow block h-full rounded-sm ${HEALTH_BAR[row.health]}`}
              style={{ width: `${row.percent}%`, animationDelay: `${0.14 + index * 0.05}s` }}
            />
          </span>

          <span className="flex items-center justify-between gap-3 border-t border-border-light/50 pt-3.5">
            <AvatarStack people={row.people} ringClass="border-bg-elevated" />
            <span className="font-mono text-[11px] text-fg-quaternary">
              <UpdatedStamp row={row} locale={locale} />
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function HealthBadge({ health }: { health: Health }) {
  const t = useTranslations("projects");
  return (
    <span
      className={`kairos-stamp rounded border px-2 py-1 text-[10px] tracking-[0.12em] ${HEALTH_BORDER[health]} ${HEALTH_TEXT[health]}`}
    >
      {t(`health.${health}`)}
    </span>
  );
}

function StatStrip({
  items,
}: {
  items: { label: string; value: string; tone?: string }[];
}) {
  return (
    <div
      className="dash-rise grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-border-light/60 bg-border-light/60 sm:grid-cols-4"
      style={rise(0.3)}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="bg-bg-elevated px-5 py-[18px] transition-colors duration-[350ms] hover:bg-bg-tertiary"
        >
          <div className="kairos-stamp text-[10px] tracking-[0.14em] text-fg-tertiary">
            {item.label}
          </div>
          <div
            className={`mt-2 text-[26px] font-semibold tabular-nums tracking-[-0.02em] ${item.tone ?? "text-fg-primary"}`}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Compact age stamp. `formatDistanceToNow` returned "about 1 month" here, which
 * does not fit a 116px column and reads as prose next to mono numerals.
 */
function UpdatedStamp({ row, locale }: { row: ProjectRow; locale: string }) {
  const t = useTranslations("projects");
  if (!row.updatedAt) return <>{t("updated.never")}</>;
  const days = row.ageDays;
  if (days === 0) return <>{t("updated.today")}</>;
  if (days < 7) return <>{t("updated.days", { count: days })}</>;
  if (days < 14) return <>{t("updated.week")}</>;
  if (days < 60) return <>{t("updated.weeks", { count: Math.round(days / 7) })}</>;
  return (
    <>
      {new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" })
        .format(row.updatedAt)
        .toUpperCase()}
    </>
  );
}

function AvatarStack({ people, ringClass }: { people: Person[]; ringClass: string }) {
  const shown = people.slice(0, 4);
  const overflow = people.length - shown.length;

  if (people.length === 0) {
    return (
      <span
        className={`flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 bg-bg-tertiary text-[11px] font-bold text-fg-quaternary ${ringClass}`}
      >
        —
      </span>
    );
  }

  return (
    <span className="flex">
      {shown.map((person, index) =>
        person.image ? (
          <Image
            key={person.id}
            src={person.image}
            alt={person.name ?? ""}
            width={26}
            height={26}
            className={`-mr-[7px] h-[26px] w-[26px] rounded-full border-2 object-cover ${ringClass}`}
          />
        ) : (
          <span
            key={person.id}
            title={person.name ?? undefined}
            style={{ backgroundColor: AVATAR_TINTS[index % AVATAR_TINTS.length] }}
            className={`-mr-[7px] flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 text-[11px] font-bold text-[#0a0a10] ${ringClass}`}
          >
            {(person.name ?? "?").trim().charAt(0).toUpperCase() || "?"}
          </span>
        ),
      )}
      {overflow > 0 && (
        <span
          className={`-mr-[7px] flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 bg-bg-tertiary text-[10px] font-bold text-fg-tertiary ${ringClass}`}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------- detail */

/**
 * One project, opened in place.
 *
 * The reading is a single timeline: what is still coming above a "now" marker,
 * then what has happened below it, most recent first. Splitting those into two
 * panels made the same project's future and past look like unrelated lists.
 */
function ProjectDetail({
  project,
  userId,
  locale,
  now,
  onBack,
  onDelete,
}: {
  project: ProjectRow;
  userId: string;
  locale: string;
  now: Date;
  onBack: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("projects");
  const [kind, setKind] = useState<TimelineFilter>("all");
  const [showEarlier, setShowEarlier] = useState(false);

  const activityQuery = api.task.getProjectActivity.useQuery({
    projectId: project.id,
    limit: 100,
  });
  const tasksQuery = api.task.getByProject.useQuery({ projectId: project.id });

  const someone = t("timeline.someone");

  const events = useMemo(() => {
    const past = ((activityQuery.data ?? []) as ActivityRow[])
      .map((row) => toTimelineEvent(row, someone))
      .filter((event): event is TimelineEvent => event !== null)
      .sort((a, b) => b.at.getTime() - a.at.getTime());
    const future = upcomingEvents((tasksQuery.data ?? []) as UpcomingTask[], now);
    return { past, future };
  }, [activityQuery.data, tasksQuery.data, now, someone]);

  const future = events.future.filter((event) => matchesTimelineFilter(event, kind));
  const past = events.past.filter((event) => matchesTimelineFilter(event, kind));
  const recent = past.filter((event) => isRecent(event, now));
  const earlier = past.length - recent.length;
  const shownPast = showEarlier ? past : recent;

  const loading = activityQuery.isLoading || tasksQuery.isLoading;

  return (
    <div className="dash-fade flex flex-col gap-[26px]">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-[13px] font-medium text-fg-tertiary transition-colors hover:text-fg-primary"
        >
          <ArrowLeft size={15} aria-hidden />
          {t("back")}
        </button>

        <div className="flex items-center gap-2">
          <Link
            href={projectHref(project.id)}
            className="flex items-center gap-2 rounded-lg border border-border-light/60 px-3 py-2 text-[13px] font-medium text-fg-secondary transition-colors duration-300 hover:border-accent-primary/40 hover:text-fg-primary"
          >
            {t("openBoard")}
            <ChevronRight size={14} aria-hidden />
          </Link>
          {project.createdById === userId && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={t("delete.title")}
              title={t("delete.title")}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-border-light/60 text-fg-quaternary transition-colors duration-300 hover:border-error/40 hover:text-error"
            >
              <Trash2 size={16} strokeWidth={1.5} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="dash-rise flex flex-col gap-[18px]" style={rise(0.05)}>
        <div className="flex flex-wrap items-center gap-3.5">
          <h1 className="m-0 text-[32px] font-semibold leading-[1.1] tracking-[-0.025em] text-fg-primary">
            {project.title || t("untitled")}
          </h1>
          <HealthBadge health={project.health} />
          <span className="hidden flex-1 sm:block" />
          <AvatarStack people={project.people} ringClass="border-bg-primary" />
        </div>

        <p className="m-0 text-[15px] text-fg-tertiary">
          {project.description || t("noDescription")}
        </p>

        <StatStrip
          items={[
            {
              label: t("stats.progress"),
              value: project.total > 0 ? `${project.percent}%` : "—",
              tone: HEALTH_TEXT[project.health],
            },
            { label: t("stats.done"), value: String(project.done), tone: "text-success" },
            { label: t("stats.inProgress"), value: String(project.inProgress), tone: "text-warning" },
            { label: t("stats.todo"), value: String(project.todo) },
          ]}
        />
      </div>

      <div className="dash-rise flex flex-wrap items-center gap-3" style={rise(0.1)}>
        <span className="kairos-stamp text-[10px] tracking-[0.14em] text-fg-quaternary">
          {t("timeline.label")}
        </span>
        {TIMELINE_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setKind(key)}
            aria-pressed={kind === key}
            className={`h-8 rounded-lg border px-3 text-[13px] font-medium transition-colors duration-300 ${
              kind === key
                ? "border-accent-primary/55 bg-accent-primary/[0.14] text-fg-primary"
                : "border-border-light/60 text-fg-tertiary hover:border-border-strong/60 hover:text-fg-secondary"
            }`}
          >
            {t(`timeline.kinds.${key}`)}
          </button>
        ))}
        <span className="hidden flex-1 sm:block" />
        <span className="font-mono text-[11px] text-fg-quaternary">
          {t("timeline.count", { count: future.length + past.length })}
        </span>
      </div>

      <div className="flex flex-col">
        {loading ? (
          <TimelineSkeleton />
        ) : future.length + past.length === 0 ? (
          <p className="px-1 py-8 text-sm text-fg-tertiary">{t("timeline.empty")}</p>
        ) : (
          <>
            {future.map((event, index) => (
              <TimelineRow
                key={event.key}
                event={event}
                locale={locale}
                now={now}
                previous={future[index - 1]}
                index={index}
              />
            ))}

            <NowMarker now={now} locale={locale} />

            {shownPast.map((event, index) => (
              <TimelineRow
                key={event.key}
                event={event}
                locale={locale}
                now={now}
                previous={shownPast[index - 1]}
                index={index}
              />
            ))}

            {earlier > 0 && (
              <div className="grid grid-cols-[52px_26px_minmax(0,1fr)] items-center gap-3.5 px-1 pt-1.5 sm:grid-cols-[62px_26px_minmax(0,1fr)]">
                <span />
                <span className="relative flex min-h-[28px] self-stretch justify-center">
                  <span className="absolute -top-3.5 bottom-3.5 w-0.5 bg-accent-primary/40" aria-hidden />
                </span>
                <button
                  type="button"
                  onClick={() => setShowEarlier((value) => !value)}
                  className="flex h-[34px] items-center gap-2.5 justify-self-start rounded-lg border border-border-light/60 bg-bg-secondary px-3.5 text-[13px] font-medium text-fg-secondary transition-colors duration-300 hover:border-accent-primary/40 hover:text-fg-primary"
                >
                  {showEarlier ? t("timeline.hideEarlier") : t("timeline.showEarlier")}
                  <span className="font-mono text-[11px] text-fg-quaternary">{earlier}</span>
                  <ChevronDown
                    size={14}
                    aria-hidden
                    className={`transition-transform duration-[350ms] ${showEarlier ? "rotate-180" : ""}`}
                  />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Day heading, shown only when the day changes. */
function dayHeading(
  event: TimelineEvent,
  previous: TimelineEvent | undefined,
  now: Date,
  locale: string,
  labels: { today: string; yesterday: string },
): string | null {
  if (previous && isSameDay(previous.at, event.at)) return null;
  if (isSameDay(event.at, now)) return labels.today;
  if (isSameDay(event.at, new Date(now.getTime() - 86_400_000))) return labels.yesterday;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" })
    .format(event.at)
    .toUpperCase();
}

function TimelineRow({
  event,
  locale,
  now,
  previous,
  index,
}: {
  event: TimelineEvent;
  locale: string;
  now: Date;
  previous: TimelineEvent | undefined;
  index: number;
}) {
  const t = useTranslations("projects");
  const Icon = EVENT_ICON[event.kind];

  const heading = dayHeading(event, previous, now, locale, {
    today: t("timeline.today"),
    yesterday: t("timeline.yesterday"),
  });

  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
    event.at,
  );

  return (
    <div
      className={`dash-rise ${event.future ? "opacity-60" : ""}`}
      style={rise(0.1 + index * 0.04)}
    >
      {heading && (
        <div className="kairos-stamp px-1 pt-4 pb-2.5 text-[10px] tracking-[0.16em] text-fg-quaternary">
          {heading}
        </div>
      )}
      <div className="grid grid-cols-[52px_26px_minmax(0,1fr)] items-start gap-3.5 px-1 py-3.5 transition-colors duration-[350ms] hover:bg-accent-primary/[0.06] sm:grid-cols-[62px_26px_minmax(0,1fr)]">
        <span className="pt-[3px] font-mono text-[11px] text-fg-quaternary">{time}</span>

        <span className="relative flex self-stretch justify-center">
          <span
            aria-hidden
            className={`absolute -top-3.5 -bottom-3.5 w-0.5 ${
              event.future ? "bg-border-light/70" : "bg-accent-primary/40"
            }`}
          />
          <span
            className={`relative mt-1 flex h-[15px] w-[15px] items-center justify-center rounded-full border bg-bg-primary ${
              event.future ? "border-border-medium/70" : "border-accent-primary/50"
            }`}
          >
            <Icon size={8} strokeWidth={3} className={EVENT_TINT[event.kind]} aria-hidden />
          </span>
        </span>

        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-[15px] leading-[1.4] text-fg-secondary">
            <span className="font-semibold text-fg-primary">{event.actor}</span>{" "}
            {t(`timeline.verbs.${event.verb}`)}{" "}
            {event.target && <span className="font-medium text-fg-primary">{event.target}</span>}
          </span>
          {event.detail && (
            <span className="truncate text-[13px] text-fg-quaternary">{event.detail}</span>
          )}
        </span>
      </div>
    </div>
  );
}

/** The hinge between what is coming and what has happened. */
function NowMarker({ now, locale }: { now: Date; locale: string }) {
  const t = useTranslations("projects");
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(now);

  return (
    <div className="grid grid-cols-[52px_26px_minmax(0,1fr)] items-center gap-3.5 px-1 py-2 sm:grid-cols-[62px_26px_minmax(0,1fr)]">
      <span className="font-mono text-[11px] text-accent-secondary">{time}</span>
      <span className="flex justify-center">
        <span className="h-[11px] w-[11px] rounded-full bg-accent-primary shadow-[0_0_0_4px_rgb(var(--accent-primary)/0.18)]" />
      </span>
      <span className="flex items-center gap-3">
        <span className="kairos-stamp text-[10px] tracking-[0.18em] text-accent-secondary">
          {t("timeline.now")}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-accent-primary/50 to-transparent" />
      </span>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="border-b border-border-light/50 px-1 py-4">
          <div className="h-4 w-2/3 animate-pulse rounded bg-bg-tertiary" />
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- shell */

function LoadingState() {
  return (
    <div className="flex flex-col gap-[26px] px-4 pt-9 pb-14 sm:px-10">
      <div className="h-9 w-64 animate-pulse rounded bg-bg-tertiary" />
      <div className="h-9 w-full max-w-xl animate-pulse rounded bg-bg-tertiary" />
      <div className="border-t border-border-light/60">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="border-b border-border-light/50 px-1 py-5">
            <div className="h-4 w-1/3 animate-pulse rounded bg-bg-tertiary" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * No projects at all. The populated page is a filterable list of nothing, so
 * this says what to do instead.
 */
function FirstRun() {
  const t = useTranslations("projects");

  return (
    <div className="flex min-h-[420px] flex-col justify-center gap-6 px-4 py-16 sm:px-10">
      <div className="dash-rise" style={rise(0.05)}>
        <div className="kairos-stamp text-[11px] tracking-[0.16em] text-accent-secondary">
          {t("empty.tag")}
        </div>
        <h1 className="mt-3.5 max-w-[620px] text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-fg-primary">
          {t("empty.title")}
        </h1>
        <p className="mt-3 max-w-[520px] text-[17px] leading-[1.6] text-fg-tertiary">
          {t("empty.body")}
        </p>
      </div>
      <Link
        href="/create?action=new_project"
        className="dash-rise flex w-fit items-center gap-2.5 rounded-[10px] bg-accent-primary px-[22px] py-[15px] text-[15px] font-semibold text-white transition-all duration-[350ms] hover:-translate-y-0.5 hover:bg-accent-hover"
        style={rise(0.15)}
      >
        <Plus size={17} aria-hidden />
        {t("empty.cta")}
      </Link>
    </div>
  );
}

function DeleteDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("projects");

  return (
    <Overlay>
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <button type="button" aria-label={t("delete.cancel")} onClick={onCancel} className="absolute inset-0" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-sm rounded-2xl border border-border-light/60 bg-bg-secondary p-6 shadow-2xl"
      >
        <h2 className="m-0 text-lg font-semibold text-fg-primary">{t("delete.title")}</h2>
        <p className="mt-2 text-sm text-fg-tertiary">{t("delete.body")}</p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
          >
            {t("delete.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-lg bg-error px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t("delete.confirm")}
          </button>
        </div>
      </div>
    </div>
    </Overlay>
  );
}
