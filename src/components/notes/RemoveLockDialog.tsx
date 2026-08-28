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
 * the thing the lock was for.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Eye, EyeOff, LockOpen, X } from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";

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
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLFormElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

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
    if (!password) {
      setError(t("password.passwordRequired"));
      return;
    }
    setError(null);
    removePassword.mutate({ noteId, password });
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
        aria-labelledby="notes-unlock-title"
        className="w-full max-w-md p-6 rounded-2xl bg-bg-elevated kairos-menu-surface"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-accent-primary/12 grid place-items-center">
            <LockOpen size={16} className="text-accent-primary" />
          </div>
          <div className="flex-1">
            <h2 id="notes-unlock-title" className="text-base font-bold text-fg-primary">
              {t("password.remove")}
            </h2>
            <p className="text-xs text-fg-tertiary">{t("password.removeDesc")}</p>
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

        {knownPassword === undefined && (
          <div>
            <label
              htmlFor="notes-unlock-password"
              className="block text-xs font-semibold text-fg-secondary mb-1.5"
            >
              {t("password.enterPassword")}
            </label>
            <div className="relative">
              <input
                id="notes-unlock-password"
                ref={passwordRef}
                type={reveal ? "text" : "password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(null);
                }}
                autoComplete="current-password"
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
        )}

        <p className="mt-3.5 text-xs text-fg-tertiary">{t("password.removeWarning")}</p>

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
            disabled={removePassword.isPending}
            className="flex-1 px-4 py-2.5 rounded-xl bg-accent-primary text-white text-sm font-semibold hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {removePassword.isPending ? t("common.working") : t("password.remove")}
          </button>
        </div>
      </form>
    </div>
  );
}
