"use client";

/**
 * Creating or renaming a notebook.
 *
 * `note.updateNotebook` has existed on the router since notebooks shipped and
 * had no caller, so a notebook could never be renamed and its `description`
 * column could never be filled. This is the missing half.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, Loader2, X } from "lucide-react";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";

export function NotebookDialog({
  notebook,
  onClose,
}: {
  /** Null creates a new notebook; otherwise the one being renamed. */
  notebook: { id: number; name: string; description: string | null } | null;
  onClose: () => void;
}) {
  const t = useTranslations("notes");
  const toast = useToast();
  const utils = api.useUtils();

  const [name, setName] = useState(notebook?.name ?? "");
  const [description, setDescription] = useState(notebook?.description ?? "");

  const dialogRef = useRef<HTMLFormElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const createNotebook = api.note.createNotebook.useMutation({
    onSuccess: () => {
      toast.success(t("notebooks.created"));
      void utils.note.getNotebooks.invalidate();
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateNotebook = api.note.updateNotebook.useMutation({
    onSuccess: () => {
      toast.success(t("notebooks.renamed"));
      void utils.note.getNotebooks.invalidate();
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const isPending = createNotebook.isPending || updateNotebook.isPending;

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    nameRef.current?.focus();
    nameRef.current?.select();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreTo.current?.focus();
    };
  }, [onClose]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || isPending) return;

    if (notebook) {
      updateNotebook.mutate({ id: notebook.id, name: trimmed, description: description.trim() });
    } else {
      createNotebook.mutate({
        name: trimmed,
        description: description.trim() || undefined,
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[65] bg-black/50 grid place-items-center p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notes-notebook-title"
        className="w-full max-w-sm p-6 rounded-2xl bg-bg-elevated kairos-system-card-elevated"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-accent-primary/12 grid place-items-center">
            <BookOpen size={16} className="text-accent-primary" />
          </div>
          <h2 id="notes-notebook-title" className="flex-1 text-base font-bold text-fg-primary">
            {notebook ? t("notebooks.rename") : t("notebooks.create")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="kairos-tap p-1.5 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-bg-secondary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3.5">
          <div>
            <label htmlFor="notebook-name" className="block text-xs font-semibold text-fg-secondary mb-1.5">
              {t("notebooks.name")}
            </label>
            <input
              id="notebook-name"
              ref={nameRef}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("notebooks.namePlaceholder")}
              maxLength={256}
              className="w-full px-3.5 py-2.5 text-sm bg-bg-secondary rounded-lg text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/35"
            />
          </div>

          <div>
            <label
              htmlFor="notebook-description"
              className="block text-xs font-semibold text-fg-secondary mb-1.5"
            >
              {t("notebooks.description")}
            </label>
            <textarea
              id="notebook-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("notebooks.descriptionPlaceholder")}
              rows={2}
              className="w-full px-3.5 py-2.5 text-sm bg-bg-secondary rounded-lg text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/35 resize-none"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-fg-secondary hover:bg-bg-secondary transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={!name.trim() || isPending}
            className="flex-1 px-4 py-2.5 rounded-xl bg-accent-primary text-white text-sm font-semibold hover:bg-accent-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            {notebook ? t("actions.save") : t("actions.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
