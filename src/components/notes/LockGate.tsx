"use client";

/**
 * The unlock prompt for an encrypted note.
 *
 * It renders inside the page pane rather than as a modal over a black scrim.
 * The mechanism behind it is unchanged — Argon2 verification server-side, the
 * ciphertext never leaves the server, two failures offer the PIN reset — but a
 * locked note is now just a note you have not opened yet, so the list stays
 * visible and the next note is one click away.
 *
 * Everything shown above the field is metadata `getAll` already returns for a
 * protected note. Nothing here is decrypted.
 */

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Eye, EyeOff, Loader2, Lock } from "~/components/ui/icons";

export function LockGate({
  password,
  onPasswordChange,
  reveal,
  onToggleReveal,
  error,
  isPending,
  canReset,
  onUnlock,
  onResetPassword,
  subtitle,
}: {
  password: string;
  onPasswordChange: (next: string) => void;
  reveal: boolean;
  onToggleReveal: () => void;
  error: string | null;
  isPending: boolean;
  /** Only the owner can reset — a write share does not grant that. */
  canReset: boolean;
  onUnlock: () => void;
  onResetPassword: () => void;
  subtitle: string;
}) {
  const t = useTranslations("notes");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex-1 min-h-0 grid place-items-center p-6">
      <form
        className="w-full max-w-[300px] text-center"
        onSubmit={(event) => {
          event.preventDefault();
          if (password && !isPending) onUnlock();
        }}
      >
        <div className="w-[52px] h-[52px] rounded-2xl bg-error/10 text-error grid place-items-center mx-auto mb-3.5">
          <Lock size={22} />
        </div>

        <h2 className="text-lg font-bold text-fg-primary">{t("password.gateTitle")}</h2>
        <p className="mt-1 mb-4 text-xs text-fg-tertiary leading-relaxed">{subtitle}</p>

        <div className="relative">
          <input
            ref={inputRef}
            type={reveal ? "text" : "password"}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder={t("password.enterPassword")}
            aria-label={t("password.enterPassword")}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "notes-unlock-error" : undefined}
            autoComplete="off"
            className="w-full text-left pl-3.5 pr-10 py-2.5 text-sm bg-bg-secondary rounded-xl text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/35"
          />
          <button
            type="button"
            onClick={onToggleReveal}
            aria-label={reveal ? t("password.hide") : t("password.show")}
            className="kairos-tap absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-fg-tertiary hover:text-fg-primary transition-colors"
          >
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        {error && (
          <p
            id="notes-unlock-error"
            role="alert"
            className="flex items-center justify-center gap-1.5 mt-2 text-xs text-error"
          >
            <AlertCircle size={12} /> {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!password || isPending}
          className="w-full mt-2.5 py-2.5 rounded-xl bg-accent-primary text-white text-sm font-semibold shadow-lg hover:bg-accent-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isPending && <Loader2 size={14} className="animate-spin" />}
          {isPending ? t("actions.unlocking") : t("actions.unlock")}
        </button>

        {canReset && (
          <p className="mt-3 text-[11px] text-fg-quaternary">
            {t("password.forgot")}{" "}
            <button
              type="button"
              onClick={onResetPassword}
              className="text-accent-primary font-semibold hover:underline"
            >
              {t("password.resetWithPin")}
            </button>
          </p>
        )}
      </form>
    </div>
  );
}
