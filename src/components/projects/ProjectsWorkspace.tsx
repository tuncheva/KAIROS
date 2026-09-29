"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "~/components/ui/icons";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { NewProjectDrawer } from "./NewProjectDrawer";
import { ProjectTasksPanel, ProjectTeamPanel } from "./ProjectTasksPanel";
import {
  DETAIL_TABS,
  isDetailTab,
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
  type DetailTab,
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

/** The card shell shared by every panel on the page. */
const CARD =
  "overflow-hidden rounded-lg border border-tui-ink/12 bg-tui-pane shadow-[var(--tui-pane-shadow)]";

const FILTERS: FilterKey[] = ["all", "track", "risk", "done"];
const SORTS: SortKey[] = ["updated", "progress", "name"];
const TIMELINE_FILTERS: TimelineFilter[] = [
  "all",
  "task",
  "status",
  "note",
  "due",
];

/** Health only ever paints text and a dot, never a fill. */
const HEALTH_TONE: Record<Health, string> = {
  empty: "text-tui-ink3",
  complete: "text-tui-ok",
  onTrack: "text-tui-ok",
  inProgress: "text-tui-warn",
  atRisk: "text-tui-danger",
};

const HEALTH_DOT: Record<Health, string> = {
  empty: "bg-tui-ink/30",
  complete: "bg-tui-ok",
  onTrack: "bg-tui-ok",
  inProgress: "bg-tui-warn",
  atRisk: "bg-tui-danger",
};

/** Timeline nodes are a bordered dot, tinted by the kind of event. */
const EVENT_TINT: Record<EventKind, string> = {
  task: "border-tui-ok",
  status: "border-tui-warn",
  note: "border-tui-accent",
  due: "border-tui-ink3",
};

export function ProjectsWorkspace({
  userId,
  initialProjectId = null,
  initialTab = "tasks",
}: {
  userId: string;
  initialProjectId?: number | null;
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
  const [confirmArchiveId, setConfirmArchiveId] = useState<number | null>(null);
  const [showArchive, setShowArchive] = useState(false);

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
      if (openId !== null)
        window.history.replaceState(null, "", projectUrl(openId, next));
    },
    [openId, projectUrl],
  );

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

  const archivedQuery = api.project.getArchivedProjects.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
  });

  const refreshLists = async () => {
    await Promise.all([
      utils.project.getMyProjects.invalidate(),
      utils.project.getArchivedProjects.invalidate(),
    ]);
  };

  const archiveProject = api.project.archiveProject.useMutation({
    onSuccess: async () => {
      setConfirmArchiveId(null);
      setOpenId(null);
      toast.success(t("archive.archived"));
      await refreshLists();
    },
    onError: (error) => toast.error(error.message),
  });

  const reopenProject = api.project.reopenProject.useMutation({
    onSuccess: async () => {
      toast.success(t("archive.reopened"));
      await refreshLists();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteProject = api.project.delete.useMutation({
    onSuccess: async () => {
      setConfirmDeleteId(null);
      setOpenId(null);
      toast.success(t("deleted"));
      await refreshLists();
    },
    onError: (error) => toast.error(error.message),
  });

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

  const archivedRows = (archivedQuery.data ?? []) as RawProject[];

  if (rows.length === 0 && archivedRows.length === 0) {
    return <FirstRun />;
  }

  return (
    <div className="tui-screen text-tui-ink min-h-full">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 pt-10 pb-12 sm:px-8">
        {confirmDeleteId !== null && (
          <DeleteDialog
            pending={deleteProject.isPending}
            onCancel={() => setConfirmDeleteId(null)}
            onConfirm={() => deleteProject.mutate({ id: confirmDeleteId })}
          />
        )}

        {confirmArchiveId !== null && (
          <ArchiveDialog
            pending={archiveProject.isPending}
            onCancel={() => setConfirmArchiveId(null)}
            onConfirm={() =>
              archiveProject.mutate({ projectId: confirmArchiveId })
            }
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
            onArchive={() => setConfirmArchiveId(opened.id)}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className={`dash-rise ${CARD}`} style={rise(0.05)}>
                <div className="flex flex-col gap-3.5 px-8 py-9 sm:px-10">
                  <span className="text-tui-ink3 text-[11px] font-medium tracking-[0.18em] uppercase">
                    {t("summary", {
                      shown: shown.length,
                      projects: rows.length,
                      done: totals.completed,
                      tasks: totals.tasks,
                    })}
                  </span>
                  <h1 className="font-display m-0 text-[52px] leading-none font-light tracking-[-0.02em] sm:text-[64px]">
                    {t("title")}
                  </h1>
                </div>
              </div>

              <div className={`dash-rise ${CARD}`} style={rise(0.1)}>
                <div className="flex flex-col gap-3.5 px-7 py-6">
                  <span className="font-display text-[21px]">
                    {t("tui.workspace")}
                  </span>
                  <StatLeader
                    label={t("stats.active")}
                    value={String(totals.active)}
                  />
                  <StatLeader
                    label={t("stats.tasks")}
                    value={String(totals.tasks)}
                  />
                  <StatLeader
                    label={t("stats.completed")}
                    value={String(totals.completed)}
                    tone="ok"
                  />
                  <StatLeader
                    label={t("stats.overall")}
                    value={`${totals.percent}%`}
                    tone="accent"
                  />
                </div>
              </div>
            </div>

            {/* Controls */}
            <div
              className="dash-rise flex flex-wrap items-center gap-3"
              style={rise(0.14)}
            >
              <label
                className={`border-tui-ink/12 bg-tui-pane flex h-10 w-full items-center gap-2.5 rounded-full border px-4 shadow-[var(--tui-pane-shadow)] sm:w-[300px]`}
              >
                <Search
                  size={15}
                  className="text-tui-ink3 flex-none"
                  aria-hidden
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("searchPlaceholder")}
                  aria-label={t("searchPlaceholder")}
                  className="text-tui-ink placeholder:text-tui-ink3 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
                />
              </label>

              <PillGroup>
                {FILTERS.map((key) => (
                  <Pill
                    key={key}
                    active={filter === key}
                    onClick={() => setFilter(key)}
                  >
                    {t(`filters.${key}`)}
                    <span className="text-tui-ink3 text-[11.5px] tabular-nums">
                      {rows.filter((row) => matchesFilter(row, key)).length}
                    </span>
                  </Pill>
                ))}
              </PillGroup>

              <span className="hidden flex-1 lg:block" />

              <span className="text-tui-ink3 text-[12.5px]">
                {t("sortLabel")}
              </span>
              <PillGroup>
                {SORTS.map((key) => (
                  <Pill
                    key={key}
                    active={sort === key}
                    onClick={() => setSort(key)}
                  >
                    {t(`sorts.${key}`)}
                  </Pill>
                ))}
              </PillGroup>
              <PillGroup>
                {(["list", "grid"] as ViewMode[]).map((key) => (
                  <Pill
                    key={key}
                    active={view === key}
                    onClick={() => setView(key)}
                  >
                    {t(`views.${key}`)}
                  </Pill>
                ))}
              </PillGroup>
            </div>

            {view === "list" ? (
              <ProjectTable
                rows={shown}
                locale={locale}
                onOpen={openProject}
                caption={t("listCaption", {
                  count: shown.length,
                  sort: t(`sorts.${sort}`),
                })}
                query={query}
                onClearSearch={() => setQuery("")}
                onShowAll={() => {
                  setQuery("");
                  setFilter("all");
                }}
              />
            ) : shown.length === 0 ? (
              <p className="text-tui-ink2 px-1 py-9 text-[13px]">
                {query.trim()
                  ? t("noMatch", { query: query.trim() })
                  : t("noneInFilter")}
              </p>
            ) : (
              <ProjectGrid rows={shown} locale={locale} onOpen={openProject} />
            )}

            {archivedRows.length > 0 && (
              <ArchivePanel
                rows={archivedRows}
                open={showArchive}
                onToggle={() => setShowArchive((was) => !was)}
                onReopen={(projectId) => reopenProject.mutate({ projectId })}
                pending={reopenProject.isPending}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- shared pieces */

function StatLeader({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "accent";
}) {
  const toneClass =
    tone === "ok"
      ? "text-tui-ok"
      : tone === "accent"
        ? "text-tui-accent"
        : "text-tui-ink";
  return (
    <div className="flex items-baseline gap-2.5 text-[14px]">
      <span className="text-tui-ink2">{label}</span>
      <span className="border-tui-ink/16 flex-1 -translate-y-1 border-b border-dotted" />
      <span
        className={`font-display text-[26px] leading-none tabular-nums ${toneClass}`}
      >
        {value}
      </span>
    </div>
  );
}

function PillGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-tui-ink/12 bg-tui-pane flex gap-1 rounded-full border p-1 shadow-[var(--tui-pane-shadow)]">
      {children}
    </div>
  );
}

function Pill({
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
      className={`flex h-8 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium transition-colors ${
        active
          ? "bg-tui-accent/[0.14] text-tui-ink"
          : "text-tui-ink3 hover:text-tui-ink2"
      }`}
    >
      {children}
    </button>
  );
}

/** A serif monogram in a bordered circle. */
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

function AvatarStack({ people }: { people: Person[] }) {
  const shown = people.slice(0, 4);
  const overflow = people.length - shown.length;
  if (people.length === 0) return <Initial label="—" />;
  return (
    <span className="flex">
      {shown.map((person) => (
        <span key={person.id} className="-mr-1.5">
          <Initial label={person.name ?? "?"} />
        </span>
      ))}
      {overflow > 0 && (
        <span className="-mr-1.5">
          <span
            className="border-tui-ink/16 bg-tui-pane text-tui-ink3 flex items-center justify-center rounded-full border text-[10px]"
            style={{ width: 26, height: 26 }}
          >
            +{overflow}
          </span>
        </span>
      )}
    </span>
  );
}

function CompletionBar({ percent }: { percent: number }) {
  return (
    <span className="bg-tui-ink/12 relative block h-[3px] overflow-hidden rounded-sm">
      <span
        className="dash-grow bg-tui-accent absolute inset-y-0 left-0 rounded-sm"
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

function HealthDot({ health }: { health: Health }) {
  const t = useTranslations("projects");
  return (
    <span className="text-tui-ink2 flex items-center gap-2 text-[13px]">
      <span
        className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT[health]}`}
        aria-hidden
      />
      {t(`health.${health}`)}
    </span>
  );
}

/**
 * Compact age stamp. `formatDistanceToNow` returned "about 1 month" here, which
 * reads as prose rather than a stamp.
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
      {new Intl.DateTimeFormat(locale, {
        month: "short",
        year: "numeric",
      }).format(row.updatedAt)}
    </>
  );
}

/* -------------------------------------------------------------------- browse */

const LIST_GRID =
  "grid grid-cols-[minmax(0,1fr)_220px_52px_110px_96px_110px_12px] items-center gap-5";

function ProjectTable({
  rows,
  locale,
  onOpen,
  caption,
  query,
  onClearSearch,
  onShowAll,
}: {
  rows: ProjectRow[];
  locale: string;
  onOpen: (id: number) => void;
  caption: string;
  query: string;
  onClearSearch: () => void;
  onShowAll: () => void;
}) {
  const t = useTranslations("projects");

  return (
    <section className={`dash-fade ${CARD}`} style={rise(0.18)}>
      <div className="border-tui-ink/8 flex items-baseline gap-3 border-b px-7 pt-5 pb-4">
        <h2 className="font-display m-0 text-[22px] leading-none">
          {t("title")}
        </h2>
        <span className="text-tui-ink3 text-[12.5px]">{caption}</span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[840px]">
          <div
            className={`${LIST_GRID} border-tui-ink/8 text-tui-ink3 border-b px-7 py-3 text-[11px] font-medium tracking-[0.14em] uppercase`}
          >
            <span>{t("colProject")}</span>
            <span>{t("colProgress")}</span>
            <span className="text-right">%</span>
            <span>{t("colTeam")}</span>
            <span>{t("colUpdated")}</span>
            <span className="text-right">{t("colHealth")}</span>
            <span />
          </div>

          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3.5 px-7 pt-16 pb-20 text-center">
              <span className="font-display text-tui-ink/25 text-[44px] leading-none italic">
                —
              </span>
              <span className="font-display max-w-[520px] text-[26px] leading-[1.2]">
                {query.trim()
                  ? t("noMatch", { query: query.trim() })
                  : t("noneInFilter")}
              </span>
              {query.trim() && (
                <div className="mt-2 flex gap-2.5">
                  <button
                    type="button"
                    onClick={onClearSearch}
                    className="border-tui-ink/16 text-tui-ink hover:bg-tui-ink/[0.04] h-9 rounded-full border px-4 text-[13.5px] font-medium transition-colors"
                  >
                    {t("clearSearch")}
                  </button>
                  <button
                    type="button"
                    onClick={onShowAll}
                    className="bg-tui-accent/[0.16] text-tui-ink hover:bg-tui-accent/[0.22] h-9 rounded-full px-4 text-[13.5px] font-medium transition-colors"
                  >
                    {t("showAll")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className={`group relative ${LIST_GRID} border-tui-ink/8 hover:bg-tui-accent/[0.05] border-b px-7 py-[18px] text-[14px] transition-colors last:border-b-0`}
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => onOpen(row.id)}
                    aria-label={row.title || t("untitled")}
                    className="font-display focus-visible:ring-tui-accent truncate text-left text-[20px] outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-inset"
                  >
                    {row.title || t("untitled")}
                  </button>
                  <span className="text-tui-ink3 truncate text-[13px]">
                    {row.description || t("noDescription")}
                  </span>
                </span>
                <CompletionBar percent={row.percent} />
                <span
                  className={`text-right font-semibold tabular-nums ${HEALTH_TONE[row.health]}`}
                >
                  {row.total > 0 ? `${row.percent}%` : "—"}
                </span>
                <span className="relative z-10">
                  <AvatarStack people={row.people} />
                </span>
                <span className="text-tui-ink3 text-[13px]">
                  <UpdatedStamp row={row} locale={locale} />
                </span>
                <span className="justify-self-end">
                  <HealthDot health={row.health} />
                </span>
                <span className="text-tui-ink3">›</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

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
    <div className="dash-fade grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <div
          key={row.id}
          className={`group relative flex flex-col gap-[18px] ${CARD} hover:border-tui-accent/40 p-6 transition-colors`}
        >
          <div className="text-tui-ink2 flex items-center gap-2 text-[12.5px]">
            <HealthDot health={row.health} />
            <span className="flex-1" />
            <span className="text-tui-ink3">
              <UpdatedStamp row={row} locale={locale} />
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => onOpen(row.id)}
              aria-label={row.title || t("untitled")}
              className="font-display focus-visible:ring-tui-accent truncate text-left text-[25px] outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:ring-2 focus-visible:ring-inset"
            >
              {row.title || t("untitled")}
            </button>
            <span className="text-tui-ink3 min-h-[40px] text-[13px] leading-[1.55]">
              {row.description || t("noDescription")}
            </span>
          </div>
          <span
            className={`font-display text-[56px] leading-none font-light tracking-[-0.02em] tabular-nums ${
              row.total > 0 ? HEALTH_TONE[row.health] : "text-tui-ink3"
            }`}
          >
            {row.total > 0 ? `${row.percent}%` : "—"}
          </span>
          <CompletionBar percent={row.percent} />
          <div className="border-tui-ink/8 relative z-10 flex items-center border-t pt-3.5">
            <AvatarStack people={row.people} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- detail */

function StatStrip({
  items,
}: {
  items: { label: string; value: string; tone?: string }[];
}) {
  return (
    <div className="border-tui-ink/12 bg-tui-ink/12 grid grid-cols-2 gap-px overflow-hidden rounded-lg border sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="bg-tui-pane px-5 py-4">
          <div className="text-tui-ink3 text-[11px] font-medium tracking-[0.14em] uppercase">
            {item.label}
          </div>
          <div
            className={`font-display mt-1.5 text-[26px] leading-none tabular-nums ${item.tone ?? "text-tui-ink"}`}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectDetail({
  project,
  userId,
  locale,
  now,
  tab,
  onTabChange,
  onBack,
  onDelete,
  onArchive,
}: {
  project: ProjectRow;
  userId: string;
  locale: string;
  now: Date;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onBack: () => void;
  onDelete: () => void;
  onArchive: () => void;
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
    <div className="dash-fade flex flex-col gap-6">
      <div className="flex items-center gap-3 text-[13.5px]">
        <button
          type="button"
          onClick={onBack}
          className="text-tui-ink2 hover:text-tui-ink transition-colors"
        >
          ← {t("back")}
        </button>
        <span className="flex-1" />
        {project.createdById === userId && (
          <button
            type="button"
            onClick={onArchive}
            className="border-tui-ink/16 bg-tui-pane text-tui-ink hover:bg-tui-ink/[0.04] h-9 rounded-full border px-4 text-[13px] font-medium transition-colors"
          >
            {t("archive.title")}
          </button>
        )}
        {project.createdById === userId && (
          <button
            type="button"
            onClick={onDelete}
            className="border-tui-danger/40 bg-tui-pane text-tui-danger hover:bg-tui-danger/[0.08] h-9 rounded-full border px-4 text-[13px] font-medium transition-colors"
          >
            {t("delete.title")}
          </button>
        )}
      </div>

      <div className={`dash-rise ${CARD}`} style={rise(0.05)}>
        <div className="flex flex-col gap-4 px-8 py-9 sm:px-10">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="font-display m-0 text-[40px] leading-none font-light tracking-[-0.02em] sm:text-[52px]">
              {project.title || t("untitled")}
            </h1>
            <span
              className={`flex h-7 items-center gap-2 rounded-full border px-3 text-[12.5px] font-medium ${HEALTH_TONE[project.health]}`}
              style={{ borderColor: "rgb(var(--tui-ink) / 0.16)" }}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT[project.health]}`}
                aria-hidden
              />
              {t(`health.${project.health}`)}
            </span>
            <span className="hidden flex-1 sm:block" />
            <span className="relative z-10">
              <AvatarStack people={project.people} />
            </span>
          </div>
          <p className="text-tui-ink2 m-0 max-w-[680px] text-[16px] leading-[1.6]">
            {project.description || t("noDescription")}
          </p>
          <StatStrip
            items={[
              {
                label: t("stats.progress"),
                value: project.total > 0 ? `${project.percent}%` : "—",
                tone: HEALTH_TONE[project.health],
              },
              {
                label: t("stats.done"),
                value: String(project.done),
                tone: "text-tui-ok",
              },
              {
                label: t("stats.inProgress"),
                value: String(project.inProgress),
                tone: "text-tui-warn",
              },
              { label: t("stats.todo"), value: String(project.todo) },
            ]}
          />
        </div>
      </div>

      <div className="dash-rise self-start" style={rise(0.08)}>
        <PillGroup>
          {DETAIL_TABS.map((key) => (
            <Pill
              key={key}
              active={tab === key}
              onClick={() => onTabChange(key)}
            >
              {t(`tabs.${key}`)}
            </Pill>
          ))}
        </PillGroup>
      </div>

      {tab === "tasks" && (
        <ProjectTasksPanel projectId={project.id} userId={userId} />
      )}

      {tab === "team" && (
        <ProjectTeamPanel projectId={project.id} userId={userId} />
      )}

      {tab === "timeline" && (
        <section className={`${CARD}`}>
          <div className="border-tui-ink/8 flex flex-wrap items-center gap-3 border-b px-7 pt-5 pb-4">
            <h2 className="font-display m-0 text-[22px] leading-none">
              {t("timeline.label")}
            </h2>
            <span className="text-tui-ink3 text-[12.5px]">
              {t("timeline.count", { count: future.length + past.length })}
            </span>
            <span className="hidden flex-1 sm:block" />
            {TIMELINE_FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setKind(key)}
                aria-pressed={kind === key}
                className={`h-[30px] rounded-full border px-3 text-[12.5px] font-medium transition-colors ${
                  kind === key
                    ? "border-tui-accent/55 bg-tui-accent/[0.14] text-tui-ink"
                    : "border-tui-ink/16 text-tui-ink3 hover:text-tui-ink2"
                }`}
              >
                {t(`timeline.kinds.${key}`)}
              </button>
            ))}
          </div>

          <div className="px-7 py-4">
            {loading ? (
              <TimelineSkeleton />
            ) : future.length + past.length === 0 ? (
              <p className="text-tui-ink2 py-6 text-[14px]">
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
                  />
                ))}

                {earlier > 0 && (
                  <div className="pt-3 pl-[68px]">
                    <button
                      type="button"
                      onClick={() => setShowEarlier((value) => !value)}
                      className="border-tui-ink/16 text-tui-ink2 hover:border-tui-accent/40 hover:text-tui-ink h-[34px] rounded-full border px-4 text-[13px] font-medium transition-colors"
                    >
                      {showEarlier
                        ? t("timeline.hideEarlier")
                        : t("timeline.showEarlier")}
                      <span className="text-tui-ink3 ml-2 text-[11.5px]">
                        {earlier}
                      </span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
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
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
  }).format(event.at);
}

function TimelineRow({
  event,
  locale,
  now,
  previous,
}: {
  event: TimelineEvent;
  locale: string;
  now: Date;
  previous: TimelineEvent | undefined;
}) {
  const t = useTranslations("projects");

  const heading = dayHeading(event, previous, now, locale, {
    today: t("timeline.today"),
    yesterday: t("timeline.yesterday"),
  });

  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(event.at);

  return (
    <div className={event.future ? "opacity-60" : ""}>
      {heading && (
        <div className="text-tui-ink3 pt-4 pb-1.5 pl-[68px] text-[11px] font-medium tracking-[0.16em] uppercase">
          {heading}
        </div>
      )}
      <div className="grid grid-cols-[56px_28px_minmax(0,1fr)] items-start gap-3 py-3">
        <span className="text-tui-ink3 pt-0.5 text-[12.5px] tabular-nums">
          {time}
        </span>
        <span className="relative flex justify-center self-stretch">
          <span
            aria-hidden
            className={`absolute -top-3 -bottom-3 w-px ${
              event.future ? "bg-tui-ink/16" : "bg-tui-accent/40"
            }`}
          />
          <span
            className={`bg-tui-pane relative mt-[5px] h-[9px] w-[9px] rounded-full border-[1.5px] ${EVENT_TINT[event.kind]}`}
          />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-tui-ink2 text-[14.5px] leading-[1.4]">
            <span className="text-tui-ink font-semibold">{event.actor}</span>{" "}
            {t(`timeline.verbs.${event.verb}`)}{" "}
            {event.target && (
              <span className="font-display text-tui-ink text-[17px]">
                {event.target}
              </span>
            )}
          </span>
          {event.detail && (
            <span className="text-tui-ink3 truncate text-[13px]">
              {event.detail}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function NowMarker({ now, locale }: { now: Date; locale: string }) {
  const t = useTranslations("projects");
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);

  return (
    <div className="grid grid-cols-[56px_28px_minmax(0,1fr)] items-center gap-3 py-3">
      <span className="text-tui-accent text-[12.5px] font-semibold">
        {time}
      </span>
      <span className="flex justify-center">
        <span className="bg-tui-accent h-[11px] w-[11px] rounded-full shadow-[0_0_0_4px_rgb(var(--tui-accent)/0.18)]" />
      </span>
      <span className="flex items-center gap-3">
        <span className="text-tui-accent text-[11px] font-semibold tracking-[0.18em] uppercase">
          {t("timeline.now")}
        </span>
        <span className="bg-tui-accent/40 h-px flex-1" />
      </span>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="border-tui-ink/8 border-b py-4 last:border-b-0"
        >
          <div className="bg-tui-ink/8 h-4 w-2/3 animate-pulse rounded-sm" />
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- shell */

function LoadingState() {
  return (
    <div className="tui-screen min-h-full">
      <div className="mx-auto max-w-[1440px] px-4 pt-10 pb-12 sm:px-8">
        <div className={CARD}>
          <div className="flex flex-col gap-3 px-8 py-9">
            {[64, 44, 72, 52, 60].map((w, i) => (
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

/**
 * No projects at all. The welcome — how to start, and what a project will hold.
 */
function FirstRun() {
  const t = useTranslations("projects");
  const holds = [
    {
      n: "i",
      title: t("empty.holds.tasksTitle"),
      body: t("empty.holds.tasksBody"),
    },
    {
      n: "ii",
      title: t("empty.holds.teamTitle"),
      body: t("empty.holds.teamBody"),
    },
    {
      n: "iii",
      title: t("empty.holds.timelineTitle"),
      body: t("empty.holds.timelineBody"),
    },
  ];

  return (
    <div className="tui-screen text-tui-ink min-h-full">
      <div className="mx-auto flex max-w-[1000px] flex-col gap-6 px-4 pt-12 pb-14 sm:px-8">
        <div className={`dash-rise ${CARD}`} style={rise(0.05)}>
          <div className="flex flex-col gap-5 px-8 py-10 sm:px-12">
            <span className="text-tui-ink3 text-[11px] font-medium tracking-[0.18em] uppercase">
              {t("empty.newWorkspace")}
            </span>
            <h1 className="font-display m-0 max-w-[620px] text-[44px] leading-[1.05] font-light tracking-[-0.02em] text-pretty sm:text-[54px]">
              {t("empty.title")}
            </h1>
            <p className="text-tui-ink2 m-0 max-w-[560px] text-[16px] leading-[1.65] text-pretty">
              {t("empty.body")}
            </p>
            <div className="w-fit">
              <NewProjectDrawer />
            </div>
          </div>
        </div>

        <div
          className={`dash-rise ${CARD} grid grid-cols-1 sm:grid-cols-3`}
          style={rise(0.12)}
        >
          {holds.map((hold, index) => (
            <div
              key={hold.n}
              className={`flex flex-col gap-2.5 px-7 py-7 ${
                index > 0
                  ? "border-tui-ink/8 border-t sm:border-t-0 sm:border-l"
                  : ""
              }`}
            >
              <span className="font-display text-tui-accent text-[24px] leading-none italic">
                {hold.n}
              </span>
              <span className="font-display text-[21px]">{hold.title}</span>
              <span className="text-tui-ink2 text-[14px] leading-[1.6]">
                {hold.body}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Archiving is reversible, so this is not a destructive dialog — but it is still
 * a confirmation, because the project leaves everyone else's list too.
 */
function ArchivePanel({
  rows,
  open,
  onToggle,
  onReopen,
  pending,
}: {
  rows: RawProject[];
  open: boolean;
  onToggle: () => void;
  onReopen: (projectId: number) => void;
  pending: boolean;
}) {
  const t = useTranslations("projects");

  return (
    <section className={CARD}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="hover:bg-tui-accent/[0.04] flex w-full items-baseline gap-3 px-7 py-4 text-left transition-colors"
      >
        <span className="font-display text-[19px]">
          {t("archive.sectionTitle")}
        </span>
        <span className="text-tui-ink3 text-[12.5px]">{rows.length}</span>
        <span className="flex-1" />
        <span className="text-tui-ink2 text-[13px]">
          {t("archive.subtitle")}
        </span>
      </button>

      {open && (
        <ul className="border-tui-ink/8 m-0 list-none border-t p-0">
          {rows.map((row) => (
            <li
              key={row.id}
              className="border-tui-ink/8 flex items-center gap-4 border-b px-7 py-3.5 last:border-b-0"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-display text-tui-ink2 truncate text-[17px]">
                  {row.title || t("untitled")}
                </span>
                {row.description && (
                  <span className="text-tui-ink3 truncate text-[12.5px]">
                    {row.description}
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => onReopen(row.id)}
                className="border-tui-ink/16 text-tui-ink hover:border-tui-accent/40 h-8 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors disabled:opacity-50"
              >
                {t("archive.reopen")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ArchiveDialog({
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
    <ConfirmDialog
      title={t("archive.title")}
      message={t("archive.body")}
      confirmLabel={t("archive.confirm")}
      cancelLabel={t("archive.cancel")}
      isPending={pending}
      onCancel={onCancel}
      onConfirm={() => onConfirm()}
    />
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
    <ConfirmDialog
      destructive
      title={t("delete.title")}
      message={t("delete.body")}
      confirmLabel={t("delete.confirm")}
      cancelLabel={t("delete.cancel")}
      isPending={pending}
      onCancel={onCancel}
      onConfirm={() => onConfirm()}
    />
  );
}
