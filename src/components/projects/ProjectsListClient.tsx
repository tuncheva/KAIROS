"use client";

import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
import { Folder, AlertCircle, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Doughnut } from "react-chartjs-2";
import { ensureChartJsRegistered } from "~/components/charts/chartjs";
import { useResolvedThemeColors } from "~/components/charts/themeColors";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { bg, enUS } from "date-fns/locale";

interface Collaborator {
 id: string;
 name: string | null;
 image: string | null;
}

interface ProjectWithStats {
 id: number;
 title: string;
 description: string | null;
 createdById: string;
 totalTasks: number;
 completedTasks: number;
 inProgressTasks: number;
 pendingTasks: number;
 completionPercentage: number;
 collaborators: Collaborator[];
 updatedAt: string | Date | null;
}

function toFiniteNumberArray(value: unknown): number[] {
 if (!Array.isArray(value)) return [];
 const out: number[] = [];
 for (const item of value as unknown[]) {
  if (typeof item === "number" && Number.isFinite(item)) out.push(item);
 }
 return out;
}

function hasTasks(value: unknown): value is { tasks: Array<{ status: string }> } {
 if (value == null || typeof value !== "object") return false;
 const v = value as Record<string, unknown>;
 const tasks = v.tasks;
 if (!Array.isArray(tasks)) return false;
 return tasks.every((item) => {
  if (item == null || typeof item !== "object") return false;
  const it = item as Record<string, unknown>;
  return typeof it.status === "string";
 });
}

function hasCollaborators(value: unknown): value is { collaborators: Array<{ id: string; name: string | null; image: string | null }> } {
 if (value == null || typeof value !== "object") return false;
 const v = value as Record<string, unknown>;
 return Array.isArray(v.collaborators);
}

function getUpdatedAt(value: unknown): string | Date | null {
 if (value == null || typeof value !== "object") return null;
 const v = value as Record<string, unknown>;
 if (v.updatedAt instanceof Date || typeof v.updatedAt === "string") return v.updatedAt;
 return null;
}

export function ProjectsListWorkspace({ userId }: { userId: string }) {
 const [mounted, setMounted] = useState(false);
 const [animateCharts, setAnimateCharts] = useState(false);
 const [deleteArmedId, setDeleteArmedId] = useState<number | null>(null);
 const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
 const router = useRouter();
 const locale = useLocale();
 
 ensureChartJsRegistered();
 const colors = useResolvedThemeColors();
 const t = useTranslations("create");
 const dateFnsLocale = locale.startsWith("bg") ? bg : enUS;

 useEffect(() => {
 setMounted(true);
 const timer = setTimeout(() => setAnimateCharts(true), 100);
 return () => clearTimeout(timer);
 }, []);

 const { data: projects, isLoading } = api.project.getMyProjects.useQuery(undefined, {
 staleTime: 1000 * 60 * 5,
 });

 const utils = api.useUtils();

 const deleteProject = api.project.delete.useMutation({
 onSuccess: () => {
   setDeleteArmedId(null);
   void utils.project.getMyProjects.invalidate();
 },
 });

 // Auto-disarm delete after 4 seconds
 useEffect(() => {
 if (!deleteArmedId) return;
 const tId = setTimeout(() => setDeleteArmedId(null), 4000);
 return () => clearTimeout(tId);
 }, [deleteArmedId]);

 const handleDeleteProject = (e: React.MouseEvent, projectId: number) => {
 e.stopPropagation();
 setConfirmDeleteId(projectId);
 };

 const confirmDelete = () => {
 if (confirmDeleteId === null) return;
 deleteProject.mutate({ id: confirmDeleteId });
 setConfirmDeleteId(null);
 };

 if (!mounted) {
 return (
 <div className="w-full max-w-6xl mx-auto px-4 sm:px-6">
 <div className="mb-8 sm:mb-12">
 <div className="animate-pulse">
 <div className="h-8 bg-bg-tertiary rounded-[12px] mb-4"></div>
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
 <div className="h-32 bg-bg-tertiary rounded-[12px]"></div>
 <div className="h-32 bg-bg-tertiary rounded-[12px]"></div>
 <div className="h-32 bg-bg-tertiary rounded-[12px]"></div>
 <div className="h-32 bg-bg-tertiary rounded-[12px]"></div>
 </div>
 </div>
 </div>
 </div>
 );
 }

 if (isLoading) {
 return null;
 }

 if (!projects || projects.length === 0) {
 return (
 <div className="w-full max-w-6xl mx-auto px-4 sm:px-6">
 <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
 <div className="w-20 h-20 rounded-2xl bg-accent-primary/10 flex items-center justify-center mb-6">
 <Folder size={36} className="text-accent-primary" />
 </div>
  <h2 className="text-2xl font-bold text-fg-primary mb-2">{t("projectsList.emptyTitle")}</h2>
  <p className="text-fg-secondary mb-6">{t("projectsList.emptyDesc")}</p>
 <a
 href="/create?action=new_project"
 className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition-colors shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)]"
 >
 <Plus size={18} />
  {t("projectsList.newProject")}
 </a>
 </div>
 </div>
 );
 }

 const projectsWithStats: ProjectWithStats[] = projects.map((project) => {
 const projectTasks = hasTasks(project) ? project.tasks : [];
 
 const totalTasks = projectTasks.length;
 const completedTasks = projectTasks.filter((t) => t.status ==="completed").length;
 const inProgressTasks = projectTasks.filter((t) => t.status ==="in_progress").length;
 const pendingTasks = projectTasks.filter((t) => t.status ==="pending").length;
 const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

 return {
 id: project.id,
 title: project.title,
 description: project.description ?? null,
 createdById: (project as unknown as { createdById: string }).createdById,
 totalTasks,
 completedTasks,
 inProgressTasks,
 pendingTasks,
 completionPercentage,
 collaborators: hasCollaborators(project) ? (project.collaborators as Collaborator[]) : [],
 updatedAt: getUpdatedAt(project),
 };
 });

 const totalProjects = projectsWithStats.length;
 const totalAllTasks = projectsWithStats.reduce((sum, p) => sum + p.totalTasks, 0);
 const totalCompletedTasks = projectsWithStats.reduce((sum, p) => sum + p.completedTasks, 0);
 const totalInProgressTasks = projectsWithStats.reduce((sum, p) => sum + p.inProgressTasks, 0);
 const totalPendingTasks = projectsWithStats.reduce((sum, p) => sum + p.pendingTasks, 0);
 const overallCompletion = totalAllTasks > 0 ? Math.round((totalCompletedTasks / totalAllTasks) * 100) : 0;

 const getProgressColor = (percentage: number): string => {
 if (percentage === 0) return "text-fg-tertiary";
 if (percentage < 30) return "text-error";
 if (percentage < 60) return "text-warning";
 if (percentage < 100) return "text-accent-primary";
 return "text-success";
 };

 const getProgressGlow = (percentage: number): string => {
 if (percentage === 0) return "shadow-transparent";
 if (percentage < 30) return "shadow-error/20";
 if (percentage < 60) return "shadow-warning/20";
 if (percentage < 100) return "shadow-accent-primary/20";
 return "shadow-success/30";
 };

 const buildRingData = (completed: number, inProgress: number, pending: number) => {
 const done = animateCharts ? completed : 0;
 const active = animateCharts ? inProgress : 0;
 const waiting = Math.max(0, pending);
 return {
 labels: [t("stats.completed"), t("projectsList.active"), t("projectsList.pending")],
 datasets: [
 {
 data: [done, active, waiting],
 backgroundColor: [colors.success, colors.warning, colors.remaining],
 borderColor: colors.border,
 borderWidth: 1,
 },
 ],
 };
 };

 const ringOptions = {
 cutout: "72%",
 plugins: {
 legend: { display: false },
 tooltip: {
 enabled: true,
 backgroundColor: colors.bgOverlay,
 titleColor: colors.fgPrimary,
 bodyColor: colors.fgPrimary,
 callbacks: {
 label: (ctx: { label?: string; parsed?: number; dataset?: { data?: unknown } }) => {
 const label = ctx.label ??"";
 const value = typeof ctx.parsed ==="number" ? ctx.parsed : 0;
 const data = toFiniteNumberArray(ctx.dataset?.data);
 const total = data.reduce((s, v) => s + v, 0);
 const pct = total > 0 ? Math.round((value / total) * 100) : 0;
 return `${label}: ${value} (${pct}%)`;
 },
 },
 },
 },
 };

 // Status badge based on completion percentage
 const getStatusBadge = (percentage: number) => {
  if (percentage === 100) return { label: t("projectsList.statusComplete"), bg: "bg-emerald-500/10", text: "text-emerald-500", border: "border-emerald-500/20" };
  if (percentage >= 60) return { label: t("projectsList.statusOnTrack"), bg: "bg-emerald-500/10", text: "text-emerald-500", border: "border-emerald-500/20" };
  if (percentage >= 30) return { label: t("projectsList.statusInProgress"), bg: "bg-amber-500/10", text: "text-amber-500", border: "border-amber-500/20" };
  return { label: t("projectsList.statusAtRisk"), bg: "bg-rose-500/10", text: "text-rose-500", border: "border-rose-500/20" };
 };

 const getGradientFrom = (percentage: number) => {
  if (percentage >= 60) return "from-emerald-500";
  if (percentage >= 30) return "from-amber-500";
  return "from-rose-500";
 };

 const getBarColor = (percentage: number) => {
  if (percentage >= 60) return "bg-emerald-500";
  if (percentage >= 30) return "bg-amber-500";
  return "bg-rose-500";
 };

 return (
  <div className="w-full max-w-7xl mx-auto space-y-6">

  {/* Delete Confirmation Modal */}
  {confirmDeleteId !== null && (
   <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setConfirmDeleteId(null)}>
   <div className="bg-bg-secondary border border-white/[0.08] rounded-2xl p-6 max-w-sm mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
    <h3 className="text-lg font-bold text-fg-primary mb-2">{t("projectsList.deleteProjectTitle")}</h3>
    <p className="text-sm text-fg-secondary mb-6">{t("projectsList.deleteProjectConfirm")}</p>
    <div className="flex items-center justify-end gap-3">
    <button onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 text-sm font-medium text-fg-secondary hover:text-fg-primary rounded-lg hover:bg-bg-tertiary transition-colors">{t("common.cancel")}</button>
    <button onClick={confirmDelete} disabled={deleteProject.isPending} className="px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-50">{t("projectsList.delete")}</button>
    </div>
   </div>
   </div>
  )}

  {/* ── Header ── */}
  <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
   <div className="space-y-1">
   <h1 className="text-2xl font-bold tracking-tight text-fg-primary">{t("projectsList.title")}</h1>
   <p className="text-fg-tertiary text-sm">{t("projectsList.subtitle")}</p>
   </div>
   <a
   href="/create?action=new_project"
   className="bg-accent-primary hover:bg-accent-hover transition-colors text-white px-4 py-2 rounded-lg font-medium flex items-center gap-1.5 text-sm w-fit"
   >
   <Plus size={16} />
   {t("projectsList.newProject")}
   </a>
  </header>

  {/* ── Active Projects Section ── */}
  <section className="space-y-3">
   <div className="flex items-center justify-between">
   <h2 className="text-base font-semibold text-fg-secondary">
    {t("projectsList.activeProjects")}
    <span className="ml-2 px-1.5 py-0.5 text-xs bg-bg-tertiary rounded-full text-fg-tertiary">{totalProjects}</span>
   </h2>
   </div>

   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
   {projectsWithStats.map((project) => {
    const status = getStatusBadge(project.completionPercentage);
    const gradientFrom = getGradientFrom(project.completionPercentage);
    const barColor = getBarColor(project.completionPercentage);

    return (
    <article
     key={project.id}
     onClick={() => router.push(`/create?action=new_project&projectId=${project.id}`)}
     className="bg-bg-secondary/80 backdrop-blur-xl border border-white/[0.05] rounded-2xl p-5 hover:border-accent-primary/30 transition-all duration-300 group relative flex flex-col justify-between overflow-hidden cursor-pointer"
    >
     {/* Gradient top bar */}
     <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${gradientFrom} to-transparent opacity-50`} />

     {/* Top: Ring + Title + Status + Delete */}
     <div className="flex justify-between items-start mb-4">
     <div className="flex items-center gap-4">
      <div className="flex-shrink-0">
      {project.totalTasks > 0 ? (
       <div className={`relative w-14 h-14 drop-shadow-lg ${getProgressGlow(project.completionPercentage)}`}>
       <Doughnut
        data={buildRingData(project.completedTasks, project.inProgressTasks, project.pendingTasks)}
        options={ringOptions}
        aria-label={project.title}
       />
       <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-xs font-bold ${getProgressColor(project.completionPercentage)}`}>
        {project.completionPercentage}%
        </span>
       </div>
       </div>
      ) : (
       <div className="w-14 h-14 rounded-full bg-bg-tertiary border-4 border-bg-tertiary flex items-center justify-center">
       <AlertCircle size={18} className="text-fg-tertiary" />
       </div>
      )}
      </div>

      <div>
      <div className="flex items-center gap-2">
       <h3 className="text-lg font-bold text-fg-primary">{project.title}</h3>
       {project.totalTasks > 0 && (
       <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${status.bg} ${status.text} border ${status.border}`}>
        {status.label}
       </span>
       )}
      </div>
      {project.description && (
       <p className="text-fg-tertiary text-xs mt-0.5 line-clamp-1">{project.description}</p>
      )}
      </div>
     </div>

     {project.createdById === userId && (
      <button
      type="button"
      onClick={(e) => handleDeleteProject(e, project.id)}
      disabled={deleteProject.isPending}
      className="text-fg-quaternary hover:text-rose-500 transition-colors p-1.5"
      title={t("projectsList.deleteProjectTitle")}
      >
      <Trash2 size={18} strokeWidth={1.5} />
      </button>
     )}
     </div>

     {/* 3-column task status grid */}
     {project.totalTasks > 0 ? (
     <div className="grid grid-cols-3 gap-3 mb-4">
      <div className="bg-bg-primary/50 rounded-lg p-2 border border-white/[0.05]">
      <span className="block text-fg-tertiary text-[9px] uppercase font-bold tracking-widest mb-0.5">{t("projectsList.taskTodo")}</span>
      <span className="text-base font-bold text-fg-primary">{project.pendingTasks}</span>
      </div>
      <div className="bg-bg-primary/50 rounded-lg p-2 border border-white/[0.05]">
      <span className="block text-fg-tertiary text-[9px] uppercase font-bold tracking-widest mb-0.5">{t("projectsList.taskInProgress")}</span>
      <span className="text-base font-bold text-amber-500">{project.inProgressTasks}</span>
      </div>
      <div className="bg-bg-primary/50 rounded-lg p-2 border border-white/[0.05]">
      <span className="block text-fg-tertiary text-[9px] uppercase font-bold tracking-widest mb-0.5">{t("projectsList.taskDone")}</span>
      <span className="text-base font-bold text-emerald-500">{project.completedTasks}</span>
      </div>
     </div>
     ) : (
     <div className="inline-flex items-center gap-2 text-xs text-fg-tertiary mb-4">
      <AlertCircle size={12} />
      <span className="italic">{t("projectsList.noTasksYet")}</span>
     </div>
     )}

     {/* Footer: avatars + updated time */}
     <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
     <div className="flex -space-x-2">
      {project.collaborators.slice(0, 4).map((collab) =>
      collab.image ? (
       <Image
       key={collab.id}
       src={collab.image}
       alt={collab.name ?? t("team.unknownUser")}
       width={24}
       height={24}
       className="w-6 h-6 rounded-full border-2 border-bg-secondary object-cover"
       />
      ) : (
       <div key={collab.id} className="w-6 h-6 rounded-full border-2 border-bg-secondary bg-bg-tertiary flex items-center justify-center text-[8px] font-bold text-fg-tertiary">
       {(collab.name ?? "?").charAt(0).toUpperCase()}
       </div>
      ),
      )}
      {project.collaborators.length > 4 && (
      <div className="w-6 h-6 rounded-full border-2 border-bg-secondary bg-bg-tertiary flex items-center justify-center text-[8px] font-bold text-fg-tertiary">
       +{project.collaborators.length - 4}
      </div>
      )}
      {project.collaborators.length === 0 && (
      <div className="w-6 h-6 rounded-full border-2 border-bg-secondary bg-bg-tertiary flex items-center justify-center text-[8px] font-bold text-fg-tertiary">
       ?
      </div>
      )}
     </div>
     {project.updatedAt && (
      <div className="text-[10px] text-fg-tertiary italic">
       {t("projectsList.updatedAgo", { distance: formatDistanceToNow(new Date(project.updatedAt), { addSuffix: false, locale: dateFnsLocale }) })}
      </div>
     )}
     </div>

     {/* Bottom progress bar */}
     {project.totalTasks > 0 && (
     <div className="mt-3 h-1 w-full bg-bg-tertiary rounded-full overflow-hidden">
      <div
      className={`h-full ${barColor} rounded-full transition-all duration-500`}
      style={{ width: `${project.completionPercentage}%` }}
      />
     </div>
     )}
    </article>
    );
   })}
   </div>
  </section>

  {/* ── Analytics Overview Section (compact) ── */}
  <section className="grid grid-cols-1 lg:grid-cols-4 gap-4">
   <div className="lg:col-span-1 bg-bg-secondary/80 backdrop-blur-xl border border-white/[0.05] rounded-xl p-4 flex flex-col items-center justify-center text-center space-y-2">
   <h4 className="text-fg-tertiary font-medium uppercase tracking-wider text-[10px]">
    {t("projectsList.overallProgress")}
   </h4>
   <div className={`relative w-20 h-20 drop-shadow-xl ${getProgressGlow(overallCompletion)}`}>
    <Doughnut
    data={buildRingData(totalCompletedTasks, totalInProgressTasks, totalPendingTasks)}
    options={ringOptions}
    aria-label={t("projectsList.overallProgress")}
    />
    <div className="absolute inset-0 flex items-center justify-center">
    <span className={`text-base font-bold ${getProgressColor(overallCompletion)}`}>
     {overallCompletion}%
    </span>
    </div>
   </div>
   <p className="text-fg-tertiary text-xs">
    {t("projectsList.tasksOfTasks", { completed: totalCompletedTasks, total: totalAllTasks })}
   </p>
   </div>

   <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
   <div className="bg-bg-secondary/80 backdrop-blur-xl border border-white/[0.05] rounded-xl p-5 flex flex-col items-center justify-center text-center space-y-1 border-b-2 border-b-bg-tertiary">
    <span className="text-3xl font-bold text-fg-primary">{totalProjects}</span>
    <span className="text-fg-tertiary uppercase text-[10px] tracking-widest font-semibold">{t("projectsList.activeProjects")}</span>
   </div>
   <div className="bg-bg-secondary/80 backdrop-blur-xl border border-white/[0.05] rounded-xl p-5 flex flex-col items-center justify-center text-center space-y-1 border-b-2 border-b-bg-tertiary">
    <span className="text-3xl font-bold text-fg-primary">{totalAllTasks}</span>
    <span className="text-fg-tertiary uppercase text-[10px] tracking-widest font-semibold">{t("stats.totalTasks")}</span>
   </div>
   <div className="bg-bg-secondary/80 backdrop-blur-xl border border-white/[0.05] rounded-xl p-5 flex flex-col items-center justify-center text-center space-y-1 border-b-2 border-b-accent-primary/40">
    <span className="text-2xl font-bold text-accent-primary">{totalCompletedTasks}</span>
    <span className="text-fg-tertiary uppercase text-[10px] tracking-widest font-semibold">{t("stats.completed")}</span>
   </div>
   </div>
  </section>
  </div>
 );
}
