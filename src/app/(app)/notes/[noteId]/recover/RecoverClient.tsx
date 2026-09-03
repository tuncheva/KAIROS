"use client";

/**
 * Recovering a note whose password is gone.
 *
 * This lived at `/reset-password`, which promises to reset the password on
 * your *account* — that lives inside `SignInModal` — so people arrived here
 * with the wrong expectation and left without doing either. It is now a child
 * of the note it recovers, which is also what makes `noteId` a route param
 * rather than a query string that could simply be absent.
 *
 * The PIN is the credential. An emailed token was drafted for this page and
 * `email.ts` still built a URL carrying one, but nothing ever called the
 * sender and no token was ever issued or stored — see the note on
 * `sendPasswordResetEmail`. Honouring a token requires first minting one, and
 * that is a feature rather than a fix.
 *
 * It was also the one page in the feature that never got the same care as the
 * rest, and it is the first thing a locked-out user sees: `.surface-card` with
 * its hover-lift, two `bg-gradient-to-r` buttons, `p-3` inputs with a focus
 * ring matching nothing else in notes, a duplicated `hover:shadow-lg`, and a
 * literal 💡 in the tip box. It now uses the same fields, buttons, discs and
 * blocks as the dialogs it is reached from — and the three-second redirect,
 * which used to be a silent `setTimeout`, counts down where you can see it.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle, KeyRound, Loader2 } from "~/components/ui/icons";
import Link from "next/link";

import {
  Badge,
  BTN_ACCENT,
  FIELD,
  FIELD_INPUT,
  FIELD_LABEL,
  MICRO,
} from "~/components/notes/notesUi";

/** Matches the redirect below, and is what the countdown counts. */
const REDIRECT_SECONDS = 3;

export function RecoverClient({ noteId }: { noteId: string }) {
  const t = useTranslations("notes.recover");
  const router = useRouter();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetPin, setResetPin] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [remaining, setRemaining] = useState(REDIRECT_SECONDS);

  const resetPassword = api.note.resetPasswordWithPin.useMutation({
    onSuccess: () => setSuccess(true),
    onError: (mutationError) => setError(mutationError.message),
  });

  /* The redirect and the countdown are the same clock, so what the page says is
     what it does. Previously the navigation was a bare `setTimeout` inside
     `onSuccess` and the copy claiming it was happening was static. */
  useEffect(() => {
    if (!success) return;
    const tick = setInterval(() => setRemaining((n) => Math.max(0, n - 1)), 1000);
    const go = setTimeout(() => router.push(`/notes/${noteId}`), REDIRECT_SECONDS * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(go);
    };
  }, [success, noteId, router]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!noteId) {
      setError(t("invalidLink"));
      return;
    }

    if (!newPassword || newPassword.length < 1) {
      setError(t("passwordEmpty"));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("passwordsMismatch"));
      return;
    }

    if (!resetPin || resetPin.length < 4 || !/^\d+$/.test(resetPin)) {
      setError(t("pinTooShort"));
      return;
    }

    resetPassword.mutate({
      noteId: parseInt(noteId),
      newPassword: newPassword,
      resetPin: resetPin,
    });
  };

  if (!noteId) {
    return (
      <Outcome
        tone="error"
        icon={<AlertCircle size={22} />}
        title={t("invalidTitle")}
        body={t("invalidBody")}
      >
        <Link href="/notes" className={BTN_ACCENT}>
          {t("goToNotes")}
        </Link>
      </Outcome>
    );
  }

  if (success) {
    return (
      <Outcome
        tone="success"
        icon={<CheckCircle size={22} />}
        title={t("successTitle")}
        body={t("successBody")}
      >
        <span className={`${MICRO} tabular-nums`}>
          {remaining > 0 ? `${t("redirecting")} ${remaining}s` : t("redirecting")}
        </span>
      </Outcome>
    );
  }

  return (
    <div className="flex min-h-full items-start justify-center p-4 py-10 sm:py-16">
      <div className="notes-pane-in w-full max-w-[420px]">
        <Badge tone="share" icon={<KeyRound size={9} />}>
          {t("pinLabel")}
        </Badge>
        <h1 className="mt-3.5 font-display text-[30px] leading-[1.12] font-normal tracking-[-0.012em] text-fg-primary">
          {t("title")}
        </h1>
        <p className="mt-2 mb-6 text-[13.5px] leading-relaxed text-fg-tertiary">{t("subtitle")}</p>

        <div className="rounded-xl border border-border-light/60 bg-bg-elevated p-5">
          <form onSubmit={handleSubmit}>
            {error && (
              <div
                role="alert"
                className="calendar-pop mb-4 flex items-start gap-2 rounded-[10px] border border-error/30 bg-error/[0.06] p-3.5"
              >
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-error" />
                <p className="text-[12.5px] leading-relaxed text-fg-secondary">{error}</p>
              </div>
            )}

            <div className="mb-3.5">
              <label htmlFor="new-password" className={FIELD_LABEL}>
                {t("newPasswordLabel")}
              </label>
              <div className={FIELD}>
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("newPasswordPlaceholder")}
                  autoComplete="new-password"
                  className={FIELD_INPUT}
                  disabled={resetPassword.isPending}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="kairos-tap grid h-6 w-6 flex-none place-items-center rounded-md text-fg-tertiary transition-colors hover:text-fg-primary"
                  aria-label={showPassword ? t("hide") : t("show")}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div className="mb-3.5">
              <label htmlFor="confirm-password" className={FIELD_LABEL}>
                {t("confirmPasswordLabel")}
              </label>
              <div className={FIELD}>
                <input
                  id="confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t("confirmPasswordPlaceholder")}
                  autoComplete="new-password"
                  className={FIELD_INPUT}
                  disabled={resetPassword.isPending}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="kairos-tap grid h-6 w-6 flex-none place-items-center rounded-md text-fg-tertiary transition-colors hover:text-fg-primary"
                  aria-label={showConfirmPassword ? t("hide") : t("show")}
                >
                  {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div className="mb-3.5">
              <label htmlFor="reset-pin" className={FIELD_LABEL}>
                {t("pinLabel")}
              </label>
              <div className={FIELD}>
                <input
                  id="reset-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={resetPin}
                  onChange={(e) => setResetPin(e.target.value)}
                  placeholder={t("pinPlaceholder")}
                  autoComplete="off"
                  className={FIELD_INPUT}
                  disabled={resetPassword.isPending}
                />
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg-quaternary">{t("pinHelp")}</p>
            </div>

            {/* The tip, without the emoji, on the same calm block the dialogs
                use for a fact worth reading before the button. */}
            <div className="mt-4 rounded-[10px] border border-border-light/70 bg-bg-secondary p-3.5">
              <p className="text-[12.5px] font-bold tracking-[-0.005em] text-fg-secondary">
                {t("tipLabel")}
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-fg-tertiary">{t("tipBody")}</p>
            </div>

            <button
              type="submit"
              disabled={resetPassword.isPending || !newPassword || !confirmPassword || !resetPin}
              className={`${BTN_ACCENT} mt-5 h-[38px] w-full`}
            >
              {resetPassword.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Lock size={14} />
              )}
              {resetPassword.isPending ? t("submitting") : t("submit")}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center">
          <Link
            href="/notes"
            className="font-mono text-[9.5px] tracking-[0.12em] uppercase text-fg-tertiary transition-colors hover:text-fg-primary"
          >
            {t("backToNotes")}
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * The two terminal states.
 *
 * Same outlined disc as every empty state and the lock gate, rather than the
 * two filled `w-16 h-16` circles this page used to carry — which were the only
 * two of that size anywhere in the feature.
 */
function Outcome({
  tone,
  icon,
  title,
  body,
  children,
}: {
  tone: "error" | "success";
  icon: React.ReactNode;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  const tones = {
    error: "border-error/35 text-error",
    success: "border-success/40 text-success",
  } as const;

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="notes-pane-in w-full max-w-[380px] rounded-xl border border-border-light/60 bg-bg-elevated p-8 text-center">
        <div
          className={`notes-disc-in mx-auto mb-4 grid h-[54px] w-[54px] place-items-center rounded-full border ${tones[tone]}`}
        >
          {icon}
        </div>
        <h1 className="text-[17px] font-bold tracking-[-0.014em] text-fg-primary">{title}</h1>
        <p className="mt-2 mb-6 text-[13px] leading-relaxed text-fg-tertiary">{body}</p>
        {children}
      </div>
    </div>
  );
}
