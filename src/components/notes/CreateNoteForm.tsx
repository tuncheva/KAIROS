"use client";

import { useState } from "react";
import { Plus, Loader2 } from "~/components/ui/icons";
import { api } from "~/trpc/react";
import { useTranslations } from "next-intl";
import { useToast } from "~/components/providers/ToastProvider";

export function CreateNoteForm() {
  const t = useTranslations("create");
  const tCalendar = useTranslations("notes.calendar");
  const toast = useToast();
  const utils = api.useUtils();

  const [showForm, setShowForm] = useState(false);
  const [content, setContent] = useState("");
  const [password, setPassword] = useState("");
  const [addToCalendar, setAddToCalendar] = useState(false);
  const [calendarDate, setCalendarDate] = useState("");
  const [calendarTime, setCalendarTime] = useState("12:00");

  const buildCalendarDateTime = () => {
    if (!calendarDate) return undefined;
    const [y, m, d] = calendarDate.split("-").map(Number);
    if (!y || !m || !d) return undefined;
    const [hh, mm] = calendarTime.split(":").map(Number);
    return new Date(y, m - 1, d, Number.isFinite(hh) ? hh : 12, Number.isFinite(mm) ? mm : 0, 0, 0);
  };

  const createNote = api.note.create.useMutation({
    onSuccess: async () => {
      await utils.note.getAll.invalidate();
      setContent("");
      setPassword("");
      setAddToCalendar(false);
      setCalendarDate("");
      setCalendarTime("12:00");
      setShowForm(false);
      toast.success(t("notes.success.created"));
    },
    onError: (error) => {
      toast.error(t("notes.errors.createFailed", { message: error.message }));
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      toast.info(t("notes.validation.contentRequired"));
      return;
    }

    createNote.mutate({
      content: content.trim(),
      password: password.trim() ? password : undefined,
      calendarDate: addToCalendar ? buildCalendarDateTime() : undefined,
    });
  };

  return (
    <div className="h-full flex flex-col">
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full p-5 rounded-xl bg-accent-primary text-white shadow-xl hover:shadow-2xl hover:brightness-[1.02] transition-all"
        >
          <div className="flex items-center justify-center gap-2">
            <span className="text-lg sm:text-xl font-bold tracking-[-0.02em]">{t("notes.actions.createNew")}</span>
          </div>
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 flex-1">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t("notes.placeholders.content")}
            className="flex-1 p-4 rounded-xl bg-bg-secondary border border-border-light/20 focus:outline-none focus:ring-2 focus:ring-accent-primary/30 text-fg-primary placeholder:text-fg-tertiary resize-none"
            autoFocus
          />

          <div>
            <label className="block text-xs font-semibold text-fg-secondary mb-2 uppercase tracking-wide">
              {t("notes.labels.password")} <span className="text-fg-tertiary font-normal">({t("notes.optional")})</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("notes.placeholders.password")}
              className="w-full px-4 py-3 bg-bg-secondary rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary/30 text-fg-primary placeholder:text-fg-tertiary transition-all"
            />
          </div>

          <div className="rounded-xl border border-border-light/20 bg-bg-secondary/40 p-3">
            <label className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-fg-primary">{tCalendar("addToCalendar")}</div>
                <div className="text-[11px] text-fg-tertiary">{tCalendar("addToCalendarDesc")}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAddToCalendar((v) => {
                    const next = !v;
                    if (!next) {
                      setCalendarDate("");
                      setCalendarTime("12:00");
                    }
                    return next;
                  });
                }}
                className={`h-6 w-11 rounded-full transition relative border border-border-light/20 ${
                  addToCalendar ? "bg-accent-primary/60" : "bg-bg-secondary"
                }`}
                aria-pressed={addToCalendar}
                aria-label={tCalendar("addToCalendar")}
              >
                <span
                  className={`absolute top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white transition ${
                    addToCalendar ? "right-0.5" : "left-0.5"
                  }`}
                />
              </button>
            </label>

            {addToCalendar && (
              <div className="mt-3">
                <label className="block text-xs font-semibold text-fg-secondary mb-2 uppercase tracking-wide">
                  {tCalendar("calendarDate")}
                </label>
                <input
                  type="date"
                  value={calendarDate}
                  onChange={(e) => setCalendarDate(e.target.value)}
                  className="w-full px-4 py-3 bg-bg-secondary rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary/30 text-fg-primary placeholder:text-fg-tertiary transition-all"
                />
                <label className="mt-3 block text-xs font-semibold text-fg-secondary mb-2 uppercase tracking-wide">
                  {tCalendar("calendarTime")}
                </label>
                <input
                  type="time"
                  value={calendarTime}
                  onChange={(e) => setCalendarTime(e.target.value)}
                  className="w-full px-4 py-3 bg-bg-secondary rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary/30 text-fg-primary placeholder:text-fg-tertiary transition-all"
                />
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createNote.isPending || !content.trim()}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                {createNote.isPending ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    {t("notes.actions.creating")}
                  </>
                ) : (
                  <>
                    <Plus size={18} />
                    {t("notes.actions.create")}
                  </>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-3 rounded-lg border border-border-light/20 text-fg-primary hover:bg-bg-secondary transition-all"
            >
              {t("notes.actions.cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
