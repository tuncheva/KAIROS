"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "~/components/ui/icons";
import { api } from "~/trpc/react";
import { cn } from "~/lib/utils";
import { useToast } from "~/components/providers/ToastProvider";
import { Overlay } from "~/components/ui/Overlay";
import { useLocale, useTranslations } from "next-intl";
import {
  ITEM_KINDS,
  KIND_LABEL_KEYS,
  KIND_CHIP_TONE,
  PRIORITY_LABEL_KEYS,
  STATUS_LABEL_KEYS,
  TASK_PRIORITIES,
  priorityTone,
  toHm,
  toYmd,
  toneFor,
  type CalendarItem,
  type CalendarKind,
} from "./calendarModel";

/* Events are region-scoped in the schema, so the form has to ask.
   Labels mirror `CreateEventForm`, which is the existing convention. */
const REGIONS = [
  { value: "sofia", label: "Sofia" },
  { value: "plovdiv", label: "Plovdiv" },
  { value: "varna", label: "Varna" },
  { value: "burgas", label: "Burgas" },
  { value: "ruse", label: "Ruse" },
  { value: "stara_zagora", label: "Stara Zagora" },
  { value: "pleven", label: "Pleven" },
  { value: "sliven", label: "Sliven" },
  { value: "dobrich", label: "Dobrich" },
  { value: "shumen", label: "Shumen" },
] as const;

type Region = (typeof REGIONS)[number]["value"];

const FIELD =
  "h-[42px] rounded-lg border border-border-medium bg-bg-surface px-3 text-sm text-fg-primary outline-none transition-colors focus:border-accent-primary/60 focus:ring-2 focus:ring-accent-primary/20";
const MICRO_LABEL =
  "text-[10px] uppercase tracking-[0.14em] text-fg-tertiary";

export type DrawerState =
  | { mode: "detail"; item: CalendarItem }
  | { mode: "new"; date: Date };

type Props = {
  state: DrawerState;
  onClose: () => void;
  onCreated: () => void;
};

export function CalendarDrawer({ state, onClose, onCreated }: Props) {
  // Escape closes the panel, matching the app's other drawers.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const t = useTranslations("calendar.filters");

  return (
    <Overlay>
      {/* Portalled and `fixed`: the app shell wears `.kairos-page-enter`, whose
          lingering transform/filter would otherwise make it the containing
          block for this panel and trap it under the Ask-Kairos launcher. */}
      <div className="fixed inset-0 z-[60] flex justify-end">
        <button
          type="button"
          aria-label={t("close")}
          onClick={onClose}
          className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[2px] calendar-scrim"
        />
        <aside
          role="dialog"
          aria-modal="true"
          className="relative flex h-full w-full max-w-[420px] flex-col border-l border-border-light bg-bg-elevated shadow-2xl calendar-drawer"
        >
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-light px-6 py-5">
            <span className="text-[17px] font-semibold tracking-tight text-fg-primary">
              {state.mode === "detail" ? t("details") : t("newTitle")}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border-medium text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
            >
              <X size={14} />
            </button>
          </div>

          {state.mode === "detail" ? (
            <DetailPanel item={state.item} />
          ) : (
            <NewItemPanel date={state.date} onCancel={onClose} onCreated={onCreated} />
          )}
        </aside>
      </div>
    </Overlay>
  );
}

/* ------------------------------------------------------------------ */
/*  Detail                                                            */
/* ------------------------------------------------------------------ */

function DetailPanel({ item }: { item: CalendarItem }) {
  const t = useTranslations("calendar.filters");
  const locale = useLocale();
  const dateLocale = locale === "bg" ? "bg-BG" : "en-US";
  const tone = toneFor(item);

  const dateLabel = item.date.toLocaleDateString(dateLocale, {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  type Row = { label: string; value: string; tone?: string; dot?: string };
  const rows: Row[] = [];

  if (item.kind === "task") {
    rows.push({ label: t("projectLabel"), value: item.projectTitle ?? "—" });
    rows.push({
      label: t("statusLabel"),
      value: t(STATUS_LABEL_KEYS[item.status] ?? "statusPending"),
    });
    rows.push({
      label: t("priorityLabel"),
      value: t(PRIORITY_LABEL_KEYS[item.priority] ?? "priorityMedium"),
      tone: tone.text,
      dot: tone.dot,
    });
    rows.push({
      label: t("dueLabel"),
      value: item.allDay ? dateLabel : `${dateLabel}, ${toHm(item.date)}`,
    });
  } else if (item.kind === "event") {
    rows.push({ label: t("dateLabel"), value: dateLabel });
    rows.push({
      label: t("timeLabel"),
      value: item.allDay ? t("allDay") : toHm(item.date),
    });
  } else {
    rows.push({ label: t("dateLabel"), value: dateLabel });
    rows.push({ label: t("typeLabel"), value: t("stickyNote") });
    rows.push({
      label: t("accessLabel"),
      value: item.locked ? t("accessProtected") : t("accessOpen"),
      tone: item.locked ? "text-warning" : undefined,
    });
  }

  const body = item.kind === "event" ? item.description : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-6">
      <div className="flex flex-col gap-2.5 calendar-field">
        <span className={cn("text-[10px] uppercase tracking-[0.16em]", tone.text)}>
          {t(KIND_LABEL_KEYS[item.kind])}
        </span>
        <span className="text-[22px] leading-snug font-semibold tracking-tight text-fg-primary">
          {item.title}
        </span>
      </div>

      <div
        className="flex flex-col overflow-hidden rounded-xl border border-border-light calendar-field"
        style={{ animationDelay: "70ms" }}
      >
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4 border-b border-border-light/70 bg-bg-surface px-4 py-3 last:border-b-0"
          >
            <span className={MICRO_LABEL}>{row.label}</span>
            <span
              className={cn(
                "flex items-center gap-2 text-right text-[13px] font-medium",
                row.tone ?? "text-fg-primary",
              )}
            >
              {row.dot && <span className={cn("h-2 w-2 rounded-full", row.dot)} />}
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {body && (
        <p
          className="text-[13px] leading-relaxed text-fg-secondary calendar-field"
          style={{ animationDelay: "120ms" }}
        >
          {body}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  New item                                                          */
/* ------------------------------------------------------------------ */

function NewItemPanel({
  date,
  onCancel,
  onCreated,
}: {
  date: Date;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations("calendar.filters");
  const toast = useToast();

  const [kind, setKind] = useState<CalendarKind>("event");
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(toYmd(date));
  const [time, setTime] = useState("09:00");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [priority, setPriority] = useState<string>("medium");
  const [region, setRegion] = useState<Region>("sofia");

  // Re-seed the date when the user opens the panel from another day.
  useEffect(() => setDay(toYmd(date)), [date]);

  const projectsQuery = api.project.getMyProjects.useQuery(undefined, {
    enabled: kind === "task",
    staleTime: 60_000,
  });
  const projects = useMemo(
    () =>
      (projectsQuery.data ?? []).map((p: { id: number; title: string }) => ({
        id: p.id,
        title: p.title,
      })),
    [projectsQuery.data],
  );

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(String(projects[0]!.id));
  }, [projectId, projects]);

  const scheduledAt = useMemo(() => {
    const [y, m, d] = day.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    if (!y || !m || !d) return null;
    const out = new Date(y, m - 1, d, hh ?? 0, mm ?? 0, 0, 0);
    return Number.isNaN(out.getTime()) ? null : out;
  }, [day, time]);

  const succeed = (message: string) => {
    toast.success(message);
    onCreated();
  };
  const fail = (error: { message: string }) => toast.error(error.message);

  const createTask = api.task.create.useMutation({
    onSuccess: () => succeed(t("taskCreated")),
    onError: fail,
  });
  const createEvent = api.event.createEvent.useMutation({
    onSuccess: () => succeed(t("eventCreated")),
    onError: fail,
  });
  const createNote = api.note.create.useMutation({
    onSuccess: () => succeed(t("noteCreated")),
    onError: fail,
  });

  const isSaving =
    createTask.isPending || createEvent.isPending || createNote.isPending;

  const submit = () => {
    if (!scheduledAt) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error(t("titleRequired"));
      return;
    }

    if (kind === "task") {
      const id = Number(projectId);
      if (!id) {
        toast.error(t("projectRequired"));
        return;
      }
      createTask.mutate({
        projectId: id,
        title: trimmedTitle,
        description: description.trim() || undefined,
        priority: priority as "low" | "medium" | "high" | "urgent",
        status: "pending",
        dueDate: scheduledAt,
      });
      return;
    }

    if (kind === "event") {
      // The events table requires a description and a region.
      const body = description.trim();
      if (!body) {
        toast.error(t("descriptionRequired"));
        return;
      }
      createEvent.mutate({
        title: trimmedTitle,
        description: body,
        eventDate: scheduledAt,
        region,
        enableRsvp: false,
        sendReminders: false,
      });
      return;
    }

    createNote.mutate({
      title: trimmedTitle,
      // Sticky notes are content-first; fall back to the title when the
      // description is empty so the required `content` is never blank.
      content: description.trim() || trimmedTitle,
      calendarDate: scheduledAt,
    });
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-6">
        <div className="flex gap-2 calendar-field">
          {ITEM_KINDS.map((k) => {
            const active = kind === k;
            const tone = KIND_CHIP_TONE[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={active}
                className={cn(
                  "h-9 flex-1 rounded-lg border text-xs font-semibold transition-colors",
                  active
                    ? cn(tone.bg, tone.border, tone.text)
                    : "border-border-medium text-fg-tertiary hover:bg-bg-secondary",
                )}
              >
                {t(KIND_LABEL_KEYS[k])}
              </button>
            );
          })}
        </div>

        <label className="flex flex-col gap-2 calendar-field" style={{ animationDelay: "60ms" }}>
          <span className={MICRO_LABEL}>{t("titleLabel")}</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              kind === "task"
                ? t("newTaskPlaceholder")
                : kind === "event"
                  ? t("newEventPlaceholder")
                  : t("newNotePlaceholder")
            }
            className={FIELD}
          />
        </label>

        <div className="flex gap-3 calendar-field" style={{ animationDelay: "100ms" }}>
          <label className="flex flex-1 flex-col gap-2">
            <span className={MICRO_LABEL}>{t("dateFieldLabel")}</span>
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className={FIELD}
            />
          </label>
          <label className="flex w-[128px] shrink-0 flex-col gap-2">
            <span className={MICRO_LABEL}>{t("timeFieldLabel")}</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={FIELD}
            />
          </label>
        </div>

        {kind === "task" && (
          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-2">
              <span className={MICRO_LABEL}>{t("projectFieldLabel")}</span>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className={FIELD}
              >
                {projects.length === 0 && <option value="">{t("noProjects")}</option>}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-2.5">
              <span className={MICRO_LABEL}>{t("priority")}</span>
              <div className="flex flex-wrap gap-2">
                {TASK_PRIORITIES.map((p) => {
                  const tone = priorityTone(p);
                  const active = priority === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      aria-pressed={active}
                      className={cn(
                        "flex h-[30px] items-center gap-2 rounded-md border px-3 text-[11px] font-semibold transition-colors",
                        active
                          ? cn(tone.bg, tone.border, tone.text)
                          : "border-border-medium text-fg-tertiary hover:bg-bg-secondary",
                      )}
                    >
                      <span className={cn("h-[7px] w-[7px] rounded-full", tone.dot)} />
                      {t(PRIORITY_LABEL_KEYS[p]!)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {kind === "event" && (
          <label className="flex flex-col gap-2">
            <span className={MICRO_LABEL}>{t("regionFieldLabel")}</span>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as Region)}
              className={FIELD}
            >
              {REGIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-2 calendar-field" style={{ animationDelay: "160ms" }}>
          <span className={MICRO_LABEL}>
            {kind === "event" ? t("descriptionLabel") : t("descriptionOptionalLabel")}
          </span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("descriptionPlaceholder")}
            className="resize-y rounded-lg border border-border-medium bg-bg-surface px-3 py-2.5 text-sm text-fg-primary outline-none transition-colors focus:border-accent-primary/60 focus:ring-2 focus:ring-accent-primary/20"
          />
        </label>
      </div>

      <div className="flex shrink-0 gap-2.5 border-t border-border-light p-5">
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-lg border border-border-medium px-4 text-[13px] font-semibold text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={isSaving}
          className="h-10 flex-1 rounded-lg bg-accent-primary text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {isSaving
            ? t("saving")
            : t("createKind", { kind: t(KIND_LABEL_KEYS[kind]).toLowerCase() })}
        </button>
      </div>
    </>
  );
}
