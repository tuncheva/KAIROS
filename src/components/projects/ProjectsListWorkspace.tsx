"use client";

import { useState, useEffect } from"react";
import { api } from"~/trpc/react";
import { AlertCircle } from"lucide-react";
import { useRouter } from"next/navigation";
import { useTranslations } from"next-intl";
import { Doughnut } from"react-chartjs-2";
import { ensureChartJsRegistered } from"~/components/charts/chartjs";
import { useResolvedThemeColors } from "~/components/charts/themeColors";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";

interface Collaborator {
 id: string;
 name: string | null;
 image: string | null;
}

interface ProjectWithStats {
 id: number;
 title: string;
 description: string | null;
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
 if (typeof item ==="number" && Number.isFinite(item)) out.push(item);
 }
 return out;
}

function hasTasks(value: unknown): value is { tasks: Array<{ status: string }> } {
 if (value == null || typeof value !=="object") return false;

 const v = value as Record<string, unknown>;
 const tasks = v.tasks;
 if (!Array.isArray(tasks)) return false;

 return tasks.every((item) => {
 if (item == null || typeof item !=="object") return false;
 const it = item as Record<string, unknown>;
 return typeof it.status ==="string";
 });
}

function hasCollaborators(value: unknown): value is { collaborators: Array<{ id: string; name: string | null; image: string | null }> } {
 if (value == null || typeof value !=="object") return false;
 const v = value as Record<string, unknown>;
 return Array.isArray(v.collaborators);
}

function getUpdatedAt(value: unknown): string | Date | null {
 if (value == null || typeof value !=="object") return null;
 const v = value as Record<string, unknown>;
 if (v.updatedAt instanceof Date || typeof v.updatedAt === "string") return v.updatedAt;
 return null;
}

export function ProjectsListWorkspace() {
 const [mounted, setMounted] = useState(false);
 const [animateCharts, setAnimateCharts] = useState(false);
 const router = useRouter();
 
 ensureChartJsRegistered();
 const colors = useResolvedThemeColors();

 const t = useTranslations("create");

 useEffect(() => {
 setMounted(true);
 const timer = setTimeout(() => setAnimateCharts(true), 100);
 return () => clearTimeout(timer);
 }, []);

 const { data: projects, isLoading } = api.project.getMyProjects.useQuery(undefined, {
 staleTime: 1000 * 60 * 5,
 });

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

 if (isLoading || !projects || projects.length === 0) {
 return null;
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

 const getProgressColor= (percentage: number): string => {
 if (percentage === 0) return"text-fg-tertiary";
 if (percentage < 30) return"text-error";
 if (percentage < 60) return"text-warning";
 if (percentage < 100) return"text-accent-primary";
 return"text-success";
 };

 const getProgressGlow = (percentage: number): string => {
 if (percentage === 0) return"shadow-transparent";
 if (percentage < 30) return"shadow-error/20";
 if (percentage < 60) return"shadow-warning/20";
 if (percentage < 100) return"shadow-accent-primary/20";
 return"shadow-success/30";
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
 cutout:"72%",
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

 const getStatusBadge = (percentage: number) => {
 if (percentage === 100) return { label: "Complete", color: "bg-success/10 text-success border-success/20" };
 if (percentage >= 60) return { label: "On Track", color: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" };
 if (percentage >= 30) return { label: "In Progress", color: "bg-warning/10 text-warning border-warning/20" };
 return { label: "At Risk", color: "bg-error/10 text-error border-error/20" };
 };

 const getBarColor = (percentage: number) => {
 if (percentage === 100) return "bg-success";
 if (percentage >= 60) return "bg-emerald-500";
 if (percentage >= 30) return "bg-warning";
 return "bg-error";
 };

 const getGradientColor = (percentage: number) => {
 if (percentage >= 60) return "from-emerald-500";
 if (percentage >= 30) return "from-warning";
 return "from-error";
 };

 return (
 <div className="w-full max-w-6xl mx-auto px-4 sm:px-6">
 {/* Header */}
 <div className="pt-8 pb-6">
 <h1 className="text-[34px] font-[700] leading-[1.1] tracking-[-0.022em] text-fg-primary mb-2">
 Project Analytics
 </h1>
 <p className="text-[15px] leading-[1.4667] tracking-[-0.01em] text-fg-tertiary">
 {t("projectsList.subtitle")}
 </p>
 </div>

 {/* Active Projects Section */}
 <div className="mb-8">
 <div className="flex items-center justify-between mb-4">
 <h2 className="text-lg font-semibold text-fg-secondary">
 Active Projects
 <span className="ml-2 px-2 py-0.5 text-xs bg-bg-tertiary rounded-full text-fg-tertiary">{totalProjects}</span>
 </h2>
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {projectsWithStats.map((project) => {
 const status = getStatusBadge(project.completionPercentage);
 const barColor = getBarColor(project.completionPercentage);
 const gradientFrom = getGradientColor(project.completionPercentage);

 return (
 <button
 key={project.id}
 onClick={() => router.push(`/create?action=new_project&projectId=${project.id}`)}
 className="w-full text-left bg-bg-secondary rounded-2xl p-6 border border-white/[0.06] hover:border-accent-primary/30 transition-all duration-300 relative overflow-hidden group"
 >
 {/* Gradient top bar */}
 <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${gradientFrom} to-transparent opacity-50`} />

 {/* Header: chart + title + status badge */}
 <div className="flex items-start gap-5 mb-5">
 <div className="flex-shrink-0">
 {project.totalTasks > 0 ? (
 <div className={`relative w-[72px] h-[72px] drop-shadow-lg ${getProgressGlow(project.completionPercentage)}`}>
 <Doughnut
 data={buildRingData(project.completedTasks, project.inProgressTasks, project.pendingTasks)}
 options={ringOptions}
 aria-label={project.title}
 />
 <div className="absolute inset-0 flex items-center justify-center">
 <span className={`text-sm font-bold ${getProgressColor(project.completionPercentage)}`}>
 {project.completionPercentage}%
 </span>
 </div>
 </div>
 ) : (
 <div className="w-[72px] h-[72px] rounded-full bg-bg-tertiary border border-border-light/30 flex items-center justify-center">
 <AlertCircle size={24} className="text-fg-tertiary" />
 </div>
 )}
 </div>

 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-3 mb-1">
 <h3 className="text-xl font-bold text-fg-primary truncate">{project.title}</h3>
 {project.totalTasks > 0 && (
 <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${status.color}`}>
 {status.label}
 </span>
 )}
 </div>
 {project.description && (
 <p className="text-sm text-fg-tertiary line-clamp-1">{project.description}</p>
 )}
 </div>
 </div>

 {/* Task status blocks */}
 {project.totalTasks > 0 ? (
 <div className="grid grid-cols-3 gap-3 mb-5">
 <div className="bg-bg-primary/50 rounded-xl p-3 border border-white/[0.04]">
 <span className="block text-fg-tertiary text-[10px] uppercase font-bold tracking-widest mb-1">To Do</span>
 <span className="text-lg font-bold text-fg-primary">{project.pendingTasks}</span>
 </div>
 <div className="bg-bg-primary/50 rounded-xl p-3 border border-white/[0.04]">
 <span className="block text-fg-tertiary text-[10px] uppercase font-bold tracking-widest mb-1">In Progress</span>
 <span className="text-lg font-bold text-warning">{project.inProgressTasks}</span>
 </div>
 <div className="bg-bg-primary/50 rounded-xl p-3 border border-white/[0.04]">
 <span className="block text-fg-tertiary text-[10px] uppercase font-bold tracking-widest mb-1">Done</span>
 <span className="text-lg font-bold text-success">{project.completedTasks}</span>
 </div>
 </div>
 ) : (
 <div className="inline-flex items-center gap-2 text-[13px] text-fg-tertiary bg-bg-tertiary/30 px-3 py-1.5 rounded-lg mb-5">
 <AlertCircle size={12} />
 <span className="italic">{t("projectsList.noTasksYet")}</span>
 </div>
 )}

 {/* Footer: avatars + updated time */}
 <div className="flex items-center justify-between pt-4 border-t border-white/[0.04]">
 <div className="flex -space-x-2">
 {project.collaborators.slice(0, 4).map((collab) => (
 collab.image ? (
 <Image
 key={collab.id}
 src={collab.image}
 alt={collab.name ?? "User"}
 width={28}
 height={28}
 className="w-7 h-7 rounded-full border-2 border-bg-secondary object-cover"
 />
 ) : (
 <div key={collab.id} className="w-7 h-7 rounded-full border-2 border-bg-secondary bg-bg-tertiary flex items-center justify-center text-[10px] font-bold text-fg-tertiary">
 {(collab.name ?? "?").charAt(0).toUpperCase()}
 </div>
 )
 ))}
 {project.collaborators.length > 4 && (
 <div className="w-7 h-7 rounded-full border-2 border-bg-secondary bg-bg-tertiary flex items-center justify-center text-[10px] font-bold text-fg-tertiary">
 +{project.collaborators.length - 4}
 </div>
 )}
 </div>
 {project.updatedAt && (
 <span className="text-xs text-fg-tertiary italic">
 Updated {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: false })} ago
 </span>
 )}
 </div>

 {/* Bottom progress bar */}
 {project.totalTasks > 0 && (
 <div className="mt-4 h-1 w-full bg-bg-tertiary/30 rounded-full overflow-hidden">
 <div
 className={`h-full ${barColor} rounded-full transition-all duration-500`}
 style={{ width: `${project.completionPercentage}%` }}
 />
 </div>
 )}
 </button>
 );
 })}
 </div>
 </div>

 {/* Stats Grid */}
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 mb-8">
 <div className="col-span-2 sm:col-span-1 lg:col-span-1">
 <div className="bg-bg-secondary rounded-[10px] p-4 sm:p-6 flex flex-col items-center justify-center border border-white/[0.06]">
 <div className={`relative w-24 h-24 sm:w-28 sm:h-28 drop-shadow-2xl ${getProgressGlow(overallCompletion)}`}>
 <Doughnut
 data={buildRingData(totalCompletedTasks, totalInProgressTasks, totalPendingTasks)}
 options={ringOptions}
 aria-label={t("projectsList.overallProgress")}
 />
 <div className="absolute inset-0 flex items-center justify-center">
 <span className={`text-xl sm:text-2xl font-bold ${getProgressColor(overallCompletion)}`}>
 {overallCompletion}%
 </span>
 </div>
 </div>
 <div className="mt-3 sm:mt-4 text-center">
 <p className="text-[10px] sm:text-xs text-fg-tertiary uppercase tracking-wider font-semibold">
 {t("projectsList.overallProgress")}
 </p>
 <p className="text-[9px] sm:text-[10px] text-fg-tertiary mt-1">
 {t("projectsList.tasksOfTasks", { completed: totalCompletedTasks, total: totalAllTasks })}
 </p>
 </div>
 </div>
 </div>

 <div>
 <div className="bg-bg-secondary rounded-[10px] p-4 sm:p-6 flex flex-col items-center justify-center border border-white/[0.06] hover:bg-bg-tertiary transition-colors">
 <div className="text-3xl sm:text-4xl lg:text-5xl font-bold bg-gradient-to-br from-accent-primary to-accent-secondary bg-clip-text text-transparent">
 {totalProjects}
 </div>
 <p className="text-[10px] sm:text-xs text-fg-tertiary mt-2 sm:mt-3 uppercase tracking-wider font-semibold text-center">
 {t("projectsList.activeProjects")}
 </p>
 </div>
 </div>

 <div>
 <div className="bg-bg-secondary rounded-[10px] p-4 sm:p-6 flex flex-col items-center justify-center border border-white/[0.06] hover:bg-bg-tertiary transition-colors">
 <div className="text-3xl sm:text-4xl lg:text-5xl font-bold text-fg-primary">
 {totalAllTasks}
 </div>
 <p className="text-[10px] sm:text-xs text-fg-tertiary mt-2 sm:mt-3 uppercase tracking-wider font-semibold text-center">
 {t("stats.totalTasks")}
 </p>
 </div>
 </div>

 <div>
 <div className="bg-bg-secondary rounded-[10px] p-4 sm:p-6 flex flex-col items-center justify-center border border-white/[0.06] hover:bg-bg-tertiary transition-colors">
 <div className="text-2xl sm:text-3xl font-bold bg-gradient-to-br from-success to-success/80 bg-clip-text text-transparent">
 {totalCompletedTasks}
 </div>
 <p className="text-[10px] sm:text-xs text-fg-tertiary mt-2 sm:mt-3 uppercase tracking-wider font-semibold text-center">
 {t("stats.completed")}
 </p>
 </div>
 </div>
 </div>

 {/* Bottom Spacing */}
 <div className="h-8"></div>
 </div>
 );
}