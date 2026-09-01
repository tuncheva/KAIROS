"use client";

/**
 * Locking a note that already exists.
 *
 * The password is chosen here and sent once; the server hashes it, encrypts the
 * body under it, and never stores it. That means the same thing it means
 * everywhere else in this surface: forgetting it costs the note's contents, and
 * the recovery PIN is the only way back — so say so before the button, not
 * after.
 *
 * Kept as its own dialog rather than folded into the context menu because a
 * password typed into a menu item cannot be confirmed, revealed, or explained.
 *
 * The overlay, focus trap, Escape, scroll lock and exit all come from
 * `notesDialog` now; what is left here is the flow, which is unchanged.
 */

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, Loader2, Lock } from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";

import {
  DialogBlock,
  DialogError,
  DialogField,
  DialogPasswordField,
  NotesDialog,
} from "./notesDialog";
import { Badge, BTN_ACCENT, BTN_GHOST, FIELD_INPUT } from "./notesUi";

export function LockNoteDialog({
  noteId,
  onClose,
  onSuccess,
}: {
  noteId: number;
  onClose: () => void;
  /** Handed the password so the session can keep reading the note it just encrypted. */
  onSuccess: (password: string) => void;
}) {
  const t = useTranslations("notes");
  const toast = useToast();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  /* The warning under this form says the recovery PIN is the only way back. For
     a user who has never set one that sentence describes a door that is not
     there: the note becomes unrecoverable the moment it is encrypted, and
     nothing on screen said so. `hasResetPin` is what the dialog branches on —
     if there is no PIN, one is set here, in the same submit, before the note is
     encrypted at all. */
  const settings = api.settings.get.useQuery();
  const hasResetPin = settings.data?.hasResetPin ?? false;
  /* Until the query answers, neither branch is honest — so the button waits
     rather than showing the wrong warning for a frame. */
  const pinKnown = settings.isSuccess;

  const passwordRef = useRef<HTMLInputElement | null>(null);

  const setResetPin = api.settings.updateResetPin.useMutation({
    onSuccess: () => {
      void settings.refetch();
      /* Only now is there a way back, so only now is it safe to encrypt. */
      setNotePassword.mutate({ noteId, password });
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  const setNotePassword = api.note.setPassword.useMutation({
    onSuccess: (_result, variables) => {
      toast.success(t("password.locked"));
      onSuccess(variables.password);
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  const isPending = setNotePassword.isPending || setResetPin.isPending;

  const submit = () => {
    if (!password || !confirmPassword) {
      setError(t("password.passwordRequired"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("password.passwordsMismatch"));
      return;
    }
    if (!hasResetPin) {
      if (!/^\d{4,}$/.test(pin)) {
        setError(t("password.pinTooShort"));
        return;
      }
      if (pin !== confirmPin) {
        setError(t("password.pinsMismatch"));
        return;
      }
      setError(null);
      /* The note is encrypted in this mutation's `onSuccess`, not here — a PIN
         that failed to save must not leave an unrecoverable note behind. */
      setResetPin.mutate({ pin, confirmPin });
      return;
    }
    setError(null);
    setNotePassword.mutate({ noteId, password });
  };

  return (
    <NotesDialog
      icon={<Lock size={15} />}
      title={t("password.protect")}
      subtitle={t("password.protectDesc")}
      onClose={onClose}
      onSubmit={submit}
      initialFocusRef={passwordRef}
      /* Which branch the user is in is a fact worth showing rather than
         inferring from whether two extra fields appeared. */
      footerNote={
        pinKnown ? (
          hasResetPin ? (
            <Badge tone="ok" icon={<KeyRound size={9} />}>
              {t("password.resetPin")}
            </Badge>
          ) : (
            <Badge tone="lock" icon={<KeyRound size={9} />}>
              {t("password.pinLabel")}
            </Badge>
          )
        ) : null
      }
      actions={({ close }) => (
        <>
          <button type="button" onClick={close} className={BTN_GHOST}>
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={isPending || !pinKnown} className={BTN_ACCENT}>
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
            {isPending ? t("common.working") : t("actions.lock")}
          </button>
        </>
      )}
    >
      <DialogPasswordField
        id="notes-lock-password"
        label={t("password.newPassword")}
        value={password}
        onChange={(next) => {
          setPassword(next);
          setError(null);
        }}
        inputRef={passwordRef}
      />
      <DialogPasswordField
        id="notes-lock-confirm"
        label={t("password.confirmPassword")}
        value={confirmPassword}
        onChange={setConfirmPassword}
      />

      {pinKnown && !hasResetPin ? (
        <DialogBlock tone="warning" title={t("password.noPinTitle")} reveal>
          <p className="mb-3">{t("password.noPinBody")}</p>
          <DialogField id="notes-lock-pin" label={t("password.pinLabel")}>
            <input
              id="notes-lock-pin"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(event) => {
                setPin(event.target.value);
                setError(null);
              }}
              autoComplete="off"
              className={FIELD_INPUT}
            />
          </DialogField>
          <DialogField id="notes-lock-pin-confirm" label={t("password.pinConfirmLabel")}>
            <input
              id="notes-lock-pin-confirm"
              type="password"
              inputMode="numeric"
              value={confirmPin}
              onChange={(event) => setConfirmPin(event.target.value)}
              autoComplete="off"
              className={FIELD_INPUT}
            />
          </DialogField>
        </DialogBlock>
      ) : (
        <DialogBlock>{t("password.protectWarning")}</DialogBlock>
      )}

      {error && <DialogError>{error}</DialogError>}
    </NotesDialog>
  );
}
