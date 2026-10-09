"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FileText, Sparkles } from "~/components/ui/icons";
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
  parentTaskId: number | null;
};

/** A top-level task a new or edited task can be filed under. */
export type ParentOption = { id: number; title: string };

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];
const STATUSES: TaskStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
];

/**
 * Priority is the one place the task drawer carries colour. The dot is the
 * whole signal — a filled pill per priority put four competing fills next to
 * the accent submit button.
 */
export const PRIORITY_DOT: Record<TaskPriority, string> = {
  low: "bg-tui-ink3",
  medium: "bg-tui-ok",
  high: "bg-tui-warn",
  urgent: "bg-tui-danger",
};

/** Side padding shared by the header, body and footer, so their edges line up. */
const PAD = "px-6 sm:px-8";

/** The small spaced capitals the dashboard labels with. */
const EYEBROW =
  "text-tui-ink3 text-[10.5px] font-medium tracking-[0.18em] uppercase";

/** A bordered text control, as `NewProjectDrawer` draws its description. */
const FIELD =
  "border-tui-ink/10 text-tui-ink placeholder:text-tui-ink3 focus:border-tui-ink/30 w-full rounded-[10px] border bg-transparent px-3.5 text-[14px] transition-colors outline-none";

/** A quiet bordered button, for the secondary actions in the body. */
const GHOST_BUTTON =
  "border-tui-ink/10 text-tui-ink2 hover:border-tui-ink/25 hover:text-tui-ink flex h-10 items-center justify-center gap-2 rounded-[10px] border text-[13.5px] font-medium transition-colors disabled:opacity-50 disabled:hover:border-tui-ink/10";

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

/** A segmented control, in the shape of the project drawer's permission toggle. */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  render,
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (key: T) => void;
  render: (key: T) => React.ReactNode;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      // Four across leaves too little label on a 320px phone; two rows of two
      // until there is room.
      className="bg-tui-ink/[0.045] grid grid-cols-2 gap-0.5 rounded-[10px] p-0.5 sm:grid-cols-4"
    >
      {options.map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={`flex h-8 items-center justify-center gap-1.5 rounded-[8px] px-2 text-[12.5px] font-medium whitespace-nowrap transition-colors ${
              active
                ? "bg-tui-pane text-tui-ink shadow-[var(--tui-pane-shadow)]"
                : "text-tui-ink3 hover:text-tui-ink2"
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
 *
 * A subtask is an ordinary task with a parent, so it gets this same drawer;
 * "Subtask of" is the only field that differs. Nesting is one level deep, so
 * the parent list holds top-level tasks only, and the field is hidden for a
 * task that already has subtasks of its own.
 */
export function TaskDrawer({
  projectId,
  members,
  task,
  parents = [],
  defaultParentId = null,
  canNest = true,
  open,
  onClose,
}: {
  projectId: number;
  members: TaskMember[];
  /** Present for an edit, absent for a create. */
  task?: EditableTask | null;
  /** Top-level tasks this one may be filed under, itself excluded. */
  parents?: ParentOption[];
  /** For a create: start as a subtask of this task. */
  defaultParentId?: number | null;
  /** False for a task that has subtasks — it cannot become one. */
  canNest?: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("projects.taskDrawer");
  const tp = useTranslations("projects.drawer");
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
  const [parentId, setParentId] = useState("");
  const [drafts, setDrafts] = useState<
    {
      title: string;
      description?: string;
      priority: TaskPriority;
      estimatedDueDays?: number;
    }[]
  >([]);

  const titleRef = useRef<HTMLTextAreaElement>(null);
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
    const parent = task ? task.parentTaskId : defaultParentId;
    setParentId(parent ? String(parent) : "");
  }, [open, task, defaultParentId]);

  const close = useCallback(() => onClose(), [onClose]);

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

  const pending =
    createTask.isPending || updateTask.isPending || updateStatus.isPending;
  const canSubmit = title.trim().length > 0 && !pending;
  const parentTaskId = parentId ? Number(parentId) : null;

  const submit = async () => {
    if (!canSubmit) return;
    const due = dueDate ? new Date(dueDate) : undefined;

    /* The drawer leaves on the click, not on the round trip. Waiting for the
       save and the list refresh held it on "Saving…" for a second or more
       against the hosted database before it slid away. The form's values are
       already captured above, and a failure still surfaces as a toast — each
       mutation's `onError` raises it. */
    close();

    try {
      await persist(due);
    } catch {
      return;
    }
    await invalidate();
  };

  const persist = async (due: Date | undefined) => {
    if (task) {
      await updateTask.mutateAsync({
        taskId: task.id,
        title: title.trim(),
        description: description.trim(),
        assignedToId: assignedToId || null,
        priority,
        dueDate: due ?? null,
        parentTaskId,
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
        parentTaskId: parentTaskId ?? undefined,
      });
      toast.success(t("created", { title: title.trim() }));
    }
  };

  /* Read through a ref so the keyboard effect keeps stable deps — depending on
     `submit` would re-run it (and re-focus the title) on every keystroke. */
  const submitRef = useRef(submit);
  submitRef.current = submit;

  // Escape closes; ⌘/Ctrl+Enter submits from anywhere in the form.
  useEffect(() => {
    // Ignored once the drawer is already leaving: a second Escape would ask a
    // closing drawer to close again.
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
        void submitRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    titleRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  /** Create every drafted task at once; the form itself stays untouched. */
  const acceptAllDrafts = async () => {
    // Leaves on the click, like `submit`.
    close();
    try {
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
          parentTaskId: parentTaskId ?? undefined,
        });
      }
      toast.success(t("ai.addedAll", { count: drafts.length }));
      setDrafts([]);
    } catch {
      // Already toasted by `onError`; the ones created before it still show.
    }
    await invalidate();
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
          className={`absolute inset-0 bg-black/55 backdrop-blur-[6px] ${
            closing ? "projects-drawer-scrim-out" : "projects-drawer-scrim"
          }`}
        />

        <aside
          className={`border-tui-ink/10 bg-tui-pane text-tui-ink relative m-2 flex h-[calc(100%-1rem)] w-full max-w-[520px] flex-col overflow-hidden rounded-[16px] border shadow-[var(--tui-pane-shadow)] sm:m-3 sm:h-[calc(100%-1.5rem)] ${
            closing ? "projects-drawer-out" : "projects-drawer"
          }`}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            {/* Header: what this is, and the title — the one field that matters. */}
            <div className={`flex flex-col pt-6 pb-6 ${PAD}`}>
              <div className="flex items-center justify-between">
                <span id={titleId} className={EYEBROW}>
                  {editing
                    ? t("editTitle")
                    : parentTaskId
                      ? t("subtaskTitle")
                      : t("title")}
                </span>
                <button
                  type="button"
                  onClick={close}
                  aria-label={t("close")}
                  className="text-tui-ink3 hover:bg-tui-ink/[0.055] hover:text-tui-ink -mr-2 flex h-8 w-8 items-center justify-center rounded-full text-[18px] leading-none transition-colors"
                >
                  ×
                </button>
              </div>

              <textarea
                ref={titleRef}
                value={title}
                onChange={(event) =>
                  setTitle(event.target.value.replace(/\n/g, ""))
                }
                rows={1}
                maxLength={256}
                placeholder={t("namePlaceholder")}
                aria-label={t("name")}
                className="font-display text-tui-ink placeholder:text-tui-ink3/70 mt-5 [field-sizing:content] resize-none overflow-hidden bg-transparent text-[32px] leading-[1.1] tracking-[-0.02em] outline-none sm:text-[38px]"
              />
            </div>

            <div className="bg-tui-ink/8 mx-6 h-px sm:mx-8" />

            {/* Body */}
            <div
              className={`scrollbar-hide kairos-scroll-area flex min-h-0 flex-1 flex-col overflow-y-auto ${PAD}`}
            >
              <Field label={t("description")} optional={t("optional")}>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t("descriptionPlaceholder")}
                  className={`resize-none py-2.5 leading-[1.6] ${FIELD}`}
                />
              </Field>

              <Field label={t("priority")}>
                <Segmented
                  label={t("priority")}
                  options={PRIORITIES}
                  value={priority}
                  onChange={setPriority}
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
              </Field>

              <Field label={t("status")}>
                <Segmented
                  label={t("status")}
                  options={STATUSES}
                  value={status}
                  onChange={setStatus}
                  render={(key) => <>{t(`statuses.${key}`)}</>}
                />
              </Field>

              {canNest && parents.length > 0 && (
                <Field label={t("parent")}>
                  <select
                    value={parentId}
                    onChange={(event) => setParentId(event.target.value)}
                    className={`bg-tui-pane h-10 ${FIELD}`}
                  >
                    <option value="">{t("noParent")}</option>
                    {parents.map((parent) => (
                      <option key={parent.id} value={parent.id}>
                        {parent.title}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                <Field label={t("assignee")}>
                  <select
                    value={assignedToId}
                    onChange={(event) => setAssignedToId(event.target.value)}
                    className={`bg-tui-pane h-10 ${FIELD}`}
                  >
                    <option value="">{t("unassigned")}</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name ?? member.email ?? member.id}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={t("dueDate")} optional={t("optional")}>
                  <input
                    type="datetime-local"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                    className={`h-10 ${FIELD}`}
                  />
                </Field>
              </div>

              {!editing && (
                <Field label={t("ai.label")}>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={drafting}
                      onClick={() =>
                        generateDrafts.mutate({
                          projectId,
                          message:
                            description.trim() || title.trim() || undefined,
                        })
                      }
                      className={GHOST_BUTTON}
                    >
                      <Sparkles size={15} aria-hidden />
                      {generateDrafts.isPending
                        ? t("ai.working")
                        : t("ai.suggest")}
                    </button>

                    <button
                      type="button"
                      disabled={drafting}
                      onClick={() => pdfRef.current?.click()}
                      className={GHOST_BUTTON}
                    >
                      <FileText size={15} aria-hidden />
                      {extractFromPdf.isPending
                        ? t("ai.pdfReading")
                        : t("ai.fromPdf")}
                    </button>
                  </div>

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
                    <div className="border-tui-ink/10 flex flex-col overflow-hidden rounded-[10px] border">
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
                                  new Date(
                                    Date.now() +
                                      draft.estimatedDueDays * 86_400_000,
                                  ),
                                ),
                              );
                            }
                          }}
                          className="border-tui-ink/8 hover:bg-tui-ink/[0.025] flex items-start gap-3 border-t px-3.5 py-3 text-left transition-colors first:border-t-0"
                        >
                          <span
                            aria-hidden
                            className={`mt-[7px] h-[7px] w-[7px] flex-none rounded-full ${PRIORITY_DOT[draft.priority]}`}
                          />
                          <span className="flex min-w-0 flex-col">
                            <span className="text-tui-ink text-[14px] font-medium">
                              {draft.title}
                            </span>
                            {draft.description && (
                              <span className="text-tui-ink3 mt-0.5 text-[12.5px] leading-[1.5]">
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
                        className="border-tui-ink/8 bg-tui-ink/[0.045] text-tui-ink hover:bg-tui-ink/[0.07] h-10 border-t text-[13px] font-medium transition-colors disabled:opacity-50"
                      >
                        {t("ai.addAll", { count: drafts.length })}
                      </button>
                    </div>
                  )}
                </Field>
              )}
              {editing && task && <TaskHistory taskId={task.id} />}
              <span className="h-6 flex-none" />
            </div>

            {/* Footer */}
            <div
              className={`border-tui-ink/8 flex items-center gap-2 border-t pt-4 pb-[calc(1rem+var(--kairos-safe-bottom))] ${PAD}`}
            >
              {!editing && (
                <span className="text-tui-ink3 hidden items-center gap-2 text-[12px] sm:flex">
                  <kbd className="border-tui-ink/12 rounded-[4px] border px-1.5 font-mono text-[10.5px] leading-4">
                    ⌘ ↵
                  </kbd>
                  {tp("toCreate")}
                </span>
              )}
              <span className="flex-1" />
              <button
                type="button"
                onClick={close}
                className="text-tui-ink2 hover:text-tui-ink h-9 rounded-full px-3.5 text-[13.5px] transition-colors"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="bg-tui-accent text-tui-on-accent disabled:bg-tui-ink/[0.07] disabled:text-tui-ink3 flex h-9 items-center gap-2 rounded-full px-4 text-[13.5px] font-medium transition-colors hover:opacity-90 disabled:hover:opacity-100"
              >
                {pending ? t("saving") : editing ? t("save") : t("submit")}
                <span aria-hidden>→</span>
              </button>
            </div>
          </form>
        </aside>
      </div>
    </Overlay>
  );
}

/** One form field: a spaced-capitals label, the control, an optional note. */
function Field({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 pt-6">
      <span className={EYEBROW}>
        {label}
        {optional && (
          <span className="text-tui-ink3/80 ml-2 tracking-[0.02em] normal-case">
            {optional}
          </span>
        )}
      </span>
      {children}
    </div>
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
    <Field label={td("history.label")}>
      <ul className="border-tui-ink/10 m-0 flex list-none flex-col overflow-hidden rounded-[10px] border p-0">
        {events.map((event) => (
          <li
            key={event.key}
            className="border-tui-ink/8 flex items-start gap-3 border-t px-3.5 py-2.5 first:border-t-0"
          >
            <span className="min-w-0 flex-1">
              <span className="text-tui-ink2 block text-[13px] leading-[1.45]">
                <span className="text-tui-ink font-medium">{event.actor}</span>{" "}
                {t(`timeline.verbs.${event.verb}`)}
              </span>
              {event.detail && (
                <span className="text-tui-ink3 mt-0.5 block truncate text-[12px]">
                  {event.detail}
                </span>
              )}
            </span>
            <time
              dateTime={event.at.toISOString()}
              className="text-tui-ink3 flex-none text-[11px]"
            >
              {formatDate(event.at, "short")}
            </time>
          </li>
        ))}
      </ul>
    </Field>
  );
}
