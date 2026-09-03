"use client";

/**
 * Resetting a forgotten note password with the account's recovery PIN.
 *
 * This is the only route back into an encrypted note, and it stays exactly as
 * it was: the PIN is checked server-side, the note is re-encrypted under the
 * new password, and there is no path that reveals the old one. Only the
 * chrome around it changed.
 */

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, Loader2 } from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";

import { DialogError, DialogField, DialogPasswordField, NotesDialog } from "./notesDialog";
import { BTN_ACCENT, BTN_GHOST, FIELD_INPUT } from "./notesUi";

export function PinResetDialog({
  noteId,
  hint,
  onClose,
  onSuccess,
}: {
  noteId: number;
  hint: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useTranslations("notes");
  const toast = useToast();

  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pinRef = useRef<HTMLInputElement | null>(null);

  const resetPassword = api.note.resetPasswordWithPin.useMutation({
    onSuccess: () => {
      toast.success(t("password.resetSuccess"));
      onSuccess();
    },
    /* The server answers in English and in its own words. A wrong PIN is the
       one outcome a user hits on purpose, so it gets said properly — and said
       as "wrong PIN", not as the "required" message the empty-field check
       used to leak into this spot. */
    onError: (mutationError) => {
      const code = mutationError.data?.code;
      if (code === "UNAUTHORIZED") {
        setError(t("password.incorrectPin"));
        return;
      }
      if (code === "TOO_MANY_REQUESTS") {
        setError(t("password.pinLocked"));
        return;
      }
      setError(mutationError.message);
    },
  });

  const submit = () => {
    /* Separately, so an empty PIN is not reported as a missing password. */
    if (!pin.trim()) {
      setError(t("password.pinRequired"));
      return;
    }
    if (!password || !confirmPassword) {
      setError(t("password.passwordRequired"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("password.passwordsMismatch"));
      return;
    }
    setError(null);
    resetPassword.mutate({ noteId, resetPin: pin.trim(), newPassword: password });
  };

  const pinRejected = error === t("password.incorrectPin") || error === t("password.pinLocked");

  return (
    <NotesDialog
      icon={<KeyRound size={15} />}
      title={t("password.resetPassword")}
      subtitle={t("password.enterSecretPin")}
      onClose={onClose}
      onSubmit={submit}
      initialFocusRef={pinRef}
      actions={({ close }) => (
        <>
          <button type="button" onClick={close} className={BTN_GHOST}>
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={resetPassword.isPending} className={BTN_ACCENT}>
            {resetPassword.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <KeyRound size={13} />
            )}
            {resetPassword.isPending ? t("password.resetting") : t("password.resetPassword")}
          </button>
        </>
      )}
    >
      <DialogField
        id="notes-reset-pin"
        label={t("password.resetPin")}
        hint={hint ? <em>{t("password.hint", { hint })}</em> : undefined}
        invalid={pinRejected}
      >
        <input
          id="notes-reset-pin"
          ref={pinRef}
          type="password"
          value={pin}
          onChange={(event) => {
            setPin(event.target.value);
            setError(null);
          }}
          placeholder={t("password.enterPin")}
          autoComplete="off"
          aria-invalid={pinRejected ? "true" : undefined}
          className={FIELD_INPUT}
        />
      </DialogField>

      <DialogPasswordField
        id="notes-reset-password"
        label={t("password.newPassword")}
        value={password}
        onChange={setPassword}
      />
      <DialogPasswordField
        id="notes-reset-confirm"
        label={t("password.confirmPassword")}
        value={confirmPassword}
        onChange={setConfirmPassword}
      />

      {error && <DialogError>{error}</DialogError>}
    </NotesDialog>
  );
}
