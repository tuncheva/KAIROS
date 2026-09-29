"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Plus } from "~/components/ui/icons";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { Overlay } from "~/components/ui/Overlay";
import { exitDurationMs } from "~/components/ui/drawerExit";

type Visibility = "private" | "shared_read" | "shared_write";
type Permission = "read" | "write";

/** Visibility, as rich radio rows: a title and a line saying what it means. */
const VISIBILITY: { key: Visibility; label: string; hint: string }[] = [
  { key: "private", label: "private", hint: "visHint.private" },
  { key: "shared_read", label: "canView", hint: "visHint.canView" },
  { key: "shared_write", label: "canEdit", hint: "visHint.canEdit" },
];

const PERMISSIONS: { key: Permission; label: string }[] = [
  { key: "read", label: "canView" },
  { key: "write", label: "canEdit" },
];

/**
 * The "New project" affordance: a button in the topbar and the drawer it opens.
 *
 * Button and drawer ship together because the drawer is the button's only
 * caller — splitting them meant lifting `open` into a store so a topbar slot
 * could talk to a sibling of the page body, for one boolean.
 *
 * Creating and inviting are two mutations. The project is created first and the
 * invite is sent against the returned id, so a bad email address costs the
 * invite and not the project.
 */
export function NewProjectDrawer({
  defaultOpen = false,
}: { defaultOpen?: boolean } = {}) {
  const t = useTranslations("projects.drawer");
  const toast = useToast();
  const utils = api.useUtils();
  const titleId = useId();

  const [open, setOpen] = useState(defaultOpen);
  const [closing, setClosing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<Permission>("read");

  const nameRef = useRef<HTMLTextAreaElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setTitle("");
    setDescription("");
    setVisibility("private");
    setEmail("");
    setPermission("read");
  }, []);

  const close = useCallback(() => {
    setClosing((already) => {
      if (already) return already;
      exitTimer.current = setTimeout(() => {
        setOpen(false);
        setClosing(false);
        reset();
      }, exitDurationMs());
      return true;
    });
  }, [reset]);

  const openDrawer = useCallback(() => {
    if (exitTimer.current) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    setClosing(false);
    setOpen(true);
  }, []);

  useEffect(
    () => () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    [],
  );

  const addCollaborator = api.project.addCollaborator.useMutation({
    onError: (error) => toast.error(error.message),
  });

  const createProject = api.project.create.useMutation({
    onSuccess: async (project) => {
      const invite = email.trim();
      if (project && invite) {
        await addCollaborator
          .mutateAsync({ projectId: project.id, email: invite, permission })
          .catch(() => undefined);
      }
      toast.success(t("created", { title: project?.title ?? title.trim() }));
      close();
      await utils.project.getMyProjects.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const pending = createProject.isPending || addCollaborator.isPending;
  const canSubmit = title.trim().length > 0 && !pending;

  const submit = useCallback(() => {
    if (title.trim().length === 0 || pending) return;
    createProject.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      shareStatus: visibility,
    });
  }, [title, pending, description, visibility, createProject]);

  /* The keydown handler reads `submit` through a ref so the focus effect below
     can keep stable deps — depend on `submit` directly and it re-runs (and
     re-focuses the name field) on every keystroke, since `submit` closes over
     the draft. */
  const submitRef = useRef(submit);
  submitRef.current = submit;

  // Escape closes; ⌘/Ctrl+Enter creates from anywhere in the form. Focus lands
  // in the name field — the drawer exists to be typed into.
  useEffect(() => {
    if (!open || closing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
        submitRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    nameRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closing, close]);

  return (
    <>
      <button
        type="button"
        onClick={openDrawer}
        className="bg-tui-accent text-tui-on-accent flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-opacity hover:opacity-90"
      >
        <Plus size={15} aria-hidden />
        <span className="hidden sm:inline">{t("open")}</span>
      </button>

      {open && (
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
              className={`border-tui-ink/12 bg-tui-pane text-tui-ink relative m-3 flex h-[calc(100%-1.5rem)] w-full max-w-[540px] flex-col overflow-hidden rounded-2xl border shadow-[var(--tui-pane-shadow)] ${
                closing ? "projects-drawer-out" : "projects-drawer"
              }`}
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
                className="flex min-h-0 flex-1 flex-col"
              >
                {/* Header + title */}
                <div className="flex flex-col gap-5 px-9 pt-8 pb-7 sm:px-11">
                  <div className="flex items-center gap-3">
                    <span
                      id={titleId}
                      className="text-tui-ink3 text-[11px] font-medium tracking-[0.2em] uppercase"
                    >
                      {t("title")}
                    </span>
                    <span className="bg-tui-ink/8 h-px flex-1" />
                    <button
                      type="button"
                      onClick={close}
                      aria-label={t("close")}
                      className="border-tui-ink/16 text-tui-ink2 hover:text-tui-ink flex h-[34px] w-[34px] items-center justify-center rounded-full border text-[17px] leading-none transition-colors"
                    >
                      ×
                    </button>
                  </div>

                  <div className="flex flex-col gap-3">
                    <textarea
                      ref={nameRef}
                      value={title}
                      onChange={(event) =>
                        setTitle(event.target.value.replace(/\n/g, ""))
                      }
                      rows={1}
                      maxLength={256}
                      placeholder={t("untitled")}
                      aria-label={t("name")}
                      className="border-tui-accent font-display text-tui-ink placeholder:text-tui-ink3 resize-none border-0 border-b bg-transparent pb-3 text-[36px] leading-[1.1] font-light tracking-[-0.015em] outline-none sm:text-[44px]"
                    />
                    <span className="text-tui-ink3 text-[13.5px] leading-[1.6]">
                      {t("nameHint")}
                    </span>
                  </div>
                </div>

                {/* Body */}
                <div className="flex min-h-0 flex-1 flex-col overflow-auto px-9 sm:px-11">
                  <Section n="i">
                    <label className="flex flex-1 flex-col gap-3">
                      <SectionLabel
                        text={t("description")}
                        optional={t("optional")}
                      />
                      <textarea
                        rows={2}
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder={t("descriptionPlaceholder")}
                        className="border-tui-ink/16 text-tui-ink placeholder:text-tui-ink3 focus:border-tui-accent/60 resize-none border-0 border-b bg-transparent pb-2.5 text-[15px] leading-[1.6] transition-colors outline-none"
                      />
                    </label>
                  </Section>

                  <Section n="ii">
                    <div className="flex flex-1 flex-col gap-2.5">
                      <SectionLabel text={t("whoCanSee")} />
                      <div
                        role="radiogroup"
                        aria-label={t("whoCanSee")}
                        className="flex flex-col"
                      >
                        {VISIBILITY.map((option) => {
                          const active = visibility === option.key;
                          return (
                            <button
                              key={option.key}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              aria-label={t(option.label)}
                              onClick={() => setVisibility(option.key)}
                              className={`-mx-3 flex items-center gap-3.5 rounded-lg p-3 text-left transition-colors ${
                                active
                                  ? "bg-tui-accent/[0.08]"
                                  : "hover:bg-tui-ink/[0.03]"
                              }`}
                            >
                              <span
                                className={`flex h-4 w-4 flex-none items-center justify-center rounded-full border ${
                                  active
                                    ? "border-tui-accent"
                                    : "border-tui-ink/25"
                                }`}
                              >
                                {active && (
                                  <span className="bg-tui-accent h-2 w-2 rounded-full" />
                                )}
                              </span>
                              <span className="flex flex-col gap-0.5">
                                <span className="text-tui-ink text-[14.5px] font-medium">
                                  {t(option.label)}
                                </span>
                                <span className="text-tui-ink3 text-[13px]">
                                  {t(option.hint)}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </Section>

                  <Section n="iii">
                    <div className="flex flex-1 flex-col gap-3">
                      <SectionLabel
                        text={t("inviteSomeone")}
                        optional={t("optional")}
                      />
                      <div className="border-tui-ink/16 flex items-end gap-3.5 border-b pb-2">
                        <input
                          type="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          placeholder={t("invitePlaceholder")}
                          className="text-tui-ink placeholder:text-tui-ink3 min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none"
                        />
                        <div
                          role="radiogroup"
                          aria-label={t("permission")}
                          className="border-tui-ink/12 flex flex-none gap-1 rounded-full border p-0.5"
                        >
                          {PERMISSIONS.map((option) => {
                            const active = permission === option.key;
                            return (
                              <button
                                key={option.key}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                onClick={() => setPermission(option.key)}
                                className={`h-7 rounded-full px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors ${
                                  active
                                    ? "bg-tui-accent/[0.16] text-tui-ink"
                                    : "text-tui-ink3 hover:text-tui-ink2"
                                }`}
                              >
                                {t(option.label)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <span className="text-tui-ink3 text-[12.5px] leading-[1.6]">
                        {t("inviteHint")}
                      </span>
                    </div>
                  </Section>

                  {/* Live preview of the project row */}
                  <div className="border-tui-ink/8 flex flex-col gap-3 border-t py-6">
                    <span className="text-tui-ink3 text-[11px] font-medium tracking-[0.16em] uppercase">
                      {t("howItAppears")}
                    </span>
                    <div className="border-tui-ink/8 bg-tui-bg grid grid-cols-[minmax(0,1fr)_90px_44px_28px] items-center gap-4 rounded-lg border px-4 py-4">
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span
                          className={`font-display truncate text-[19px] ${
                            title.trim() ? "text-tui-ink" : "text-tui-ink3"
                          }`}
                        >
                          {title.trim() || t("untitled")}
                        </span>
                        <span className="text-tui-ink3 text-[12.5px]">
                          {t("noTasksYet")}
                        </span>
                      </span>
                      <span className="bg-tui-ink/12 h-[3px] rounded-sm" />
                      <span className="text-tui-ink3 text-right text-[13.5px] font-semibold">
                        —
                      </span>
                      <span className="border-tui-ink/16 font-display text-tui-ink2 flex h-[26px] w-[26px] items-center justify-center rounded-full border text-[13px]">
                        {title.trim().charAt(0).toUpperCase() || "·"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="border-tui-ink/8 flex items-center gap-4 border-t px-9 py-5 sm:px-11">
                  <span className="text-tui-ink3 hidden items-center gap-2 text-[12.5px] sm:flex">
                    <span className="border-tui-ink/16 rounded-[5px] border px-1.5 py-0.5 text-[11px]">
                      ⌘ ↵
                    </span>
                    {t("toCreate")}
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={close}
                    className="text-tui-ink2 hover:text-tui-ink h-11 px-3 text-[14px] font-medium transition-colors"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="bg-tui-accent text-tui-on-accent flex h-11 items-center gap-2.5 rounded-full px-6 text-[14px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {pending ? t("creating") : t("submit")}
                    <span aria-hidden className="text-[15px]">
                      →
                    </span>
                  </button>
                </div>
              </form>
            </aside>
          </div>
        </Overlay>
      )}
    </>
  );
}

/** A numbered step: a serif-italic accent numeral beside its field. */
function Section({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="border-tui-ink/8 flex gap-4 border-t py-6 first:border-t-0">
      <span className="font-display text-tui-accent w-7 flex-none text-[20px] leading-none italic">
        {n}
      </span>
      {children}
    </div>
  );
}

function SectionLabel({ text, optional }: { text: string; optional?: string }) {
  return (
    <span className="text-tui-ink2 text-[11px] font-medium tracking-[0.16em] uppercase">
      {text}
      {optional && (
        <span className="text-tui-ink3 ml-2 tracking-[0.04em] normal-case">
          {optional}
        </span>
      )}
    </span>
  );
}
