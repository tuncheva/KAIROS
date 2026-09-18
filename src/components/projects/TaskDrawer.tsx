"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FileText, Sparkles, X } from "~/components/ui/icons";
import { useTranslations } from "next-intl";

import { MAX_PDF_SIZE, MAX_PDF_SIZE_MB } from "~/lib/pdf";
import { useDateFormat } from "~/hooks/useDateFormat";
import { toTimelineEvent, type ActivityRow } from "./projectsData";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { Overlay } from "~/components/ui/Overlay";
import { exitDurationMs } from "~/components/ui/drawerExit";

export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";

export type TaskMember = {
  id: string;
  name: string | null;
  email?: string | null;
  image: string | null;
};

/** The subset of a task this drawer can edit. */
export type EditableTask = {
  id: number;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: Date | string | null;
  assignedTo: { id: string } | null;
};

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];
const STATUSES: TaskStatus[] = ["pending", "in_progress", "completed", "blocked"];

/**
 * Priority is the one place the task drawer carries colour. The dot is the
 * whole signal — a filled pill per priority put four competing fills next to
 * the accent submit button.
 */
export const PRIORITY_DOT: Record<TaskPriority, string> = {
  low: "bg-fg-quaternary",
  medium: "bg-success",
  high: "bg-warning",
  urgent: "bg-error",
};

const FIELD =
  "rounded-sm border border-border-light/60 bg-bg-tertiary px-3.5 text-fg-primary outline-none transition-colors duration-300 placeholder:text-fg-quaternary focus:border-accent-primary/60";

const STAMP = "kairos-stamp text-[10px] tracking-[0.14em] text-fg-tertiary";

/** `datetime-local` wants a local `YYYY-MM-DDTHH:mm`, not an ISO string. */
function toLocalInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function Pills<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
  render,
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (key: T) => void;
  className: string;
  render: (key: T) => React.ReactNode;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={className}>
      {options.map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={`flex items-center justify-center gap-1.5 rounded-sm border px-2.5 py-[11px] text-[13px] font-medium transition-colors duration-300 ${
              active
                ? "border-accent-primary/55 bg-accent-primary/[0.14] text-fg-primary"
                : "border-border-light/60 bg-transparent text-fg-tertiary hover:border-border-strong/60 hover:text-fg-secondary"
            }`}
          >
            {render(option)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Create or edit one task, in the same drawer language as `NewProjectDrawer`.
 *
 * Creating and editing share a drawer because they are the same six fields;
 * the only difference is which mutation the submit button runs and whether
 * status is settable up front (a new task starts wherever you say, an existing
 * one moves through the list itself).
 *
 * The AI drafting pass lives here rather than in its own panel: it fills this
 * form, so splitting it out meant a second surface whose only output was this
 * one's inputs.
 */
export function TaskDrawer({
  projectId,
  members,
  task,
  open,
  onClose,
}: {
  projectId: number;
  members: TaskMember[];
  /** Present for an edit, absent for a create. */
  task?: EditableTask | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("projects.taskDrawer");
  const toast = useToast();
  const utils = api.useUtils();
  const titleId = useId();
  const editing = Boolean(task);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>("pending");
  const [dueDate, setDueDate] = useState("");
  const [drafts, setDrafts] = useState<
    { title: string; description?: string; priority: TaskPriority; estimatedDueDays?: number }[]
  >([]);

  const titleRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Whether the drawer is on screen, which is not the same as `open`.
   *
   * The parent flips `open` to false on the click; the panel still has its
   * 0.45s exit to play, so mounting is latched here and only released when that
   * is over. Before this the drawer slid in and then vanished on the next frame,
   * which reads as a crash rather than a dismissal.
   */
  const [mounted, setMounted] = useState(open);
  const closing = mounted && !open;

  useEffect(() => {
    if (exitTimer.current) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }

    if (open) {
      // Reopening mid-exit cancels it, rather than letting the old timer
      // unmount the drawer that was just reopened.
      setMounted(true);
      return;
    }

    if (!mounted) return;

    // A timer, not an `animationend` listener: under `prefers-reduced-motion`
    // the exit rules resolve to `animation: none`, so no such event fires and a
    // listener-based unmount would strand the drawer on screen.
    exitTimer.current = setTimeout(() => setMounted(false), exitDurationMs());
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
    // `mounted` is read but must not re-trigger this: it is set *by* this
    // effect, and depending on it would restart the exit timer mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Each opening starts from the task it was opened for, so a create after an
  // edit does not inherit the edited task's fields.
  useEffect(() => {
    if (!open) return;
    setDrafts([]);
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setAssignedToId(task?.assignedTo?.id ?? "");
    setPriority(task?.priority ?? "medium");
    setStatus(task?.status ?? "pending");
    setDueDate(toLocalInput(task?.dueDate ?? null));
  }, [open, task]);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    // Ignored once the drawer is already leaving: a second Escape would ask a
    // closing drawer to close again.
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    titleRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const invalidate = useCallback(async () => {
    await Promise.all([
      utils.project.getById.invalidate({ id: projectId }),
      utils.project.getMyProjects.invalidate(),
      utils.task.getByProject.invalidate({ projectId }),
      utils.task.getProjectActivity.invalidate({ projectId, limit: 100 }),
    ]);
  }, [utils, projectId]);

  const createTask = api.task.create.useMutation({
    onError: (error) => toast.error(error.message),
  });

  const updateTask = api.task.update.useMutation({
    onError: (error) => toast.error(error.message),
  });

  const updateStatus = api.task.updateStatus.useMutation({
    onError: (error) => toast.error(error.message),
  });

  const generateDrafts = api.agent.generateTaskDrafts.useMutation({
    onSuccess: (data) => {
      setDrafts(data.tasks as typeof drafts);
      if (data.tasks.length === 0) toast.info(t("ai.none"));
    },
    onError: (error) => toast.error(error.message),
  });

  /*
   * A PDF is a second source for the same drafts, not a second feature.
   *
   * `extractTasksFromPdf` returns the very shape `generateTaskDrafts` does, so
   * it lands in the same `drafts` state and is reviewed, edited and accepted
   * through the list below — there is no second confirm path to keep in step.
   */
  const extractFromPdf = api.agent.extractTasksFromPdf.useMutation({
    onSuccess: (data) => {
      setDrafts(data.tasks as typeof drafts);
      if (data.tasks.length === 0) toast.info(t("ai.none"));
    },
    onError: (error) => toast.error(error.message),
  });

  const drafting = generateDrafts.isPending || extractFromPdf.isPending;

  /**
   * Hand one chosen PDF to the extractor.
   *
   * Size is checked here as well as on the server: the ceiling is 10 MB and
   * base64 inflates a file by a third, so an oversized pick would otherwise
   * spend a 13 MB upload to be told no. Both ends read the same constant.
   */
  const readPdf = async (file: File) => {
    if (file.size > MAX_PDF_SIZE) {
      toast.error(t("ai.pdfTooLarge", { limit: MAX_PDF_SIZE_MB }));
      return;
    }

    const base64 = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      // `readAsDataURL` yields "data:application/pdf;base64,<payload>" and the
      // procedure wants the payload alone.
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        resolve(result.split(",")[1] ?? null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });

    if (!base64) {
      toast.error(t("ai.pdfUnreadable"));
      return;
    }

    extractFromPdf.mutate({
      projectId,
      pdfBase64: base64,
      fileName: file.name,
      message: description.trim() || title.trim() || undefined,
    });
  };

  const pending = createTask.isPending || updateTask.isPending || updateStatus.isPending;
  const canSubmit = title.trim().length > 0 && !pending;

  const submit = async () => {
    if (!canSubmit) return;
    const due = dueDate ? new Date(dueDate) : undefined;

    if (task) {
      await updateTask.mutateAsync({
        taskId: task.id,
        title: title.trim(),
        description: description.trim(),
        assignedToId: assignedToId || null,
        priority,
        dueDate: due ?? null,
      });
      if (status !== task.status) {
        await updateStatus.mutateAsync({ taskId: task.id, status });
      }
      toast.success(t("saved"));
    } else {
      await createTask.mutateAsync({
        projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        assignedToId: assignedToId || undefined,
        priority,
        status,
        dueDate: due,
      });
      toast.success(t("created", { title: title.trim() }));
    }

    await invalidate();
    close();
  };

  /** Create every drafted task at once; the form itself stays untouched. */
  const acceptAllDrafts = async () => {
    for (const draft of drafts) {
      await createTask.mutateAsync({
        projectId,
        title: draft.title,
        description: draft.description ?? undefined,
        priority: draft.priority,
        status: "pending",
        dueDate: draft.estimatedDueDays
          ? new Date(Date.now() + draft.estimatedDueDays * 86_400_000)
          : undefined,
      });
    }
    toast.success(t("ai.addedAll", { count: drafts.length }));
    setDrafts([]);
    await invalidate();
    close();
  };

  if (!mounted) return null;

  return (
    <Overlay>
      <div
        className={`fixed inset-0 z-[60] flex justify-end ${closing ? "pointer-events-none" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button
          type="button"
          aria-label={t("close")}
          onClick={close}
          disabled={closing}
          className={`absolute inset-0 bg-black/60 backdrop-blur-[2px] ${
            closing ? "projects-drawer-scrim-out" : "projects-drawer-scrim"
          }`}
        />

        <aside
          className={`relative flex h-full w-full max-w-[440px] flex-col border-l border-border-light/60 bg-bg-secondary shadow-[-28px_0_60px_rgba(0,0,0,0.5)] ${
            closing ? "projects-drawer-out" : "projects-drawer"
          }`}
        >
          <div className="flex items-center justify-between gap-4 border-b border-border-light/50 px-[26px] py-5">
            <h2
              id={titleId}
              className="m-0 text-[17px] font-semibold tracking-[-0.01em] text-fg-primary"
            >
              {editing ? t("editTitle") : t("title")}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label={t("close")}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-sm border border-border-light/70 text-fg-tertiary transition-colors duration-300 hover:bg-bg-tertiary hover:text-fg-primary"
            >
              <X size={15} aria-hidden />
            </button>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex flex-1 flex-col gap-[22px] overflow-auto p-[26px]">
              <label
                className="projects-slide-in flex flex-col gap-2"
                style={{ animationDelay: "0.1s" }}
              >
                <span className={STAMP}>{t("name")}</span>
                <input
                  ref={titleRef}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={256}
                  placeholder={t("namePlaceholder")}
                  className={`h-11 text-[15px] ${FIELD}`}
                />
              </label>

              <label
                className="projects-slide-in flex flex-col gap-2"
                style={{ animationDelay: "0.14s" }}
              >
                <span className={STAMP}>
                  {t("description")} <span className="text-fg-quaternary">{t("optional")}</span>
                </span>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t("descriptionPlaceholder")}
                  className={`resize-none py-3 text-sm leading-[1.5] ${FIELD}`}
                />
              </label>

              <div
                className="projects-slide-in flex flex-col gap-2.5"
                style={{ animationDelay: "0.18s" }}
              >
                <span className={STAMP}>{t("priority")}</span>
                <Pills
                  label={t("priority")}
                  options={PRIORITIES}
                  value={priority}
                  onChange={setPriority}
                  className="grid grid-cols-4 gap-2"
                  render={(key) => (
                    <>
                      <span
                        aria-hidden
                        className={`h-[7px] w-[7px] flex-none rounded-full ${PRIORITY_DOT[key]}`}
                      />
                      {t(`priorities.${key}`)}
                    </>
                  )}
                />
              </div>

              <div
                className="projects-slide-in flex flex-col gap-2.5"
                style={{ animationDelay: "0.22s" }}
              >
                <span className={STAMP}>{t("status")}</span>
                <Pills
                  label={t("status")}
                  options={STATUSES}
                  value={status}
                  onChange={setStatus}
                  className="grid grid-cols-2 gap-2"
                  render={(key) => <>{t(`statuses.${key}`)}</>}
                />
              </div>

              <label
                className="projects-slide-in flex flex-col gap-2"
                style={{ animationDelay: "0.26s" }}
              >
                <span className={STAMP}>{t("assignee")}</span>
                <select
                  value={assignedToId}
                  onChange={(event) => setAssignedToId(event.target.value)}
                  className={`h-11 text-[15px] ${FIELD}`}
                >
                  <option value="">{t("unassigned")}</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name ?? member.email ?? member.id}
                    </option>
                  ))}
                </select>
              </label>

              <label
                className="projects-slide-in flex flex-col gap-2"
                style={{ animationDelay: "0.3s" }}
              >
                <span className={STAMP}>
                  {t("dueDate")} <span className="text-fg-quaternary">{t("optional")}</span>
                </span>
                <input
                  type="datetime-local"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className={`h-11 text-[15px] ${FIELD}`}
                />
              </label>

              {!editing && (
                <div
                  className="projects-slide-in flex flex-col gap-2.5 border-t border-border-light/50 pt-5"
                  style={{ animationDelay: "0.34s" }}
                >
                  <span className={STAMP}>{t("ai.label")}</span>
                  <button
                    type="button"
                    disabled={drafting}
                    onClick={() =>
                      generateDrafts.mutate({
                        projectId,
                        message: description.trim() || title.trim() || undefined,
                      })
                    }
                    className="flex h-11 items-center justify-center gap-2 rounded-sm border border-border-light/60 text-sm font-medium text-fg-secondary transition-colors duration-300 hover:border-accent-primary/40 hover:text-fg-primary disabled:opacity-50"
                  >
                    <Sparkles size={15} aria-hidden />
                    {generateDrafts.isPending ? t("ai.working") : t("ai.suggest")}
                  </button>

                  <button
                    type="button"
                    disabled={drafting}
                    onClick={() => pdfRef.current?.click()}
                    className="flex h-11 items-center justify-center gap-2 rounded-sm border border-border-light/60 text-sm font-medium text-fg-secondary transition-colors duration-300 hover:border-accent-primary/40 hover:text-fg-primary disabled:opacity-50"
                  >
                    <FileText size={15} aria-hidden />
                    {extractFromPdf.isPending
                      ? t("ai.pdfReading")
                      : t("ai.fromPdf")}
                  </button>

                  <input
                    ref={pdfRef}
                    type="file"
                    accept="application/pdf"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void readPdf(file);
                      // Cleared so picking the same file twice still fires.
                      event.target.value = "";
                    }}
                  />

                  {drafts.length > 0 && (
                    <div className="flex flex-col">
                      {drafts.map((draft, index) => (
                        <button
                          key={`${draft.title}-${index}`}
                          type="button"
                          onClick={() => {
                            setTitle(draft.title);
                            setDescription(draft.description ?? "");
                            setPriority(draft.priority);
                            if (draft.estimatedDueDays) {
                              setDueDate(
                                toLocalInput(
                                  new Date(Date.now() + draft.estimatedDueDays * 86_400_000),
                                ),
                              );
                            }
                          }}
                          className="flex items-start gap-2.5 border-b border-border-light/50 px-1 py-3 text-left transition-colors duration-300 hover:bg-accent-primary/[0.07]"
                        >
                          <span
                            aria-hidden
                            className={`mt-[7px] h-[7px] w-[7px] flex-none rounded-full ${PRIORITY_DOT[draft.priority]}`}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-fg-primary">
                              {draft.title}
                            </span>
                            {draft.description && (
                              <span className="mt-1 block text-[13px] leading-[1.45] text-fg-tertiary">
                                {draft.description}
                              </span>
                            )}
                          </span>
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => void acceptAllDrafts()}
                        className="mt-3 flex h-10 items-center justify-center rounded-sm border border-accent-primary/55 bg-accent-primary/[0.14] text-[13px] font-semibold text-fg-primary transition-colors duration-300 hover:bg-accent-primary/25 disabled:opacity-50"
                      >
                        {t("ai.addAll", { count: drafts.length })}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {editing && task && <TaskHistory taskId={task.id} />}
            </div>

            <div className="flex gap-2.5 border-t border-border-light/50 bg-bg-primary px-[26px] py-5">
              <button
                type="button"
                onClick={close}
                className="rounded-sm border border-border-light/70 px-[18px] py-3 text-sm font-medium text-fg-secondary transition-colors duration-300 hover:bg-bg-tertiary hover:text-fg-primary"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex-1 rounded-sm bg-accent-primary px-[18px] py-3 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-px hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50"
              >
                {pending ? t("saving") : editing ? t("save") : t("submit")}
              </button>
            </div>
          </form>
        </aside>
      </div>
    </Overlay>
  );
}

/**
 * One task's own history.
 *
 * `task.getActivityLog` existed with no caller — the project timeline was the
 * only place activity surfaced, which meant answering "who moved this task, and
 * when" required scanning every other task's events alongside it.
 *
 * Rows go through the same `toTimelineEvent` the project timeline uses, so a
 * task cannot describe an event here differently from the way the workspace
 * describes the very same row.
 */
function TaskHistory({ taskId }: { taskId: number }) {
  const t = useTranslations("projects");
  const td = useTranslations("projects.taskDrawer");
  const { formatDate } = useDateFormat();

  const activity = api.task.getActivityLog.useQuery(
    { taskId },
    { staleTime: 1000 * 30 },
  );

  const someone = t("timeline.someone");
  const events = (activity.data ?? [])
    .map((row) => toTimelineEvent(row as ActivityRow, someone))
    .filter((event) => event !== null);

  // A task always has at least its own creation logged, so an empty list means
  // the query has not answered yet rather than that nothing ever happened.
  if (activity.isLoading || events.length === 0) return null;

  return (
    <div
      className="projects-slide-in flex flex-col gap-2.5 border-t border-border-light/50 pt-5"
      style={{ animationDelay: "0.34s" }}
    >
      <span className={STAMP}>{td("history.label")}</span>

      <ul className="m-0 flex list-none flex-col p-0">
        {events.map((event) => (
          <li
            key={event.key}
            className="flex items-start gap-2.5 border-b border-border-light/50 py-2.5 last:border-b-0"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] leading-[1.45] text-fg-secondary">
                <span className="font-medium text-fg-primary">
                  {event.actor}
                </span>{" "}
                {t(`timeline.verbs.${event.verb}`)}
              </span>
              {event.detail && (
                <span className="mt-0.5 block truncate text-[12px] text-fg-quaternary">
                  {event.detail}
                </span>
              )}
            </span>
            <time
              dateTime={event.at.toISOString()}
              className="flex-none text-[11px] text-fg-quaternary"
            >
              {formatDate(event.at, "short")}
            </time>
          </li>
        ))}
      </ul>
    </div>
  );
}
