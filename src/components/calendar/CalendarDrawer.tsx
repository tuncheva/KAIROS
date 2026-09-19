"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ModalDismiss } from "~/components/ui/Modal";
import Link from "next/link";
import {
  Check,
  CalendarClock,
  MoreHorizontal,
  Pencil,
  SquareArrowOutUpRight,
  Trash2,
} from "~/components/ui/icons";
import { api } from "~/trpc/react";
import { cn } from "~/lib/utils";
import { noteHref, projectHref } from "~/lib/routes";
import { useToast } from "~/components/providers/ToastProvider";
import { Overlay } from "~/components/ui/Overlay";
import { useLocale, useTranslations } from "next-intl";
import { useDismissOnOutside, useFocusTrap } from "./useCalendarA11y";
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
const MICRO_LABEL = "text-[11px] uppercase tracking-[0.12em] text-fg-tertiary";
const ACTION =
  "flex h-8 items-center gap-1.5 rounded-lg border border-border-medium px-2.5 text-xs font-semibold text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary disabled:opacity-50";

export type DrawerState =
  | { mode: "detail"; item: CalendarItem }
  | { mode: "new"; date: Date };

type Props = {
  state: DrawerState;
  onClose: () => void;
  /** A row was created — refresh and close. */
  onCreated: () => void;
  /** A row was edited in place — refresh, keep the panel open. */
  onChanged?: () => void;
  /** A row is gone — refresh and close. */
  onDeleted?: () => void;
};

export function CalendarDrawer({ state, onClose, onCreated, onChanged, onDeleted }: Props) {
  const t = useTranslations("calendar.filters");
  const panelRef = useRef<HTMLElement>(null);
  const headingId = useId();

  /* Focus is moved in, held, and given back. `aria-modal="true"` was already
     here, promising assistive technology that the page behind is unreachable —
     but nothing enforced it: Tab walked straight out into the grid, and
     closing dropped focus to <body>, losing the user's place. */
  useFocusTrap(panelRef, true, onClose);

  return (
    <Overlay>
      {/* Portalled and `fixed`: the app shell wears `.kairos-page-enter`, whose
          lingering transform/filter would otherwise make it the containing
          block for this panel and trap it under the Ask-Kairos launcher. */}
      <div className="fixed inset-0 z-[60] flex justify-end">
        {/* An inert div, not a button. As a `<button aria-label="Close">` the
            scrim was the panel's first tab stop and announced a second Close
            control that duplicated the one in the header. */}
        <div
          onClick={onClose}
          aria-hidden="true"
          className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[2px] calendar-scrim"
        />
        <aside
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          className="relative flex h-full w-full max-w-[420px] flex-col border-l border-border-light bg-bg-elevated shadow-2xl calendar-drawer"
        >
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-light px-6 py-5">
            <h2
              id={headingId}
              className="text-[17px] font-semibold tracking-tight text-fg-primary"
            >
              {state.mode === "detail" ? t(KIND_LABEL_KEYS[state.item.kind]) : t("newTitle")}
            </h2>
            <ModalDismiss onDismiss={onClose} label={t("close")} />
          </div>

          {state.mode === "detail" ? (
            <DetailPanel
              item={state.item}
              onChanged={onChanged ?? (() => undefined)}
              onDeleted={onDeleted ?? onClose}
            />
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

type DetailTab = "view" | "reschedule" | "edit";

function DetailPanel({
  item,
  onChanged,
  onDeleted,
}: {
  item: CalendarItem;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("calendar.filters");
  const locale = useLocale();
  const toast = useToast();
  const dateLocale = locale === "bg" ? "bg-BG" : "en-US";
  const tone = toneFor(item);

  const [tab, setTab] = useState<DetailTab>("view");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(menuRef, menuOpen, () => setMenuOpen(false));

  // A different item in the same panel starts from the read-only view again.
  useEffect(() => {
    setTab("view");
    setMenuOpen(false);
    setConfirmDelete(false);
  }, [item.kind, item.id]);

  const dateLabel = item.date.toLocaleDateString(dateLocale, {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  /* ---- mutations ---- */

  const fail = (error: { message: string }) => toast.error(error.message);
  const done = (message: string) => {
    toast.success(message);
    onChanged();
  };

  const taskStatus = api.task.updateStatus.useMutation({
    onSuccess: () => done(t("saved")),
    onError: fail,
  });
  const taskUpdate = api.task.update.useMutation({
    onSuccess: () => {
      done(t("saved"));
      setTab("view");
    },
    onError: fail,
  });
  const taskDelete = api.task.delete.useMutation({
    onSuccess: () => {
      toast.success(t("deleted"));
      onDeleted();
    },
    onError: fail,
  });
  const eventUpdate = api.event.updateEvent.useMutation({
    onSuccess: () => {
      done(t("saved"));
      setTab("view");
    },
    onError: fail,
  });
  const eventDelete = api.event.deleteEvent.useMutation({
    onSuccess: () => {
      toast.success(t("deleted"));
      onDeleted();
    },
    onError: fail,
  });
  const noteDate = api.note.setCalendarDate.useMutation({
    onSuccess: () => {
      done(t("saved"));
      setTab("view");
    },
    onError: fail,
  });
  const noteDelete = api.note.delete.useMutation({
    onSuccess: () => {
      toast.success(t("deleted"));
      onDeleted();
    },
    onError: fail,
  });

  const busy =
    taskStatus.isPending ||
    taskUpdate.isPending ||
    taskDelete.isPending ||
    eventUpdate.isPending ||
    eventDelete.isPending ||
    noteDate.isPending ||
    noteDelete.isPending;

  /* ---- actions ---- */

  const completed = item.kind === "task" && item.status === "completed";

  /* An entry read from a connected calendar. Kairos holds a copy, not the
     original: rescheduling it here would move nothing, and deleting it would
     delete our copy and have the next sync put it straight back. So the whole
     action bar is replaced by a line saying where it lives. */
  const readOnly = item.kind === "external";

  const toggleComplete = () => {
    if (item.kind !== "task") return;
    // The toggle is its own undo: press it again and the task comes back.
    // The toast provider takes a message, not an action, so an "Undo" button
    // in the toast is not something this can honestly offer.
    taskStatus.mutate({
      taskId: item.id,
      status: completed ? "pending" : "completed",
    });
  };

  const reschedule = (at: Date) => {
    if (readOnly) return;
    if (item.kind === "task") taskUpdate.mutate({ taskId: item.id, dueDate: at });
    else if (item.kind === "event") eventUpdate.mutate({ eventId: item.id, eventDate: at });
    else if (item.kind === "note") noteDate.mutate({ id: item.id, calendarDate: at });
  };

  const remove = () => {
    if (readOnly) return;
    if (item.kind === "task") taskDelete.mutate({ taskId: item.id });
    else if (item.kind === "event") eventDelete.mutate({ eventId: item.id });
    else if (item.kind === "note") noteDelete.mutate({ id: item.id });
  };

  const openHref =
    item.kind === "task"
      ? projectHref(item.projectId)
      : item.kind === "note"
        ? noteHref(item.id)
        : null;
  const openLabel = item.kind === "task" ? t("openProject") : t("openNote");

  /* A note's body is the note, and `note.update` requires that body back —
     plus the password when the note is locked, which the calendar never has.
     So notes are rescheduled and opened from here, and edited where they
     live. */
  const canEditHere = item.kind === "task" || item.kind === "event";

  /* ---- read-only rows ---- */

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
      value: item.allDay
        ? t("allDay")
        : item.endsAt
          ? `${toHm(item.date)} – ${toHm(item.endsAt)}`
          : t("startsAtUnknownEnd", { time: toHm(item.date) }),
    });
  } else if (item.kind === "external") {
    rows.push({ label: t("dateLabel"), value: dateLabel });
    rows.push({
      label: t("timeLabel"),
      value: item.allDay
        ? t("allDay")
        : item.endsAt
          ? `${toHm(item.date)} – ${toHm(item.endsAt)}`
          : t("startsAtUnknownEnd", { time: toHm(item.date) }),
    });
    if (item.location) rows.push({ label: t("locationLabel"), value: item.location });
    if (item.status === "tentative") {
      rows.push({ label: t("statusLabel"), value: t("tentative"), tone: "text-warning" });
    }
    rows.push({ label: t("sourceLabel"), value: t("sourceGoogleCalendar") });
  } else {
    rows.push({ label: t("dateLabel"), value: dateLabel });
    rows.push({ label: t("typeLabel"), value: t("stickyNote") });
    rows.push({
      label: t("accessLabel"),
      value: item.locked ? t("accessProtected") : t("accessOpen"),
      tone: item.locked ? "text-warning" : undefined,
    });
  }

  const body =
    item.kind === "event" || item.kind === "external" ? item.description : "";

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-6">
        <div className="flex flex-col gap-2.5 calendar-field">
          <span className={cn("text-[11px] uppercase tracking-[0.14em]", tone.text)}>
            {item.kind === "task"
              ? `${t(KIND_LABEL_KEYS.task)} · ${t(PRIORITY_LABEL_KEYS[item.priority] ?? "priorityMedium")}`
              : t(KIND_LABEL_KEYS[item.kind])}
          </span>
          <span
            className={cn(
              "text-[22px] leading-snug font-semibold tracking-tight text-fg-primary",
              completed && "text-fg-tertiary line-through",
            )}
          >
            {item.title}
          </span>
        </div>

        {tab === "view" && (
          <>
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
          </>
        )}

        {tab === "reschedule" && (
          <RescheduleForm
            item={item}
            busy={busy}
            onCancel={() => setTab("view")}
            onSubmit={reschedule}
          />
        )}

        {tab === "edit" && canEditHere && (
          <EditForm
            item={item}
            busy={busy}
            onCancel={() => setTab("view")}
            onSubmitTask={(values) => taskUpdate.mutate({ taskId: item.id, ...values })}
            onSubmitEvent={(values) => eventUpdate.mutate({ eventId: item.id, ...values })}
          />
        )}
      </div>

      {/* ── Actions ──
          One primary, two secondary, then a menu. Five flat buttons put
          Delete one slip away from Complete; this keeps every control one
          click away without any of them competing for the eye. */}
      {tab === "view" && readOnly && (
        <div className="shrink-0 border-t border-border-light bg-bg-surface px-5 py-4">
          <p className="text-[12px] leading-snug text-fg-tertiary">{t("externalReadOnly")}</p>
        </div>
      )}

      {tab === "view" && !readOnly && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border-light bg-bg-surface px-5 py-4">
          {item.kind === "task" ? (
            <button
              type="button"
              onClick={toggleComplete}
              disabled={busy}
              aria-pressed={completed}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors disabled:opacity-50",
                completed
                  ? "border border-border-medium text-fg-secondary hover:bg-bg-secondary"
                  : "bg-accent-primary text-white hover:bg-accent-hover",
              )}
            >
              <Check size={13} />
              {completed ? t("markIncomplete") : t("markComplete")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setTab("edit")}
              disabled={busy}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-accent-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              <Pencil size={13} />
              {t("edit")}
            </button>
          )}

          <button type="button" onClick={() => setTab("reschedule")} disabled={busy} className={ACTION}>
            <CalendarClock size={13} />
            {t("reschedule")}
          </button>

          {item.kind === "task" && (
            <button type="button" onClick={() => setTab("edit")} disabled={busy} className={ACTION}>
              <Pencil size={13} />
              {t("edit")}
            </button>
          )}

          <span className="flex-1" />

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label={t("moreActions")}
              disabled={busy}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-medium text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary disabled:opacity-50"
            >
              <MoreHorizontal size={15} />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="calendar-pop absolute right-0 bottom-10 z-10 flex w-[220px] flex-col overflow-hidden rounded-xl border border-border-medium bg-bg-elevated shadow-2xl"
              >
                {openHref && (
                  <Link
                    role="menuitem"
                    href={openHref}
                    className="flex items-center gap-2 border-b border-border-light/70 px-3 py-2.5 text-xs font-semibold text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
                  >
                    <SquareArrowOutUpRight size={13} />
                    {openLabel}
                  </Link>
                )}
                {confirmDelete ? (
                  <div className="flex flex-col gap-2 p-3">
                    <span className="text-[12px] leading-snug text-fg-secondary">
                      {t("deleteConfirm")}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={remove}
                        disabled={busy}
                        className="h-control-sm flex-1 rounded-md bg-error px-2 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {t("deleteYes")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="h-control-sm rounded-md border border-border-medium px-2 text-[11px] font-semibold text-fg-secondary transition-colors hover:bg-bg-secondary"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-error transition-colors hover:bg-error/10"
                  >
                    <Trash2 size={13} />
                    {t("delete")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Reschedule                                                        */
/* ------------------------------------------------------------------ */

function RescheduleForm({
  item,
  busy,
  onCancel,
  onSubmit,
}: {
  item: CalendarItem;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (at: Date) => void;
}) {
  const t = useTranslations("calendar.filters");
  const [day, setDay] = useState(toYmd(item.date));
  const [time, setTime] = useState(item.allDay ? "00:00" : toHm(item.date));

  const at = useMemo(() => combine(day, time), [day, time]);

  return (
    <div className="flex flex-col gap-4 calendar-field">
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-2">
          <span className={MICRO_LABEL}>{t("dateFieldLabel")}</span>
          <input
            data-autofocus
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
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => at && onSubmit(at)}
          disabled={busy || !at}
          className="h-10 flex-1 rounded-lg bg-accent-primary text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? t("saving") : t("saveChanges")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-lg border border-border-medium px-4 text-[13px] font-semibold text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Edit                                                              */
/* ------------------------------------------------------------------ */

function EditForm({
  item,
  busy,
  onCancel,
  onSubmitTask,
  onSubmitEvent,
}: {
  item: CalendarItem;
  busy: boolean;
  onCancel: () => void;
  onSubmitTask: (values: { title: string; priority: "low" | "medium" | "high" | "urgent" }) => void;
  onSubmitEvent: (values: { title: string; description: string; endsAt: Date | null }) => void;
}) {
  const t = useTranslations("calendar.filters");
  const toast = useToast();
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.kind === "event" ? item.description : "");
  const [priority, setPriority] = useState(item.kind === "task" ? item.priority : "medium");
  const [endTime, setEndTime] = useState(
    item.kind === "event" && item.endsAt ? toHm(item.endsAt) : "",
  );

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error(t("titleRequired"));
      return;
    }

    if (item.kind === "task") {
      onSubmitTask({
        title: trimmed,
        priority: priority as "low" | "medium" | "high" | "urgent",
      });
      return;
    }

    if (item.kind === "event") {
      const body = description.trim();
      if (!body) {
        toast.error(t("descriptionRequired"));
        return;
      }
      // An empty end time clears it back to "unknown" rather than guessing.
      const endsAt = endTime ? combine(toYmd(item.date), endTime) : null;
      if (endTime && (!endsAt || endsAt <= item.date)) {
        toast.error(t("endBeforeStart"));
        return;
      }
      onSubmitEvent({ title: trimmed, description: body, endsAt });
    }
  };

  return (
    <div className="flex flex-col gap-4 calendar-field">
      <label className="flex flex-col gap-2">
        <span className={MICRO_LABEL}>{t("titleLabel")}</span>
        <input
          data-autofocus
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={FIELD}
        />
      </label>

      {item.kind === "task" && (
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
      )}

      {item.kind === "event" && (
        <>
          <label className="flex w-[150px] flex-col gap-2">
            <span className={MICRO_LABEL}>{t("endsAtLabel")}</span>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={FIELD}
            />
            <span className="text-[11px] text-fg-tertiary">{t("endsAtHint")}</span>
          </label>
          <label className="flex flex-col gap-2">
            <span className={MICRO_LABEL}>{t("descriptionLabel")}</span>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="resize-y rounded-lg border border-border-medium bg-bg-surface px-3 py-2.5 text-sm text-fg-primary outline-none transition-colors focus:border-accent-primary/60 focus:ring-2 focus:ring-accent-primary/20"
            />
          </label>
        </>
      )}

      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="h-10 flex-1 rounded-lg bg-accent-primary text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? t("saving") : t("saveChanges")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-lg border border-border-medium px-4 text-[13px] font-semibold text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

/** `YYYY-MM-DD` + `HH:MM` as a local-time Date, or `null` if unusable. */
function combine(day: string, time: string): Date | null {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!y || !m || !d) return null;
  const out = new Date(y, m - 1, d, hh ?? 0, mm ?? 0, 0, 0);
  return Number.isNaN(out.getTime()) ? null : out;
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
  /* Seeded from the hour that was clicked. The grid's empty slots pass the
     hour through, so "new at 14:00" no longer arrives as 09:00. */
  const [time, setTime] = useState(() => (isMidnight(date) ? "09:00" : toHm(date)));
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [priority, setPriority] = useState<string>("medium");
  const [region, setRegion] = useState<Region>("sofia");

  // Re-seed when the user opens the panel from another day or hour.
  useEffect(() => {
    setDay(toYmd(date));
    setTime(isMidnight(date) ? "09:00" : toHm(date));
  }, [date]);

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

  const scheduledAt = useMemo(() => combine(day, time), [day, time]);

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

  const isSaving = createTask.isPending || createEvent.isPending || createNote.isPending;

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
        <div className="flex gap-2 calendar-field" role="group" aria-label={t("itemKind")}>
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
            data-autofocus
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

function isMidnight(d: Date) {
  return d.getHours() === 0 && d.getMinutes() === 0;
}
