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
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Eye, EyeOff, Lock, X } from "lucide-react";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";

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
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLFormElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const setNotePassword = api.note.setPassword.useMutation({
    onSuccess: (_result, variables) => {
      toast.success(t("password.locked"));
      onSuccess(variables.password);
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    passwordRef.current?.focus();

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
    if (!password || !confirmPassword) {
      setError(t("password.passwordRequired"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("password.passwordsMismatch"));
      return;
    }
    setError(null);
    setNotePassword.mutate({ noteId, password });
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
        aria-labelledby="notes-lock-title"
        className="w-full max-w-md p-6 rounded-2xl bg-bg-elevated kairos-menu-surface"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-accent-primary/12 grid place-items-center">
            <Lock size={16} className="text-accent-primary" />
          </div>
          <div className="flex-1">
            <h2 id="notes-lock-title" className="text-base font-bold text-fg-primary">
              {t("password.protect")}
            </h2>
            <p className="text-xs text-fg-tertiary">{t("password.protectDesc")}</p>
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
            <label htmlFor="notes-lock-password" className="block text-xs font-semibold text-fg-secondary mb-1.5">
              {t("password.newPassword")}
            </label>
            <div className="relative">
              <input
                id="notes-lock-password"
                ref={passwordRef}
                type={reveal ? "text" : "password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(null);
                }}
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
            <label htmlFor="notes-lock-confirm" className="block text-xs font-semibold text-fg-secondary mb-1.5">
              {t("password.confirmPassword")}
            </label>
            <input
              id="notes-lock-confirm"
              type={reveal ? "text" : "password"}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              className="w-full px-3.5 py-2.5 text-sm bg-bg-secondary rounded-lg text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/35"
            />
          </div>
        </div>

        <p className="mt-3.5 text-xs text-fg-tertiary">{t("password.protectWarning")}</p>

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
            disabled={setNotePassword.isPending}
            className="flex-1 px-4 py-2.5 rounded-xl bg-accent-primary text-white text-sm font-semibold hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {setNotePassword.isPending ? t("common.working") : t("actions.lock")}
          </button>
        </div>
      </form>
    </div>
  );
}
