"use client";

/**
 * Resetting a forgotten note password with the account's recovery PIN.
 *
 * This is the only route back into an encrypted note, and it stays exactly as
 * it was: the PIN is checked server-side, the note is re-encrypted under the
 * new password, and there is no path that reveals the old one. Only the
 * chrome around it changed.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Eye, EyeOff, KeyRound, X } from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";

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
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLFormElement | null>(null);
  const pinRef = useRef<HTMLInputElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

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

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    pinRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
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

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 grid place-items-center p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notes-reset-title"
        className="w-full max-w-md p-6 rounded-2xl bg-bg-elevated kairos-system-card-elevated"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-accent-primary/12 grid place-items-center">
            <KeyRound size={16} className="text-accent-primary" />
          </div>
          <div className="flex-1">
            <h2 id="notes-reset-title" className="text-base font-bold text-fg-primary">
              {t("password.resetPassword")}
            </h2>
            <p className="text-xs text-fg-tertiary">{t("password.enterSecretPin")}</p>
          </div>
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
            <label htmlFor="notes-reset-pin" className="block text-xs font-semibold text-fg-secondary mb-1.5">
              {t("password.resetPin")}
            </label>
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
              className="w-full px-3.5 py-2.5 text-sm bg-bg-secondary rounded-lg text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/35"
            />
            {hint && <p className="mt-1.5 text-xs text-fg-tertiary italic">{t("password.hint", { hint })}</p>}
          </div>

          <div>
            <label
              htmlFor="notes-reset-password"
              className="block text-xs font-semibold text-fg-secondary mb-1.5"
            >
              {t("password.newPassword")}
            </label>
            <div className="relative">
              <input
                id="notes-reset-password"
                type={reveal ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                className="w-full px-3.5 py-2.5 pr-10 text-sm bg-bg-secondary rounded-lg text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/35"
              />
              <button
                type="button"
                onClick={() => setReveal((value) => !value)}
                aria-label={reveal ? t("password.hide") : t("password.show")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-fg-tertiary hover:text-fg-primary transition-colors"
              >
                {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="notes-reset-confirm"
              className="block text-xs font-semibold text-fg-secondary mb-1.5"
            >
              {t("password.confirmPassword")}
            </label>
            <input
              id="notes-reset-confirm"
              type={reveal ? "text" : "password"}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              className="w-full px-3.5 py-2.5 text-sm bg-bg-secondary rounded-lg text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/35"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="flex items-center gap-1.5 mt-3.5 text-xs text-error">
            <AlertCircle size={12} /> {error}
          </p>
        )}

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
            disabled={resetPassword.isPending}
            className="flex-1 px-4 py-2.5 rounded-xl bg-accent-primary text-white text-sm font-semibold hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {resetPassword.isPending ? t("password.resetting") : t("password.resetPassword")}
          </button>
        </div>
      </form>
    </div>
  );
}
