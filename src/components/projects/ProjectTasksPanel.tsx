"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Check, Pencil, Plus, StickyNote, Trash2, UserPlus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { ProfileLink } from "~/components/profile/ProfileLink";
import { useToast } from "~/components/providers/ToastProvider";
import {
  PRIORITY_DOT,
  TaskDrawer,
  type EditableTask,
  type TaskMember,
  type TaskPriority,
  type TaskStatus,
} from "./TaskDrawer";

type ProjectTask = {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | string | null;
  completedAt: Date | string | null;
  completionNote: string | null;
  assignedTo: { id: string; name: string | null; image: string | null } | null;
  completedBy?: { id: string; name: string | null; image: string | null } | null;
};

type StatusFilter = "all" | TaskStatus;

const STATUS_FILTERS: StatusFilter[] = ["all", "pending", "in_progress", "completed", "blocked"];

const STATUS_TEXT: Record<TaskStatus, string> = {
  pending: "text-fg-tertiary",
  in_progress: "text-warning",
  completed: "text-success",
  blocked: "text-error",
};

/** Clicking the marker walks the common path; `blocked` is set in the drawer. */
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  pending: "in_progress",
  in_progress: "completed",
  completed: "pending",
  blocked: "in_progress",
};

const STAMP = "kairos-stamp text-[10px] tracking-[0.14em] text-fg-quaternary";

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The task board for one open project.
 *
 * This is what `/create?action=new_project` used to be: create a task, move it,
 * reassign it, note how it finished, drop it. It lives inside the project's own
 * page because the board and the project's timeline are two readings of the
 * same records — routing between them made you lose your place to see either.
 */
export function ProjectTasksPanel({
  projectId,
  userId,
}: {
  projectId: number;
  userId: string;
}) {
  const t = useTranslations("projects.tasks");
  const locale = useLocale();
  const toast = useToast();
  const utils = api.useUtils();

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<EditableTask | null>(null);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState<number | null>(null);

  const projectQuery = api.project.getById.useQuery({ id: projectId }, { staleTime: 1000 * 30 });

  const isOwner = projectQuery.data?.createdById === userId;
  const canWrite = isOwner || (projectQuery.data?.userHasWriteAccess ?? false);

  const tasks = useMemo(
    () => ((projectQuery.data?.tasks ?? []) as ProjectTask[]),
    [projectQuery.data],
  );

  const members: TaskMember[] = useMemo(() => {
    const project = projectQuery.data;
    if (!project) return [];
    const owner = project.createdById
      ? [
          {
            id: project.createdById,
            name: project.createdBy?.name ?? project.createdBy?.email ?? null,
            email: project.createdBy?.email ?? null,
            image: project.createdBy?.image ?? null,
          },
        ]
      : [];
    const collaborators = (project.collaborators ?? []).map((row) => ({
      id: row.collaboratorId,
      name: row.collaborator?.name ?? null,
      email: row.collaborator?.email ?? null,
      image: row.collaborator?.image ?? null,
    }));
    return [...owner, ...collaborators];
  }, [projectQuery.data]);

  const invalidate = async () => {
    await Promise.all([
      utils.project.getById.invalidate({ id: projectId }),
      utils.project.getMyProjects.invalidate(),
      utils.task.getByProject.invalidate({ projectId }),
      utils.task.getProjectActivity.invalidate({ projectId, limit: 100 }),
    ]);
  };

  const updateStatus = api.task.updateStatus.useMutation({
    // The marker is the fastest control on the page, so it must not wait for a
    // round trip before it looks like it did anything.
    onMutate: async ({ taskId, status }) => {
      await utils.project.getById.cancel({ id: projectId });
      const previous = utils.project.getById.getData({ id: projectId });
      utils.project.getById.setData({ id: projectId }, (old) =>
        old
          ? {
              ...old,
              tasks: old.tasks?.map((task) =>
                task.id === taskId
                  ? {
                      ...task,
                      status,
                      completedAt: status === "completed" ? new Date() : null,
                      completionNote: status === "completed" ? task.completionNote : null,
                    }
                  : task,
              ),
            }
          : old,
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) utils.project.getById.setData({ id: projectId }, context.previous);
      toast.error(error.message);
    },
    onSettled: () => void invalidate(),
  });

  const setCompletionNote = api.task.setCompletionNote.useMutation({
    onSuccess: async () => {
      setNoteFor(null);
      await invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const discardTask = api.task.adminDiscard.useMutation({
    onSuccess: async () => {
      setConfirmDiscard(null);
      toast.success(t("discarded"));
      await invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const shown = filter === "all" ? tasks : tasks.filter((task) => task.status === filter);

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };

  const openEdit = (task: ProjectTask) => {
    setEditing({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      dueDate: task.dueDate,
      assignedTo: task.assignedTo ? { id: task.assignedTo.id } : null,
    });
    setDrawerOpen(true);
  };

  const canNote = (task: ProjectTask) =>
    canWrite || isOwner || (task.completedBy?.id ?? null) === userId;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className={STAMP}>{t("label")}</span>

        {STATUS_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`h-8 rounded-lg border px-3 text-[13px] font-medium transition-colors duration-300 ${
              filter === key
                ? "border-accent-primary/55 bg-accent-primary/[0.14] text-fg-primary"
                : "border-border-light/60 text-fg-tertiary hover:border-border-strong/60 hover:text-fg-secondary"
            }`}
          >
            {t(`filters.${key}`)}
            <span className="ml-1.5 font-mono text-[11px] text-fg-quaternary">
              {key === "all" ? tasks.length : tasks.filter((task) => task.status === key).length}
            </span>
          </button>
        ))}

        <span className="hidden flex-1 sm:block" />

        {canWrite && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 rounded-lg bg-accent-primary px-[15px] py-[9px] text-[13px] font-semibold text-white transition-all duration-300 hover:-translate-y-px hover:bg-accent-hover"
          >
            <Plus size={15} aria-hidden />
            {t("new")}
          </button>
        )}
      </div>

      <div className="border-t border-border-light/60">
        {projectQuery.isLoading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="border-b border-border-light/50 px-1 py-4">
              <div className="h-4 w-2/5 animate-pulse rounded bg-bg-tertiary" />
            </div>
          ))
        ) : shown.length === 0 ? (
          <p className="px-1 py-8 text-sm text-fg-tertiary">
            {tasks.length === 0 ? t("empty") : t("noneInFilter")}
          </p>
        ) : (
          shown.map((task) => {
            const due = asDate(task.dueDate);
            const overdue = due !== null && task.status !== "completed" && due.getTime() < Date.now();

            return (
              <div
                key={task.id}
                className="group grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-3.5 border-b border-border-light/50 px-1 py-4 transition-colors duration-[350ms] hover:bg-accent-primary/[0.06]"
              >
                <button
                  type="button"
                  disabled={!canWrite || updateStatus.isPending}
                  onClick={() =>
                    updateStatus.mutate({ taskId: task.id, status: NEXT_STATUS[task.status] })
                  }
                  aria-label={t("advance")}
                  title={t(`statuses.${task.status}`)}
                  className={`mt-[3px] flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors duration-300 disabled:cursor-default ${
                    task.status === "completed"
                      ? "border-success/60 bg-success/20 text-success"
                      : task.status === "blocked"
                        ? "border-error/60 text-error"
                        : task.status === "in_progress"
                          ? "border-warning/70 text-warning"
                          : "border-border-medium/70 text-transparent hover:border-accent-primary/60"
                  }`}
                >
                  {task.status === "completed" ? (
                    <Check size={11} strokeWidth={3} aria-hidden />
                  ) : task.status === "in_progress" ? (
                    <span className="h-[7px] w-[7px] rounded-full bg-warning" aria-hidden />
                  ) : task.status === "blocked" ? (
                    <X size={11} strokeWidth={3} aria-hidden />
                  ) : null}
                </button>

                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span
                      className={`text-[15px] font-medium tracking-[-0.01em] ${
                        task.status === "completed"
                          ? "text-fg-quaternary line-through"
                          : "text-fg-primary"
                      }`}
                    >
                      {task.title}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className={`h-[7px] w-[7px] rounded-full ${PRIORITY_DOT[task.priority]}`}
                      />
                      <span className={STAMP}>{t(`priorities.${task.priority}`)}</span>
                    </span>
                    <span className={`${STAMP} ${STATUS_TEXT[task.status]}`}>
                      {t(`statuses.${task.status}`)}
                    </span>
                  </div>

                  {task.description && (
                    <span className="text-[13px] leading-[1.45] text-fg-tertiary">
                      {task.description}
                    </span>
                  )}

                  <div className="flex flex-wrap items-center gap-3 pt-0.5">
                    {task.assignedTo ? (
                      <span className="flex items-center gap-1.5 text-[12px] text-fg-tertiary">
                        {task.assignedTo.image ? (
                          <Image
                            src={task.assignedTo.image}
                            alt=""
                            width={18}
                            height={18}
                            className="h-[18px] w-[18px] rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-bg-tertiary text-[10px] font-bold text-fg-tertiary">
                            {(task.assignedTo.name ?? "?").trim().charAt(0).toUpperCase() || "?"}
                          </span>
                        )}
                        {task.assignedTo.name ?? t("someone")}
                      </span>
                    ) : (
                      <span className="text-[12px] text-fg-quaternary">{t("unassigned")}</span>
                    )}

                    {due && (
                      <span
                        className={`font-mono text-[11px] ${overdue ? "text-error" : "text-fg-quaternary"}`}
                      >
                        {new Intl.DateTimeFormat(locale, {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                          .format(due)
                          .toUpperCase()}
                      </span>
                    )}
                  </div>

                  {task.status === "completed" &&
                    (noteFor === task.id ? (
                      <div className="mt-1.5 flex flex-col gap-2">
                        <textarea
                          rows={2}
                          value={noteDraft}
                          autoFocus
                          onChange={(event) => setNoteDraft(event.target.value)}
                          placeholder={t("notePlaceholder")}
                          className="resize-none rounded-[9px] border border-border-light/60 bg-bg-tertiary px-3.5 py-2.5 text-[13px] leading-[1.5] text-fg-primary outline-none transition-colors duration-300 placeholder:text-fg-quaternary focus:border-accent-primary/60"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={setCompletionNote.isPending}
                            onClick={() =>
                              setCompletionNote.mutate({
                                taskId: task.id,
                                completionNote: noteDraft.trim() || null,
                              })
                            }
                            className="rounded-lg bg-accent-primary px-3.5 py-2 text-[13px] font-semibold text-white transition-colors duration-300 hover:bg-accent-hover disabled:opacity-50"
                          >
                            {t("saveNote")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setNoteFor(null)}
                            className="rounded-lg border border-border-light/70 px-3.5 py-2 text-[13px] font-medium text-fg-secondary transition-colors duration-300 hover:text-fg-primary"
                          >
                            {t("cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={!canNote(task)}
                        onClick={() => {
                          setNoteDraft(task.completionNote ?? "");
                          setNoteFor(task.id);
                        }}
                        className="mt-1 flex items-start gap-2 text-left text-[13px] text-fg-tertiary transition-colors duration-300 hover:text-fg-secondary disabled:pointer-events-none"
                      >
                        <StickyNote
                          size={13}
                          className="mt-[3px] flex-none text-accent-secondary"
                          aria-hidden
                        />
                        {task.completionNote ?? t("addNote")}
                      </button>
                    ))}
                </div>

                {canWrite && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(task)}
                      aria-label={t("edit")}
                      title={t("edit")}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-quaternary transition-colors duration-300 hover:bg-bg-tertiary hover:text-fg-primary"
                    >
                      <Pencil size={15} strokeWidth={1.6} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        confirmDiscard === task.id
                          ? discardTask.mutate({ taskId: task.id })
                          : setConfirmDiscard(task.id)
                      }
                      onBlur={() => setConfirmDiscard((id) => (id === task.id ? null : id))}
                      disabled={discardTask.isPending}
                      aria-label={t("discard")}
                      title={confirmDiscard === task.id ? t("discardConfirm") : t("discard")}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-300 ${
                        confirmDiscard === task.id
                          ? "bg-error/10 text-error"
                          : "text-fg-quaternary hover:bg-bg-tertiary hover:text-error"
                      }`}
                    >
                      <Trash2 size={15} strokeWidth={1.6} aria-hidden />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <TaskDrawer
        projectId={projectId}
        members={members}
        task={editing}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

/**
 * Who can see the project, and at what permission.
 *
 * Owners get the whole control; everyone else gets the same list read-only,
 * because knowing who else is on a project is not an owner-only fact.
 */
export function ProjectTeamPanel({
  projectId,
  userId,
}: {
  projectId: number;
  userId: string;
}) {
  const t = useTranslations("projects.team");
  const toast = useToast();
  const utils = api.useUtils();

  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"read" | "write">("read");

  const projectQuery = api.project.getById.useQuery({ id: projectId }, { staleTime: 1000 * 30 });

  const refresh = () => utils.project.getById.invalidate({ id: projectId });

  const addCollaborator = api.project.addCollaborator.useMutation({
    onSuccess: async () => {
      toast.success(t("added", { email: email.trim() }));
      setEmail("");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const removeCollaborator = api.project.removeCollaborator.useMutation({
    onSuccess: async () => {
      toast.success(t("removed"));
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const updatePermission = api.project.updateCollaboratorPermission.useMutation({
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(error.message),
  });

  const project = projectQuery.data;
  const isOwner = project?.createdById === userId;
  const collaborators = project?.collaborators ?? [];

  return (
    <div className="flex flex-col gap-3.5">
      <span className={STAMP}>{t("label")}</span>

      <div className="border-t border-border-light/60">
        {project?.createdBy && (
          <div className="flex items-center gap-3 border-b border-border-light/50 px-1 py-3.5">
            <Member
              name={project.createdBy.name ?? project.createdBy.email ?? ""}
              image={project.createdBy.image ?? null}
              email={project.createdBy.email ?? ""}
              userId={project.createdById}
            />
            <span className="hidden flex-1 sm:block" />
            <span className={STAMP}>{t("owner")}</span>
          </div>
        )}

        {collaborators.map((row) => (
          <div
            key={row.collaboratorId}
            className="flex flex-wrap items-center gap-3 border-b border-border-light/50 px-1 py-3.5"
          >
            <Member
              name={row.collaborator?.name ?? row.collaborator?.email ?? ""}
              image={row.collaborator?.image ?? null}
              email={row.collaborator?.email ?? ""}
              userId={row.collaboratorId}
            />
            <span className="hidden flex-1 sm:block" />

            {isOwner ? (
              <>
                <div className="flex overflow-hidden rounded-lg border border-border-light/60">
                  {(["read", "write"] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        updatePermission.mutate({
                          projectId,
                          collaboratorId: row.collaboratorId,
                          permission: key,
                        })
                      }
                      aria-pressed={row.permission === key}
                      className={`h-[30px] px-3 text-[12px] font-medium transition-colors duration-300 ${
                        row.permission === key
                          ? "bg-accent-primary/[0.16] text-fg-primary"
                          : "text-fg-tertiary hover:text-fg-secondary"
                      }`}
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    removeCollaborator.mutate({
                      projectId,
                      collaboratorId: row.collaboratorId,
                    })
                  }
                  aria-label={t("remove")}
                  title={t("remove")}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-fg-quaternary transition-colors duration-300 hover:bg-bg-tertiary hover:text-error"
                >
                  <X size={15} aria-hidden />
                </button>
              </>
            ) : (
              <span className={STAMP}>{t(row.permission)}</span>
            )}
          </div>
        ))}

        {collaborators.length === 0 && (
          <p className="px-1 py-4 text-sm text-fg-tertiary">{t("empty")}</p>
        )}
      </div>

      {isOwner && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!email.trim()) return;
            addCollaborator.mutate({ projectId, email: email.trim(), permission });
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("invitePlaceholder")}
            className="h-10 min-w-0 flex-1 rounded-[9px] border border-border-light/60 bg-bg-tertiary px-3.5 text-sm text-fg-primary outline-none transition-colors duration-300 placeholder:text-fg-quaternary focus:border-accent-primary/60 sm:max-w-[280px]"
          />
          <div className="flex overflow-hidden rounded-lg border border-border-light/60">
            {(["read", "write"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPermission(key)}
                aria-pressed={permission === key}
                className={`h-10 px-3 text-[12px] font-medium transition-colors duration-300 ${
                  permission === key
                    ? "bg-accent-primary/[0.16] text-fg-primary"
                    : "text-fg-tertiary hover:text-fg-secondary"
                }`}
              >
                {t(key)}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={addCollaborator.isPending || email.trim().length === 0}
            className="flex h-10 items-center gap-2 rounded-[9px] border border-border-light/60 px-3.5 text-[13px] font-medium text-fg-secondary transition-colors duration-300 hover:border-accent-primary/40 hover:text-fg-primary disabled:opacity-50"
          >
            <UserPlus size={15} aria-hidden />
            {t("invite")}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * A person in the team list.
 *
 * `userId` is optional because the same component draws rows that may not have
 * resolved to a user yet; without one it renders exactly as before, just
 * inert, rather than offering a tap that goes nowhere.
 */
function Member({
  name,
  image,
  email,
  userId,
}: {
  name: string;
  image: string | null;
  email: string;
  userId?: string | null;
}) {
  const body = (
    <span className="flex min-w-0 items-center gap-2.5">
      {image ? (
        <Image
          src={image}
          alt=""
          width={26}
          height={26}
          className="h-[26px] w-[26px] flex-none rounded-full object-cover"
        />
      ) : (
        <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-bg-tertiary text-[11px] font-bold text-fg-tertiary">
          {(name || "?").trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-fg-primary">{name || email}</span>
        {email && name !== email && (
          <span className="block truncate text-[12px] text-fg-quaternary">{email}</span>
        )}
      </span>
    </span>
  );

  if (!userId) return body;

  return (
    <ProfileLink
      userId={userId}
      name={name}
      className="min-w-0 rounded-lg text-left"
    >
      {body}
    </ProfileLink>
  );
}
