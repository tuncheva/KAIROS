"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { Overlay } from "~/components/ui/Overlay";
import { exitDurationMs } from "~/components/ui/drawerExit";

type Visibility = "private" | "shared_read" | "shared_write";
type Permission = "read" | "write";

const VISIBILITY: { key: Visibility; label: string }[] = [
  { key: "private", label: "private" },
  { key: "shared_read", label: "canView" },
  { key: "shared_write", label: "canEdit" },
];

const PERMISSIONS: { key: Permission; label: string }[] = [
  { key: "read", label: "canView" },
  { key: "write", label: "canEdit" },
];

/**
 * A single-choice pill set.
 *
 * These are radios, not toggles. Visibility and permission both offer
 * "Can view" / "Can edit", so as plain buttons the drawer had two different
 * controls with the same accessible name and nothing to say which was which —
 * the radiogroup's label is what disambiguates them.
 *
 * Selection is an accent outline with a wash rather than a solid fill; a filled
 * pill next to the solid "Create project" button read as a second primary
 * action.
 */
function PillGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** Names the group. The visible text above it is a section heading, not this. */
  label: string;
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  className: string;
}) {
  const t = useTranslations("projects.drawer");

  return (
    <div role="radiogroup" aria-label={label} className={className}>
      {options.map((option) => {
        const active = value === option.key;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.key)}
            className={`rounded-[9px] border px-2.5 py-[11px] text-[13px] font-medium transition-colors duration-300 ${
              active
                ? "border-accent-primary/55 bg-accent-primary/[0.14] text-fg-primary"
                : "border-border-light/60 bg-transparent text-fg-tertiary hover:border-border-strong/60 hover:text-fg-secondary"
            }`}
          >
            {t(option.label)}
          </button>
        );
      })}
    </div>
  );
}

const FIELD =
  "rounded-[9px] border border-border-light/60 bg-bg-tertiary px-3.5 text-fg-primary outline-none transition-colors duration-300 placeholder:text-fg-quaternary focus:border-accent-primary/60";

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
export function NewProjectDrawer({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const t = useTranslations("projects.drawer");
  const toast = useToast();
  const utils = api.useUtils();
  const titleId = useId();

  /* `defaultOpen` lets a caller land straight in the form — "new project" links
     from elsewhere in the app point at `/projects?new=1` rather than dropping
     the user on the list (or, worse, on the empty state) with another click to
     make. */
  const [open, setOpen] = useState(defaultOpen);
  /**
   * The drawer has been asked to close but is still on screen playing its exit.
   *
   * Without this the panel was unmounted on the same frame as the click, so the
   * 0.45s entrance had no counterpart — the drawer arrived by sliding and left
   * by disappearing. The exit halves already existed in `globals.css`
   * (`.projects-drawer-out` / `.projects-drawer-scrim-out`); nothing here ever
   * asked for them.
   */
  const [closing, setClosing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<Permission>("read");

  const nameRef = useRef<HTMLInputElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setTitle("");
    setDescription("");
    setVisibility("private");
    setEmail("");
    setPermission("read");
  }, []);

  /**
   * Hold the drawer mounted for the length of its exit, then unmount and clear
   * the form. Matches `.projects-drawer-out` (0.45s — the panel's duration, not
   * the scrim's shorter 0.35s), and is a timer rather than an `animationend`
   * listener because under `prefers-reduced-motion` the rules resolve to
   * `animation: none` and no such event ever fires.
   *
   * The reset waits for the exit too: clearing the fields on the click would
   * mean watching an emptied form slide away.
   */
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
    // Reopening mid-exit cancels it, or the pending timer would close the
    // drawer that was just reopened.
    if (exitTimer.current) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    setClosing(false);
    setOpen(true);
  }, []);

  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);

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

  // Escape closes, and focus lands in the name field — the drawer exists to be
  // typed into, so opening it should not cost a click.
  useEffect(() => {
    // Ignored once the drawer is already leaving: a second Escape would ask a
    // closing drawer to close again.
    if (!open || closing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    nameRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closing, close]);

  const pending = createProject.isPending || addCollaborator.isPending;
  const canSubmit = title.trim().length > 0 && !pending;

  const submit = () => {
    if (!canSubmit) return;
    createProject.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      shareStatus: visibility,
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={openDrawer}
        className="flex items-center gap-2 rounded-lg bg-accent-primary px-[15px] py-[9px] text-[13px] font-semibold text-white transition-all duration-300 hover:-translate-y-px hover:bg-accent-hover"
      >
        <Plus size={15} aria-hidden />
        <span className="hidden sm:inline">{t("open")}</span>
      </button>

      {open && (
        <Overlay>
        <div
          className={`fixed inset-0 z-[60] flex justify-end ${closing ? "pointer-events-none" : ""}`}
          role="dialog" aria-modal="true" aria-labelledby={titleId}>
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
              <h2 id={titleId} className="m-0 text-[17px] font-semibold tracking-[-0.01em] text-fg-primary">
                {t("title")}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label={t("close")}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-border-light/70 text-fg-tertiary transition-colors duration-300 hover:bg-bg-tertiary hover:text-fg-primary"
              >
                <X size={15} aria-hidden />
              </button>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex flex-1 flex-col gap-[22px] overflow-auto p-[26px]">
                <label className="projects-slide-in flex flex-col gap-2" style={{ animationDelay: "0.1s" }}>
                  <span className="kairos-stamp text-[10px] tracking-[0.14em] text-fg-tertiary">
                    {t("name")}
                  </span>
                  <input
                    ref={nameRef}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={256}
                    placeholder={t("namePlaceholder")}
                    className={`h-11 text-[15px] ${FIELD}`}
                  />
                </label>

                <label className="projects-slide-in flex flex-col gap-2" style={{ animationDelay: "0.16s" }}>
                  <span className="kairos-stamp text-[10px] tracking-[0.14em] text-fg-tertiary">
                    {t("description")}{" "}
                    <span className="text-fg-quaternary">{t("optional")}</span>
                  </span>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={t("descriptionPlaceholder")}
                    className={`resize-none py-3 text-sm leading-[1.5] ${FIELD}`}
                  />
                </label>

                <div className="projects-slide-in flex flex-col gap-2.5" style={{ animationDelay: "0.22s" }}>
                  <span
                    className="kairos-stamp text-[10px] tracking-[0.14em] text-fg-tertiary"
                  >
                    {t("visibility")}
                  </span>
                  <PillGroup
                    label={t("visibility")}
                    options={VISIBILITY}
                    value={visibility}
                    onChange={setVisibility}
                    className="grid grid-cols-3 gap-2"
                  />
                </div>

                <div
                  className="projects-slide-in flex flex-col gap-2.5 border-t border-border-light/50 pt-5"
                  style={{ animationDelay: "0.28s" }}
                >
                  <span
                    className="kairos-stamp text-[10px] tracking-[0.14em] text-fg-tertiary"
                  >
                    {t("invite")}
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t("invitePlaceholder")}
                    className={`h-11 text-[15px] ${FIELD}`}
                  />
                  <PillGroup
                    label={t("permission")}
                    options={PERMISSIONS}
                    value={permission}
                    onChange={setPermission}
                    className="grid grid-cols-2 gap-2"
                  />
                </div>
              </div>

              <div className="flex gap-2.5 border-t border-border-light/50 bg-bg-primary px-[26px] py-5">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-[9px] border border-border-light/70 px-[18px] py-3 text-sm font-medium text-fg-secondary transition-colors duration-300 hover:bg-bg-tertiary hover:text-fg-primary"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="flex-1 rounded-[9px] bg-accent-primary px-[18px] py-3 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-px hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50"
                >
                  {pending ? t("creating") : t("submit")}
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
