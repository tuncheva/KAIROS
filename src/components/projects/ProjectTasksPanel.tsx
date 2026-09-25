"use client";

import { useMemo, useState } from "react";

import {
  Check,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  UserPlus,
  X,
} from "~/components/ui/icons";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { ProfileLink } from "~/components/profile/ProfileLink";
import { useToast } from "~/components/providers/ToastProvider";
import {
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
  completedBy?: {
    id: string;
    name: string | null;
    image: string | null;
  } | null;
};

type StatusFilter = "all" | TaskStatus;

const STATUS_FILTERS: StatusFilter[] = [
  "all",
  "pending",
  "in_progress",
  "completed",
  "blocked",
];

const STATUS_TEXT: Record<TaskStatus, string> = {
  pending: "text-tui-ink3",
  in_progress: "text-tui-warn",
  completed: "text-tui-ok",
  blocked: "text-tui-danger",
};

/** Priority as a dot, in the terminal-refined palette. */
const PRIORITY_DOT: Record<TaskPriority, string> = {
  low: "bg-tui-ink3",
  medium: "bg-tui-ok",
  high: "bg-tui-warn",
  urgent: "bg-tui-danger",
};

/** Clicking the marker walks the common path; `blocked` is set in the drawer. */
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  pending: "in_progress",
  in_progress: "completed",
  completed: "pending",
  blocked: "in_progress",
};

const STAMP =
  "text-[11px] font-medium uppercase tracking-[0.14em] text-tui-ink3";

/** The card shell shared with the rest of the refined edition. */
const CARD =
  "overflow-hidden rounded-lg border border-tui-ink/12 bg-tui-pane shadow-[var(--tui-pane-shadow)]";

/** A refined filter pill. */
function FilterPill({
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
      className={`flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
        active
          ? "border-tui-accent/55 bg-tui-accent/[0.14] text-tui-ink"
          : "border-tui-ink/16 text-tui-ink3 hover:text-tui-ink2"
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
      className="border-tui-ink/16 bg-tui-pane font-display text-tui-ink2 flex flex-none items-center justify-center rounded-full border"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
    >
      {label.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

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

  const projectQuery = api.project.getById.useQuery(
    { id: projectId },
    { staleTime: 1000 * 30 },
  );

  const isOwner = projectQuery.data?.createdById === userId;
  const canWrite = isOwner || (projectQuery.data?.userHasWriteAccess ?? false);

  /*
   * Two routes to removing a task, and the server decides which the caller has.
   *
   * `task.delete` is the everyday one, gated on the `canDeleteTasks` flag.
   * `task.adminDiscard` is the project owner / org admin override, which works
   * without the flag. Someone can hold either, both, or neither — and a
   * contributor with write access holds neither, which is exactly the case the
   * old code got wrong by painting the control on `canWrite` alone.
   */
  const canDeleteTasks = projectQuery.data?.userCanDeleteTasks ?? false;
  const canDiscardTasks = projectQuery.data?.userCanDiscardTasks ?? false;
  const canRemoveTasks = canDeleteTasks || canDiscardTasks;

  const tasks = useMemo(
    () => (projectQuery.data?.tasks ?? []) as ProjectTask[],
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
                      completionNote:
                        status === "completed" ? task.completionNote : null,
                    }
                  : task,
              ),
            }
          : old,
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous)
        utils.project.getById.setData({ id: projectId }, context.previous);
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

  const deleteTask = api.task.delete.useMutation({
    onSuccess: async () => {
      setConfirmDiscard(null);
      toast.success(t("discarded"));
      await invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  /*
   * One control, not two.
   *
   * Both procedures delete the same row; the difference is only which
   * authorization the caller passes. Two adjacent trash buttons would ask the
   * user to understand our permission model in order to remove a task. The flag
   * route is preferred so an owner who also holds it takes the ordinary path,
   * and `adminDiscard` stays what its name says: the override.
   */
  const removeTask = (taskId: number) => {
    if (canDeleteTasks) deleteTask.mutate({ taskId });
    else discardTask.mutate({ taskId });
  };

  const removing = deleteTask.isPending || discardTask.isPending;

  const shown =
    filter === "all" ? tasks : tasks.filter((task) => task.status === filter);

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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        {STATUS_FILTERS.map((key) => (
          <FilterPill
            key={key}
            active={filter === key}
            onClick={() => setFilter(key)}
          >
            {t(`filters.${key}`)}
            <span className="text-tui-ink3 text-[11.5px] tabular-nums">
              {key === "all"
                ? tasks.length
                : tasks.filter((task) => task.status === key).length}
            </span>
          </FilterPill>
        ))}

        <span className="hidden flex-1 sm:block" />

        {canWrite && (
          <button
            type="button"
            onClick={openCreate}
            className="bg-tui-accent text-tui-on-accent flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-opacity hover:opacity-90"
          >
            <Plus size={15} aria-hidden />
            {t("new")}
          </button>
        )}
      </div>

      <div className={CARD}>
        {projectQuery.isLoading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="border-tui-ink/8 border-b px-7 py-4 last:border-b-0"
            >
              <div className="bg-tui-ink/8 h-4 w-2/5 animate-pulse rounded-sm" />
            </div>
          ))
        ) : shown.length === 0 ? (
          <p className="text-tui-ink2 px-7 py-8 text-[14px]">
            {tasks.length === 0 ? t("empty") : t("noneInFilter")}
          </p>
        ) : (
          shown.map((task) => {
            const due = asDate(task.dueDate);
            const overdue =
              due !== null &&
              task.status !== "completed" &&
              due.getTime() < Date.now();

            return (
              <div
                key={task.id}
                className="group border-tui-ink/8 hover:bg-tui-accent/[0.05] grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-3.5 border-b px-7 py-4 transition-colors last:border-b-0"
              >
                <button
                  type="button"
                  disabled={!canWrite || updateStatus.isPending}
                  onClick={() =>
                    updateStatus.mutate({
                      taskId: task.id,
                      status: NEXT_STATUS[task.status],
                    })
                  }
                  aria-label={t("advance")}
                  title={t(`statuses.${task.status}`)}
                  className={`mt-[3px] flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors disabled:cursor-default ${
                    task.status === "completed"
                      ? "border-tui-ok/60 bg-tui-ok/20 text-tui-ok"
                      : task.status === "blocked"
                        ? "border-tui-danger/60 text-tui-danger"
                        : task.status === "in_progress"
                          ? "border-tui-warn/70 text-tui-warn"
                          : "border-tui-ink/25 hover:border-tui-accent/60 text-transparent"
                  }`}
                >
                  {task.status === "completed" ? (
                    <Check size={11} strokeWidth={3} aria-hidden />
                  ) : task.status === "in_progress" ? (
                    <span
                      className="bg-tui-warn h-[7px] w-[7px] rounded-full"
                      aria-hidden
                    />
                  ) : task.status === "blocked" ? (
                    <X size={11} strokeWidth={3} aria-hidden />
                  ) : null}
                </button>

                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span
                      className={`text-[15px] font-medium tracking-[-0.01em] ${
                        task.status === "completed"
                          ? "text-tui-ink3 line-through"
                          : "text-tui-ink"
                      }`}
                    >
                      {task.title}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className={`h-[7px] w-[7px] rounded-full ${PRIORITY_DOT[task.priority]}`}
                      />
                      <span className={STAMP}>
                        {t(`priorities.${task.priority}`)}
                      </span>
                    </span>
                    <span className={`${STAMP} ${STATUS_TEXT[task.status]}`}>
                      {t(`statuses.${task.status}`)}
                    </span>
                  </div>

                  {task.description && (
                    <span className="text-tui-ink2 text-[13px] leading-[1.45]">
                      {task.description}
                    </span>
                  )}

                  <div className="flex flex-wrap items-center gap-3 pt-0.5">
                    {task.assignedTo ? (
                      <span className="text-tui-ink2 flex items-center gap-2 text-[12px]">
                        <Initial
                          label={task.assignedTo.name ?? "?"}
                          size={18}
                        />
                        {task.assignedTo.name ?? t("someone")}
                      </span>
                    ) : (
                      <span className="text-tui-ink3 text-[12px]">
                        {t("unassigned")}
                      </span>
                    )}

                    {due && (
                      <span
                        className={`text-[11.5px] ${overdue ? "text-tui-danger" : "text-tui-ink3"}`}
                      >
                        {new Intl.DateTimeFormat(locale, {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(due)}
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
                          className="border-tui-ink/16 bg-tui-bg text-tui-ink placeholder:text-tui-ink3 focus:border-tui-accent/60 resize-none rounded-md border px-3.5 py-2.5 text-[13px] leading-[1.5] transition-colors outline-none"
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
                            className="bg-tui-accent text-tui-on-accent rounded-full px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                          >
                            {t("saveNote")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setNoteFor(null)}
                            className="border-tui-ink/16 text-tui-ink2 hover:text-tui-ink rounded-full border px-4 py-2 text-[13px] font-medium transition-colors"
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
                        className="text-tui-ink2 hover:text-tui-ink mt-1 flex items-start gap-2 text-left text-[13px] transition-colors disabled:pointer-events-none"
                      >
                        <StickyNote
                          size={13}
                          className="text-tui-accent mt-[3px] flex-none"
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
                      className="text-tui-ink3 hover:bg-tui-ink/[0.06] hover:text-tui-ink flex h-8 w-8 items-center justify-center rounded-full transition-colors"
                    >
                      <Pencil size={15} strokeWidth={1.6} aria-hidden />
                    </button>
                    {canRemoveTasks && (
                      <button
                        type="button"
                        onClick={() =>
                          confirmDiscard === task.id
                            ? removeTask(task.id)
                            : setConfirmDiscard(task.id)
                        }
                        onBlur={() =>
                          setConfirmDiscard((id) =>
                            id === task.id ? null : id,
                          )
                        }
                        disabled={removing}
                        aria-label={t("discard")}
                        title={
                          confirmDiscard === task.id
                            ? t("discardConfirm")
                            : t("discard")
                        }
                        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                          confirmDiscard === task.id
                            ? "bg-tui-danger/10 text-tui-danger"
                            : "text-tui-ink3 hover:bg-tui-ink/[0.06] hover:text-tui-danger"
                        }`}
                      >
                        <Trash2 size={15} strokeWidth={1.6} aria-hidden />
                      </button>
                    )}
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

  const projectQuery = api.project.getById.useQuery(
    { id: projectId },
    { staleTime: 1000 * 30 },
  );

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

  const updatePermission = api.project.updateCollaboratorPermission.useMutation(
    {
      onSuccess: () => void refresh(),
      onError: (error) => toast.error(error.message),
    },
  );

  const project = projectQuery.data;
  const isOwner = project?.createdById === userId;
  const collaborators = project?.collaborators ?? [];

  return (
    <div className="flex flex-col gap-6">
      <section className={CARD}>
        <div className="border-tui-ink/8 flex items-baseline gap-3 border-b px-7 pt-5 pb-4">
          <h2 className="font-display m-0 text-[22px] leading-none">
            {t("label")}
          </h2>
          <span className="text-tui-ink3 text-[12.5px]">
            {collaborators.length + (project?.createdBy ? 1 : 0)}
          </span>
        </div>

        {project?.createdBy && (
          <div className="border-tui-ink/8 flex items-center gap-3 border-b px-7 py-3.5">
            <Member
              name={project.createdBy.name ?? project.createdBy.email ?? ""}
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
            className="border-tui-ink/8 flex flex-wrap items-center gap-3 border-b px-7 py-3.5 last:border-b-0"
          >
            <Member
              name={row.collaborator?.name ?? row.collaborator?.email ?? ""}
              email={row.collaborator?.email ?? ""}
              userId={row.collaboratorId}
            />
            <span className="hidden flex-1 sm:block" />

            {isOwner ? (
              <>
                <div className="border-tui-ink/12 flex gap-1 rounded-full border p-1">
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
                      className={`h-7 rounded-full px-3 text-[12px] font-medium transition-colors ${
                        row.permission === key
                          ? "bg-tui-accent/[0.16] text-tui-ink"
                          : "text-tui-ink3 hover:text-tui-ink2"
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
                  className="text-tui-ink3 hover:bg-tui-ink/[0.06] hover:text-tui-danger flex h-8 w-8 items-center justify-center rounded-full transition-colors"
                >
                  <X size={15} aria-hidden />
                </button>
              </>
            ) : (
              <span className={STAMP}>{t(row.permission)}</span>
            )}
          </div>
        ))}

        {collaborators.length === 0 && !project?.createdBy && (
          <p className="text-tui-ink2 px-7 py-4 text-[14px]">{t("empty")}</p>
        )}
      </section>

      {isOwner && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!email.trim()) return;
            addCollaborator.mutate({
              projectId,
              email: email.trim(),
              permission,
            });
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("invitePlaceholder")}
            className="border-tui-ink/12 bg-tui-pane text-tui-ink placeholder:text-tui-ink3 focus:border-tui-accent/60 h-10 min-w-0 flex-1 rounded-full border px-4 text-sm shadow-[var(--tui-pane-shadow)] transition-colors outline-none sm:max-w-[280px]"
          />
          <div className="border-tui-ink/12 bg-tui-pane flex gap-1 rounded-full border p-1 shadow-[var(--tui-pane-shadow)]">
            {(["read", "write"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPermission(key)}
                aria-pressed={permission === key}
                className={`h-8 rounded-full px-3 text-[12px] font-medium transition-colors ${
                  permission === key
                    ? "bg-tui-accent/[0.16] text-tui-ink"
                    : "text-tui-ink3 hover:text-tui-ink2"
                }`}
              >
                {t(key)}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={addCollaborator.isPending || email.trim().length === 0}
            className="border-tui-ink/16 text-tui-ink2 hover:border-tui-accent/40 hover:text-tui-ink flex h-10 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-colors disabled:opacity-50"
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
  email,
  userId,
}: {
  name: string;
  email: string;
  userId?: string | null;
}) {
  const body = (
    <span className="flex min-w-0 items-center gap-2.5">
      <Initial label={name || email || "?"} size={30} />
      <span className="min-w-0">
        <span className="font-display text-tui-ink block truncate text-[17px]">
          {name || email}
        </span>
        {email && name !== email && (
          <span className="text-tui-ink3 block truncate text-[12px]">
            {email}
          </span>
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
