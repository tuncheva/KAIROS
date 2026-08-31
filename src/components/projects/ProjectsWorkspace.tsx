"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Flag,
  LayoutGrid,
  List,
  Search,
  StickyNote,
  Trash2,
} from "~/components/ui/icons";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { Overlay } from "~/components/ui/Overlay";
import { NewProjectDrawer } from "./NewProjectDrawer";
import { ProfileLink } from "~/components/profile/ProfileLink";
import { avatarGradientStyle } from "~/lib/avatarGradient";
import { ProjectTasksPanel, ProjectTeamPanel } from "./ProjectTasksPanel";
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

const FILTERS: FilterKey[] = ["all", "track", "risk", "done"];
const SORTS: SortKey[] = ["updated", "progress", "name"];
const TIMELINE_FILTERS: TimelineFilter[] = [
  "all",
  "task",
  "status",
  "note",
  "due",
];

/** The three readings of one project: what to do, who is on it, what happened. */
const DETAIL_TABS = ["tasks", "team", "timeline"] as const;

/** Narrows a `?tab=` value; anything unrecognised falls back to the board. */
export function isDetailTab(value: string | null | undefined): value is DetailTab {
  return value !== null && value !== undefined && DETAIL_TABS.includes(value as DetailTab);
}
type DetailTab = (typeof DETAIL_TABS)[number];

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

export function ProjectsWorkspace({
  userId,
  initialProjectId = null,
  initialTab = "tasks",
}: {
  userId: string;
  /** `/projects?projectId=` opens straight into one project. */
  initialProjectId?: number | null;
  /** `&tab=` opens that project on its board, team or timeline. */
  initialTab?: DetailTab;
}) {
  const t = useTranslations("projects");
  const toast = useToast();
  const locale = useLocale();
  const utils = api.useUtils();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("updated");
  const [view, setView] = useState<ViewMode>("list");
  const [openId, setOpenId] = useState<number | null>(initialProjectId);
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  /* A project opened in place used to leave the URL on `/projects`, so the one
     thing people do with a project they are looking at — send it to someone —
     was impossible, and Back skipped past the whole detail view to whatever
     came before the page.

     History API rather than `router.push`: the detail is already rendered on
     the client from a list this page has in cache, so a real navigation would
     re-run the server component to arrive at the state we are already in.
     Opening pushes (Back should close the project); switching tabs replaces
     (a tab is a refinement, not a step of its own). */
  const projectUrl = useCallback(
    (id: number | null, detailTab: DetailTab) =>
      id === null ? "/projects" : `/projects?projectId=${id}&tab=${detailTab}`,
    [],
  );

  const openProject = useCallback(
    (id: number) => {
      setOpenId(id);
      setTab("tasks");
      window.history.pushState(null, "", projectUrl(id, "tasks"));
    },
    [projectUrl],
  );

  const selectTab = useCallback(
    (next: DetailTab) => {
      setTab(next);
      if (openId !== null) window.history.replaceState(null, "", projectUrl(openId, next));
    },
    [openId, projectUrl],
  );

  /* Back and Forward move between the list and the open project, so the state
     has to follow the URL rather than the other way round. */
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("projectId");
      const id = raw === null ? null : Number(raw);
      setOpenId(id !== null && Number.isInteger(id) && id > 0 ? id : null);
      const nextTab = params.get("tab");
      setTab(isDetailTab(nextTab) ? nextTab : "tasks");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const closeProject = useCallback(() => {
    setOpenId(null);
    window.history.pushState(null, "", projectUrl(null, "tasks"));
  }, [projectUrl]);

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

  const shown = useMemo(
    () => visibleRows(rows, { query, filter, sort, locale }),
    [rows, query, filter, sort, locale],
  );
  const totals = useMemo(() => workspaceTotals(rows), [rows]);
  const opened = useMemo(
    () => rows.find((row) => row.id === openId) ?? null,
    [rows, openId],
  );

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
          tab={tab}
          onTabChange={selectTab}
          userId={userId}
          locale={locale}
          now={now}
          onBack={closeProject}
          onDelete={() => setConfirmDeleteId(opened.id)}
        />
      ) : (
        <>
          <header className="dash-rise" style={rise(0.05)}>
            <h1 className="text-fg-primary m-0 text-[34px] leading-[1.1] font-semibold tracking-[-0.025em]">
              {t("title")}
            </h1>
            <p className="text-fg-tertiary mt-2.5 text-[15px]">
              {t("summary", {
                shown: shown.length,
                projects: rows.length,
                done: totals.completed,
                tasks: totals.tasks,
              })}
            </p>
          </header>

          <div
            className="dash-rise flex flex-wrap items-center gap-3"
            style={rise(0.1)}
          >
            <label className="border-border-light/60 bg-bg-secondary flex h-9 w-full items-center gap-2.5 rounded-lg border px-3 sm:w-[260px]">
              <Search
                size={15}
                className="text-fg-quaternary flex-none"
                aria-hidden
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
                className="text-fg-primary placeholder:text-fg-quaternary min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>

            <div className="flex gap-1.5">
              {FILTERS.map((key) => (
                <Toggle
                  key={key}
                  active={filter === key}
                  onClick={() => setFilter(key)}
                >
                  {t(`filters.${key}`)}
                  <span className="text-fg-quaternary font-mono text-[11px]">
                    {rows.filter((row) => matchesFilter(row, key)).length}
                  </span>
                </Toggle>
              ))}
            </div>

            <span className="hidden flex-1 lg:block" />

            <div className="flex items-center gap-2">
              <span className="kairos-stamp text-fg-quaternary text-[10px] tracking-[0.14em]">
                {t("sortLabel")}
              </span>
              <div className="border-border-light/60 flex overflow-hidden rounded-lg border">
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

            <div className="border-border-light/60 flex overflow-hidden rounded-lg border">
              {[
                { key: "list" as ViewMode, Icon: List },
                { key: "grid" as ViewMode, Icon: LayoutGrid },
              ].map(({ key, Icon }) => (
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
            <div className="dash-fade text-fg-tertiary px-1 py-9 text-sm">
              {query.trim()
                ? t("noMatch", { query: query.trim() })
                : t("noneInFilter")}
            </div>
          ) : view === "list" ? (
            <ProjectTable rows={shown} locale={locale} onOpen={openProject} />
          ) : (
            <ProjectGrid rows={shown} locale={locale} onOpen={openProject} />
          )}

          <StatStrip
            items={[
              { label: t("stats.active"), value: String(totals.active) },
              { label: t("stats.tasks"), value: String(totals.tasks) },
              {
                label: t("stats.completed"),
                value: String(totals.completed),
                tone: "text-success",
              },
              {
                label: t("stats.overall"),
                value: `${totals.percent}%`,
                tone: "text-accent-secondary",
              },
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
    <div className="dash-fade border-border-light/60 border-t">
      <div className="border-border-light/50 hidden grid-cols-[minmax(0,1fr)_190px_52px_96px_116px_16px] items-center gap-5 border-b px-1 py-3 lg:grid">
        {(
          [
            "colProject",
            "colProgress",
            "",
            "colTeam",
            "colUpdated",
            "",
          ] as const
        ).map((key, index) => (
          <span
            key={index}
            className="kairos-stamp text-fg-quaternary text-[10px] tracking-[0.14em]"
          >
            {key ? t(key) : ""}
          </span>
        ))}
      </div>

      {rows.map((row, index) => (
        /* The row is a div with a full-bleed button laid over it rather than
           one big button, because the collaborator faces inside it have to be
           buttons of their own and a button cannot nest. The overlay carries
           the click, the focus ring and the accessible name; anything that
           needs to sit above it says so with `relative z-10`. */
        <div
          key={row.id}
          style={rise(0.14 + index * 0.05)}
          className="dash-rise border-border-light/50 hover:bg-accent-primary/[0.07] relative grid w-full grid-cols-[minmax(0,1fr)_52px] items-center gap-5 border-b px-1 py-4 text-left transition-colors duration-[350ms] lg:grid-cols-[minmax(0,1fr)_190px_52px_96px_116px_16px]"
        >
          <button
            type="button"
            onClick={() => onOpen(row.id)}
            aria-label={row.title || t("untitled")}
            className="focus-visible:ring-accent-primary absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset"
          />

          <span className="min-w-0">
            <span className="text-fg-primary block truncate text-base font-medium tracking-[-0.01em]">
              {row.title || t("untitled")}
            </span>
            <span className="text-fg-tertiary mt-1 block truncate text-[13px]">
              {row.description || t("noDescription")}
            </span>
          </span>

          <span className="bg-border-light/70 hidden h-[3px] overflow-hidden rounded-sm lg:block">
            <span
              className={`dash-grow block h-full rounded-sm ${HEALTH_BAR[row.health]}`}
              style={{
                width: `${row.percent}%`,
                animationDelay: `${0.14 + index * 0.05}s`,
              }}
            />
          </span>

          <span
            className={`text-right text-sm font-medium tabular-nums lg:text-left ${HEALTH_TEXT[row.health]}`}
          >
            {row.total > 0 ? `${row.percent}%` : "—"}
          </span>

          <span className="relative z-10 hidden lg:block">
            <AvatarStack
              people={row.people}
              ringClass="border-bg-primary"
              interactive
            />
          </span>

          <span className="text-fg-quaternary hidden font-mono text-[11px] lg:block">
            <UpdatedStamp row={row} locale={locale} />
          </span>

          <ChevronRight
            size={16}
            className="text-fg-quaternary hidden lg:block"
            aria-hidden
          />
        </div>
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
        /* Overlay-button row, for the same reason as the table above. */
        <div
          key={row.id}
          style={rise(0.14 + index * 0.05)}
          className="dash-rise border-border-light/60 bg-bg-elevated hover:border-accent-primary/40 hover:bg-bg-tertiary relative flex flex-col gap-[18px] rounded-xl border p-[22px] pb-[18px] text-left transition-colors duration-[350ms]"
        >
          <button
            type="button"
            onClick={() => onOpen(row.id)}
            aria-label={row.title || t("untitled")}
            className="focus-visible:ring-accent-primary absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset"
          />

          <span>
            <span className="text-fg-primary block truncate text-base font-semibold tracking-[-0.01em]">
              {row.title || t("untitled")}
            </span>
            <span className="text-fg-tertiary mt-1.5 block text-[13px] leading-[1.45]">
              {row.description || t("noDescription")}
            </span>
          </span>

          <span className="flex items-end justify-between gap-3">
            <span
              className={`text-[38px] leading-none font-semibold tracking-[-0.03em] tabular-nums ${HEALTH_TEXT[row.health]}`}
            >
              {row.total > 0 ? `${row.percent}%` : "—"}
            </span>
            <HealthBadge health={row.health} />
          </span>

          <span className="bg-border-light/70 h-1 overflow-hidden rounded-sm">
            <span
              className={`dash-grow block h-full rounded-sm ${HEALTH_BAR[row.health]}`}
              style={{
                width: `${row.percent}%`,
                animationDelay: `${0.14 + index * 0.05}s`,
              }}
            />
          </span>

          <span className="border-border-light/50 flex items-center justify-between gap-3 border-t pt-3.5">
            <span className="relative z-10">
              <AvatarStack
                people={row.people}
                ringClass="border-bg-elevated"
                interactive
              />
            </span>
            <span className="text-fg-quaternary font-mono text-[11px]">
              <UpdatedStamp row={row} locale={locale} />
            </span>
          </span>
        </div>
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
      className="dash-rise border-border-light/60 bg-border-light/60 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border sm:grid-cols-4"
      style={rise(0.3)}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="bg-bg-elevated hover:bg-bg-tertiary px-5 py-[18px] transition-colors duration-[350ms]"
        >
          <div className="kairos-stamp text-fg-tertiary text-[10px] tracking-[0.14em]">
            {item.label}
          </div>
          <div
            className={`mt-2 text-[26px] font-semibold tracking-[-0.02em] tabular-nums ${item.tone ?? "text-fg-primary"}`}
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
  if (days < 60)
    return <>{t("updated.weeks", { count: Math.round(days / 7) })}</>;
  return (
    <>
      {new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" })
        .format(row.updatedAt)
        .toUpperCase()}
    </>
  );
}

/**
 * The face pile.
 *
 * `interactive` is off by default and that is not laziness: two of the three
 * call sites sit inside a `<button>` row, where a nested button is invalid
 * markup and where the row's own tap — open the project — is the action the
 * viewer wants anyway. Only the project header, which is not inside a button,
 * turns faces into profile links.
 */
function AvatarStack({
  people,
  ringClass,
  interactive = false,
}: {
  people: Person[];
  ringClass: string;
  interactive?: boolean;
}) {
  const shown = people.slice(0, 4);
  const overflow = people.length - shown.length;

  if (people.length === 0) {
    return (
      <span
        className={`bg-bg-tertiary text-fg-quaternary flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 text-[11px] font-bold ${ringClass}`}
      >
        —
      </span>
    );
  }

  const face = (person: Person) =>
    person.image ? (
      <Image
        src={person.image}
        alt={person.name ?? ""}
        width={26}
        height={26}
        className={`h-[26px] w-[26px] rounded-full border-2 object-cover ${ringClass}`}
      />
    ) : (
      <span
        title={person.name ?? undefined}
        style={avatarGradientStyle(person.id)}
        className={`flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 text-[11px] font-bold text-white ${ringClass}`}
      >
        {(person.name ?? "?").trim().charAt(0).toUpperCase() || "?"}
      </span>
    );

  return (
    <span className="flex">
      {shown.map((person) =>
        interactive ? (
          <ProfileLink
            key={person.id}
            userId={person.id}
            name={person.name}
            className="-mr-[7px]"
          >
            {face(person)}
          </ProfileLink>
        ) : (
          <span key={person.id} className="-mr-[7px]">
            {face(person)}
          </span>
        ),
      )}
      {overflow > 0 && (
        <span
          className={`bg-bg-tertiary text-fg-tertiary -mr-[7px] flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 text-[10px] font-bold ${ringClass}`}
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
  tab,
  onTabChange,
  onBack,
  onDelete,
}: {
  project: ProjectRow;
  userId: string;
  locale: string;
  now: Date;
  /* Lifted to the workspace, because the tab is part of the URL now. */
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
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
    const future = upcomingEvents(
      (tasksQuery.data ?? []) as UpcomingTask[],
      now,
    );
    return { past, future };
  }, [activityQuery.data, tasksQuery.data, now, someone]);

  const future = events.future.filter((event) =>
    matchesTimelineFilter(event, kind),
  );
  const past = events.past.filter((event) =>
    matchesTimelineFilter(event, kind),
  );
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
          className="text-fg-tertiary hover:text-fg-primary flex items-center gap-2 text-[13px] font-medium transition-colors"
        >
          <ArrowLeft size={15} aria-hidden />
          {t("back")}
        </button>

        <div className="flex items-center gap-2">
          {project.createdById === userId && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={t("delete.title")}
              title={t("delete.title")}
              className="border-border-light/60 text-fg-quaternary hover:border-error/40 hover:text-error flex h-[34px] w-[34px] items-center justify-center rounded-lg border transition-colors duration-300"
            >
              <Trash2 size={16} strokeWidth={1.5} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="dash-rise flex flex-col gap-[18px]" style={rise(0.05)}>
        <div className="flex flex-wrap items-center gap-3.5">
          <h1 className="text-fg-primary m-0 text-[32px] leading-[1.1] font-semibold tracking-[-0.025em]">
            {project.title || t("untitled")}
          </h1>
          <HealthBadge health={project.health} />
          <span className="hidden flex-1 sm:block" />
          <AvatarStack
            people={project.people}
            ringClass="border-bg-primary"
            interactive
          />
        </div>

        <p className="text-fg-tertiary m-0 text-[15px]">
          {project.description || t("noDescription")}
        </p>

        <StatStrip
          items={[
            {
              label: t("stats.progress"),
              value: project.total > 0 ? `${project.percent}%` : "—",
              tone: HEALTH_TEXT[project.health],
            },
            {
              label: t("stats.done"),
              value: String(project.done),
              tone: "text-success",
            },
            {
              label: t("stats.inProgress"),
              value: String(project.inProgress),
              tone: "text-warning",
            },
            { label: t("stats.todo"), value: String(project.todo) },
          ]}
        />
      </div>

      <div
        className="dash-rise border-border-light/60 flex self-start overflow-hidden rounded-lg border"
        style={rise(0.08)}
      >
        {DETAIL_TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            aria-pressed={tab === key}
            className={`h-[34px] px-4 text-[13px] font-medium transition-colors duration-300 ${
              tab === key
                ? "bg-accent-primary/[0.16] text-fg-primary"
                : "text-fg-tertiary hover:text-fg-secondary"
            }`}
          >
            {t(`tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === "tasks" && (
        <ProjectTasksPanel projectId={project.id} userId={userId} />
      )}

      {tab === "team" && (
        <ProjectTeamPanel projectId={project.id} userId={userId} />
      )}

      {tab === "timeline" && (
        <>
          <div
            className="dash-rise flex flex-wrap items-center gap-3"
            style={rise(0.1)}
          >
            <span className="kairos-stamp text-fg-quaternary text-[10px] tracking-[0.14em]">
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
            <span className="text-fg-quaternary font-mono text-[11px]">
              {t("timeline.count", { count: future.length + past.length })}
            </span>
          </div>

          <div className="flex flex-col">
            {loading ? (
              <TimelineSkeleton />
            ) : future.length + past.length === 0 ? (
              <p className="text-fg-tertiary px-1 py-8 text-sm">
                {t("timeline.empty")}
              </p>
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
                    <span className="relative flex min-h-[28px] justify-center self-stretch">
                      <span
                        className="bg-accent-primary/40 absolute -top-3.5 bottom-3.5 w-0.5"
                        aria-hidden
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowEarlier((value) => !value)}
                      className="border-border-light/60 bg-bg-secondary text-fg-secondary hover:border-accent-primary/40 hover:text-fg-primary flex h-[34px] items-center gap-2.5 justify-self-start rounded-lg border px-3.5 text-[13px] font-medium transition-colors duration-300"
                    >
                      {showEarlier
                        ? t("timeline.hideEarlier")
                        : t("timeline.showEarlier")}
                      <span className="text-fg-quaternary font-mono text-[11px]">
                        {earlier}
                      </span>
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
        </>
      )}
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
  if (isSameDay(event.at, new Date(now.getTime() - 86_400_000)))
    return labels.yesterday;
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

  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(event.at);

  return (
    <div
      className={`dash-rise ${event.future ? "opacity-60" : ""}`}
      style={rise(0.1 + index * 0.04)}
    >
      {heading && (
        <div className="kairos-stamp text-fg-quaternary px-1 pt-4 pb-2.5 text-[10px] tracking-[0.16em]">
          {heading}
        </div>
      )}
      <div className="hover:bg-accent-primary/[0.06] grid grid-cols-[52px_26px_minmax(0,1fr)] items-start gap-3.5 px-1 py-3.5 transition-colors duration-[350ms] sm:grid-cols-[62px_26px_minmax(0,1fr)]">
        <span className="text-fg-quaternary pt-[3px] font-mono text-[11px]">
          {time}
        </span>

        <span className="relative flex justify-center self-stretch">
          <span
            aria-hidden
            className={`absolute -top-3.5 -bottom-3.5 w-0.5 ${
              event.future ? "bg-border-light/70" : "bg-accent-primary/40"
            }`}
          />
          <span
            className={`bg-bg-primary relative mt-1 flex h-[15px] w-[15px] items-center justify-center rounded-full border ${
              event.future
                ? "border-border-medium/70"
                : "border-accent-primary/50"
            }`}
          >
            <Icon
              size={8}
              strokeWidth={3}
              className={EVENT_TINT[event.kind]}
              aria-hidden
            />
          </span>
        </span>

        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-fg-secondary text-[15px] leading-[1.4]">
            <span className="text-fg-primary font-semibold">{event.actor}</span>{" "}
            {t(`timeline.verbs.${event.verb}`)}{" "}
            {event.target && (
              <span className="text-fg-primary font-medium">
                {event.target}
              </span>
            )}
          </span>
          {event.detail && (
            <span className="text-fg-quaternary truncate text-[13px]">
              {event.detail}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/** The hinge between what is coming and what has happened. */
function NowMarker({ now, locale }: { now: Date; locale: string }) {
  const t = useTranslations("projects");
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);

  return (
    <div className="grid grid-cols-[52px_26px_minmax(0,1fr)] items-center gap-3.5 px-1 py-2 sm:grid-cols-[62px_26px_minmax(0,1fr)]">
      <span className="text-accent-secondary font-mono text-[11px]">
        {time}
      </span>
      <span className="flex justify-center">
        <span className="bg-accent-primary h-[11px] w-[11px] rounded-full shadow-[0_0_0_4px_rgb(var(--accent-primary)/0.18)]" />
      </span>
      <span className="flex items-center gap-3">
        <span className="kairos-stamp text-accent-secondary text-[10px] tracking-[0.18em]">
          {t("timeline.now")}
        </span>
        <span className="from-accent-primary/50 h-px flex-1 bg-gradient-to-r to-transparent" />
      </span>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="border-border-light/50 border-b px-1 py-4">
          <div className="bg-bg-tertiary h-4 w-2/3 animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- shell */

function LoadingState() {
  return (
    <div className="flex flex-col gap-[26px] px-4 pt-9 pb-14 sm:px-10">
      <div className="bg-bg-tertiary h-9 w-64 animate-pulse rounded" />
      <div className="bg-bg-tertiary h-9 w-full max-w-xl animate-pulse rounded" />
      <div className="border-border-light/60 border-t">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="border-border-light/50 border-b px-1 py-5"
          >
            <div className="bg-bg-tertiary h-4 w-1/3 animate-pulse rounded" />
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
        <div className="kairos-stamp text-accent-secondary text-[11px] tracking-[0.16em]">
          {t("empty.tag")}
        </div>
        <h1 className="text-fg-primary mt-3.5 max-w-[620px] text-[34px] leading-[1.08] font-semibold tracking-[-0.03em]">
          {t("empty.title")}
        </h1>
        <p className="text-fg-tertiary mt-3 max-w-[520px] text-[17px] leading-[1.6]">
          {t("empty.body")}
        </p>
      </div>
      <div className="dash-rise w-fit" style={rise(0.15)}>
        <NewProjectDrawer />
      </div>
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
        <button
          type="button"
          aria-label={t("delete.cancel")}
          onClick={onCancel}
          className="absolute inset-0"
        />
        <div
          role="dialog"
          aria-modal="true"
          className="border-border-light/60 bg-bg-secondary relative w-full max-w-sm rounded-2xl border p-6 shadow-2xl"
        >
          <h2 className="text-fg-primary m-0 text-lg font-semibold">
            {t("delete.title")}
          </h2>
          <p className="text-fg-tertiary mt-2 text-sm">{t("delete.body")}</p>
          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              {t("delete.cancel")}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="bg-error rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("delete.confirm")}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
