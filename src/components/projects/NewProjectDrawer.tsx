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
        className="flex h-[34px] items-center gap-[7px] rounded-full bg-tui-accent px-3 text-[13px] font-medium whitespace-nowrap text-tui-on-accent transition-opacity hover:opacity-90 sm:px-3.5"
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
              className={`border-tui-ink/10 bg-tui-pane text-tui-ink relative m-2 flex h-[calc(100%-1rem)] w-full max-w-[520px] flex-col overflow-hidden rounded-[16px] border shadow-[var(--tui-pane-shadow)] sm:m-3 sm:h-[calc(100%-1.5rem)] ${
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
                {/* Header: what this is, and the name — the one field that matters. */}
                <div className={`flex flex-col pt-6 pb-6 ${PAD}`}>
                  <div className="flex items-center justify-between">
                    <span id={titleId} className={EYEBROW}>
                      {t("title")}
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
                    ref={nameRef}
                    value={title}
                    onChange={(event) =>
                      setTitle(event.target.value.replace(/\n/g, ""))
                    }
                    rows={1}
                    maxLength={256}
                    placeholder={t("untitled")}
                    aria-label={t("name")}
                    className="font-display text-tui-ink placeholder:text-tui-ink3/70 mt-5 resize-none overflow-hidden bg-transparent [field-sizing:content] text-[38px] leading-[1.05] tracking-[-0.02em] outline-none sm:text-[44px]"
                  />
                  <span className="text-tui-ink3 mt-2 text-[13px] leading-[1.6]">
                    {t("nameHint")}
                  </span>
                </div>

                <div className="bg-tui-ink/8 mx-6 h-px sm:mx-8" />

                {/* Body */}
                <div
                  className={`scrollbar-hide kairos-scroll-area flex min-h-0 flex-1 flex-col overflow-y-auto ${PAD}`}
                >
                  <Field label={t("description")} optional={t("optional")}>
                    <textarea
                      rows={2}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder={t("descriptionPlaceholder")}
                      className="border-tui-ink/10 text-tui-ink placeholder:text-tui-ink3 focus:border-tui-ink/30 w-full resize-none rounded-[10px] border bg-transparent px-3.5 py-2.5 text-[14px] leading-[1.6] transition-colors outline-none"
                    />
                  </Field>

                  <Field label={t("whoCanSee")}>
                    <div
                      role="radiogroup"
                      aria-label={t("whoCanSee")}
                      className="border-tui-ink/10 flex flex-col overflow-hidden rounded-[10px] border"
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
                            className={`border-tui-ink/8 flex items-center gap-3 border-t px-3.5 py-3 text-left transition-colors first:border-t-0 ${
                              active
                                ? "bg-tui-ink/[0.045]"
                                : "hover:bg-tui-ink/[0.025]"
                            }`}
                          >
                            <span
                              className={`flex h-4 w-4 flex-none items-center justify-center rounded-full border transition-colors ${
                                active ? "border-tui-ink" : "border-tui-ink/25"
                              }`}
                            >
                              {active && (
                                <span className="bg-tui-ink h-2 w-2 rounded-full" />
                              )}
                            </span>
                            <span className="flex min-w-0 flex-col">
                              <span className="text-tui-ink text-[14px] font-medium">
                                {t(option.label)}
                              </span>
                              <span className="text-tui-ink3 text-[12.5px]">
                                {t(option.hint)}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </Field>

                  <Field
                    label={t("inviteSomeone")}
                    optional={t("optional")}
                    hint={t("inviteHint")}
                  >
                    <div className="border-tui-ink/10 focus-within:border-tui-ink/30 flex items-center gap-2 rounded-[10px] border py-1 pr-1 pl-3.5 transition-colors">
                      <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder={t("invitePlaceholder")}
                        className="text-tui-ink placeholder:text-tui-ink3 h-8 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
                      />
                      <div
                        role="radiogroup"
                        aria-label={t("permission")}
                        className="bg-tui-ink/[0.045] flex flex-none gap-0.5 rounded-[8px] p-0.5"
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
                              className={`h-7 rounded-[6px] px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors ${
                                active
                                  ? "bg-tui-pane text-tui-ink shadow-[var(--tui-pane-shadow)]"
                                  : "text-tui-ink3 hover:text-tui-ink2"
                              }`}
                            >
                              {t(option.label)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </Field>

                  {/* A live preview, drawn as the dashboard's project row. */}
                  <Field label={t("howItAppears")}>
                    <div className="border-tui-ink/8 bg-tui-bg grid grid-cols-[minmax(0,1fr)_minmax(0,120px)] items-center gap-5 rounded-[10px] border px-4 py-3.5">
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span
                          className={`truncate text-[14.5px] font-medium ${
                            title.trim() ? "text-tui-ink" : "text-tui-ink3"
                          }`}
                        >
                          {title.trim() || t("untitled")}
                        </span>
                        <span className="text-tui-ink3 text-[12px]">
                          {t("noTasksYet")}
                        </span>
                      </span>
                      <span className="bg-tui-ink/8 block h-[3px] rounded-full" />
                    </div>
                  </Field>
                  <span className="h-6 flex-none" />
                </div>

                {/* Footer */}
                <div
                  className={`border-tui-ink/8 flex items-center gap-2 border-t py-4 ${PAD}`}
                >
                  <span className="text-tui-ink3 hidden items-center gap-2 text-[12px] sm:flex">
                    <kbd className="border-tui-ink/12 rounded-[4px] border px-1.5 font-mono text-[10.5px] leading-4">
                      ⌘ ↵
                    </kbd>
                    {t("toCreate")}
                  </span>
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
                    {pending ? t("creating") : t("submit")}
                    <span aria-hidden>→</span>
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

/** Side padding shared by the header, body and footer, so their edges line up. */
const PAD = "px-6 sm:px-8";

/** The small spaced capitals the dashboard labels with. */
const EYEBROW =
  "text-tui-ink3 text-[10.5px] font-medium tracking-[0.18em] uppercase";

/** One form field: a spaced-capitals label, the control, an optional note. */
function Field({
  label,
  optional,
  hint,
  children,
}: {
  label: string;
  optional?: string;
  hint?: string;
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
      {hint && (
        <span className="text-tui-ink3 text-[12px] leading-[1.6]">{hint}</span>
      )}
    </div>
  );
}
