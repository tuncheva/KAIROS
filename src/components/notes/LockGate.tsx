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
    <div className="grid min-h-0 flex-1 place-items-center p-6 pb-[60px]">
      <form
        className="notes-pane-in flex w-full max-w-[360px] flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (password && !isPending) onUnlock();
        }}
      >
        {/* A plain glyph, not a disc — the quiet gate leads with the note's own
            title set in the serif, the way the design draws it. */}
        <Lock size={16} className="mb-5 text-fg-tertiary" aria-hidden="true" />

        <h2 className="note-serif text-[30px] leading-[1.15] font-medium tracking-[-0.015em] text-fg-primary">
          {t("password.gateTitle")}
        </h2>
        <p className="mt-2.5 mb-6 text-[13.5px] leading-relaxed text-fg-tertiary">{subtitle}</p>

        <div ref={fieldRef} className={`${FIELD} h-[44px] pr-1.5 ${error ? "border-error/55" : ""}`}>
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
            className={FIELD_INPUT}
          />
          <button
            type="button"
            onClick={onToggleReveal}
            aria-label={reveal ? t("password.hide") : t("password.show")}
            className="kairos-tap grid h-7 w-7 flex-none place-items-center rounded-md text-fg-tertiary transition-colors hover:text-fg-primary"
          >
            {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button type="submit" disabled={!password || isPending} className={`${BTN_ACCENT} h-[30px] flex-none px-3`}>
            {isPending && <Loader2 size={12} className="animate-spin" />}
            {isPending ? t("actions.unlocking") : t("actions.unlock")}
          </button>
        </div>

        {error && (
          <p
            id="notes-unlock-error"
            role="alert"
            className="calendar-pop mt-2.5 flex items-center gap-1.5 text-[12.5px] text-error"
          >
            <AlertCircle size={12} className="flex-none" /> {error}
          </p>
        )}

        {canReset && (
          <p className="mt-[18px] text-[12.5px] text-fg-tertiary">
            {t("password.forgot")}{" "}
            <button
              type="button"
              onClick={onResetPassword}
              className="text-fg-primary underline decoration-border-strong underline-offset-[3px] transition-colors hover:decoration-accent-primary"
            >
              {t("password.resetWithPin")}
            </button>
          </p>
        )}
      </form>
    </div>
  );
}
