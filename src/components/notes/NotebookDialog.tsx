"use client";

/**
 * Creating or renaming a notebook.
 *
 * `note.updateNotebook` has existed on the router since notebooks shipped and
 * had no caller, so a notebook could never be renamed and its `description`
 * column could never be filled. This is the missing half.
 */

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";

import { DIALOG_INPUT, DIALOG_PRIMARY, DIALOG_QUIET, DialogField, NotesDialog } from "./notesDialog";

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

  const nameRef = useRef<HTMLInputElement | null>(null);

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
    <NotesDialog
      eyebrow={t("dialog.notebook")}
      size="sm"
      title={notebook ? t("notebooks.rename") : t("notebooks.create")}
      subtitle={notebook?.name}
      onClose={onClose}
      onSubmit={submit}
      initialFocusRef={nameRef}
      actions={({ close }) => (
        <>
          <button type="button" onClick={close} className={DIALOG_QUIET}>
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={!name.trim() || isPending} className={DIALOG_PRIMARY}>
            {isPending && <Loader2 size={14} className="animate-spin" />}
            {notebook ? t("actions.save") : t("actions.create")}
          </button>
        </>
      )}
    >
      <DialogField id="notebook-name" label={t("notebooks.name")}>
        <input
          id="notebook-name"
          ref={nameRef}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("notebooks.namePlaceholder")}
          maxLength={256}
          className={DIALOG_INPUT}
        />
      </DialogField>

      <DialogField id="notebook-description" label={t("notebooks.description")} multiline>
        <textarea
          id="notebook-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t("notebooks.descriptionPlaceholder")}
          rows={2}
          className={`${DIALOG_INPUT} resize-none leading-relaxed`}
        />
      </DialogField>
    </NotesDialog>
  );
}
