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
 *
 * A rejected password used to be reported only in text, so nothing told you the
 * keystroke had been refused until you read the line — which, for the most
 * repeated interaction on this surface, is the wrong way round. The field
 * shakes now, replayed per attempt rather than per message: two identical wrong
 * guesses produce the same error string, and a CSS animation keyed on the
 * string alone would fire once and then sit still.
 */

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Eye, EyeOff, Loader2, Lock } from "~/components/ui/icons";

import { BTN_ACCENT, FIELD, FIELD_INPUT } from "./notesUi";

export function LockGate({
  password,
  onPasswordChange,
  reveal,
  onToggleReveal,
  error,
  attempt,
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
  /** Counts refusals for this note. Drives the shake; see the note above. */
  attempt: number;
  isPending: boolean;
  /** Only the owner can reset — a write share does not grant that. */
  canReset: boolean;
  onUnlock: () => void;
  onResetPassword: () => void;
  subtitle: string;
}) {
  const t = useTranslations("notes");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fieldRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* Removing the class, forcing a reflow and adding it back is what restarts a
     CSS animation that is already on the element. The alternative — remounting
     the field with a changing `key` — would restart it too, but would also take
     focus out of the input the user is about to retype into. */
  useEffect(() => {
    if (attempt === 0 || !error) return;
    const el = fieldRef.current;
    if (!el) return;
    el.classList.remove("notes-shake");
    void el.offsetWidth;
    el.classList.add("notes-shake");
  }, [attempt, error]);

  return (
    <div className="grid min-h-0 flex-1 place-items-center p-6">
      <form
        className="notes-pane-in w-full max-w-[308px] text-center"
        onSubmit={(event) => {
          event.preventDefault();
          if (password && !isPending) onUnlock();
        }}
      >
        {/* An outlined disc, the same shape every empty state and dialog icon
            tile on this surface now uses — rather than a filled `rounded-2xl`
            tile that appeared nowhere else. */}
        <div className="mx-auto mb-4 grid h-[54px] w-[54px] place-items-center rounded-full border border-error/35 text-error">
          <Lock size={22} />
        </div>

        <h2 className="text-[15.5px] font-bold tracking-[-0.012em] text-fg-primary">
          {t("password.gateTitle")}
        </h2>
        <p className="mt-2 mb-5 text-[13px] leading-relaxed text-fg-tertiary">{subtitle}</p>

        <div ref={fieldRef} className={`${FIELD} ${error ? "border-error/55" : ""}`}>
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
            className={`${FIELD_INPUT} text-left`}
          />
          <button
            type="button"
            onClick={onToggleReveal}
            aria-label={reveal ? t("password.hide") : t("password.show")}
            className="kairos-tap grid h-6 w-6 flex-none place-items-center rounded-md text-fg-tertiary transition-colors hover:text-fg-primary"
          >
            {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>

        {error && (
          <p
            id="notes-unlock-error"
            role="alert"
            className="calendar-pop mt-2 flex items-center justify-center gap-1.5 text-[12px] text-error"
          >
            <AlertCircle size={12} /> {error}
          </p>
        )}

        <button type="submit" disabled={!password || isPending} className={`${BTN_ACCENT} mt-3 h-[38px] w-full`}>
          {isPending && <Loader2 size={13} className="animate-spin" />}
          {isPending ? t("actions.unlocking") : t("actions.unlock")}
        </button>

        {canReset && (
          <p className="mt-3.5 text-[11.5px] text-fg-quaternary">
            {t("password.forgot")}{" "}
            <button
              type="button"
              onClick={onResetPassword}
              className="font-mono text-[9.5px] tracking-[0.12em] uppercase text-accent-primary transition-colors hover:text-accent-hover"
            >
              {t("password.resetWithPin")}
            </button>
          </p>
        )}
      </form>
    </div>
  );
}
