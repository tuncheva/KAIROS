"use client";

/**
 * Taking the password off a note.
 *
 * One field, because the server needs the current password to decrypt the body
 * before it can store it as plaintext again — an owner check is not enough. If
 * the note was already unlocked this session the password is in hand, so the
 * field is skipped and this is a plain confirmation instead.
 *
 * Worth confirming either way: the body stops being encrypted at rest, which is
 * the thing the lock was for. That is why the warning is a `danger` block here
 * rather than the grey line it used to be under the field.
 */

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, LockOpen, ShieldOff } from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";

import { DialogBlock, DialogError, DialogPasswordField, NotesDialog } from "./notesDialog";
import { BTN_DANGER, BTN_GHOST } from "./notesUi";

export function RemoveLockDialog({
  noteId,
  knownPassword,
  onClose,
  onSuccess,
}: {
  noteId: number;
  /** The password held for this note this session, if it is unlocked. */
  knownPassword: string | undefined;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useTranslations("notes");
  const toast = useToast();

  const [password, setPassword] = useState(knownPassword ?? "");
  const [error, setError] = useState<string | null>(null);

  const passwordRef = useRef<HTMLInputElement | null>(null);

  const removePassword = api.note.removePassword.useMutation({
    onSuccess: () => {
      toast.success(t("password.removed"));
      onSuccess();
    },
    onError: (mutationError) =>
      setError(
        mutationError.data?.code === "UNAUTHORIZED"
          ? t("messages.incorrectPassword")
          : mutationError.message,
      ),
  });

  const submit = () => {
    if (!password) {
      setError(t("password.passwordRequired"));
      return;
    }
    setError(null);
    removePassword.mutate({ noteId, password });
  };

  return (
    <NotesDialog
      icon={<LockOpen size={15} />}
      tone="error"
      title={t("password.remove")}
      subtitle={t("password.removeDesc")}
      onClose={onClose}
      onSubmit={submit}
      initialFocusRef={passwordRef}
      actions={({ close }) => (
        <>
          <button type="button" onClick={close} className={BTN_GHOST}>
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={removePassword.isPending} className={BTN_DANGER}>
            {removePassword.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ShieldOff size={13} />
            )}
            {removePassword.isPending ? t("common.working") : t("password.remove")}
          </button>
        </>
      )}
    >
      {knownPassword === undefined && (
        <DialogPasswordField
          id="notes-unlock-password"
          label={t("password.enterPassword")}
          value={password}
          onChange={(next) => {
            setPassword(next);
            setError(null);
          }}
          autoComplete="current-password"
          inputRef={passwordRef}
          /* A wrong password is the one outcome a user reaches on purpose here,
             so the field shakes rather than only growing a line of red text. */
          invalid={error === t("messages.incorrectPassword")}
        />
      )}

      <DialogBlock tone="danger">{t("password.removeWarning")}</DialogBlock>

      {error && <DialogError>{error}</DialogError>}
    </NotesDialog>
  );
}
