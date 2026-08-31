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
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle } from "~/components/ui/icons";
import Link from "next/link";

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

  const resetPassword = api.note.resetPasswordWithPin.useMutation({
    onSuccess: () => {
      setSuccess(true);
      setTimeout(() => {
        router.push(`/notes/${noteId}`);
      }, 3000);
    },
    onError: (error) => {
      setError(error.message);
    },
  });

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
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="surface-card p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-error/15 rounded-full flex items-center justify-center mx-auto mb-4 border border-error/25">
            <AlertCircle className="text-error" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-fg-primary mb-2">{t("invalidTitle")}</h1>
          <p className="text-fg-secondary mb-6">
            {t("invalidBody")}
          </p>
          <Link
            href="/notes"
            className="inline-block px-6 py-3 bg-gradient-to-r from-accent-primary to-accent-secondary text-white font-semibold rounded-lg hover:shadow-lg hover:shadow-lg transition-all"
          >
            {t("goToNotes")}
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="surface-card p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-success/15 rounded-full flex items-center justify-center mx-auto mb-4 border border-success/25">
            <CheckCircle className="text-success" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-fg-primary mb-2">{t("successTitle")}</h1>
          <p className="text-fg-secondary mb-6">
            {t("successBody")}
          </p>
          <p className="text-sm text-fg-tertiary">
            {t("redirecting")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="surface-card p-8 max-w-md w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-accent-primary to-accent-secondary rounded-xl flex items-center justify-center shadow-sm">
            <Lock className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-fg-primary">{t("title")}</h1>
            <p className="text-sm text-fg-secondary">{t("subtitle")}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-error/10 border border-error/25 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircle size={18} className="text-error mt-0.5 flex-shrink-0" />
                <p className="text-sm text-fg-primary">{error}</p>
              </div>
            </div>
          )}

          <div>
            <label htmlFor="new-password" className="block text-sm font-semibold text-fg-primary mb-2">
              {t("newPasswordLabel")}
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("newPasswordPlaceholder")}
                className="w-full p-3 pr-12 bg-bg-surface/60 border border-border-light/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary/30 focus:border-accent-primary/50 text-fg-primary placeholder:text-fg-tertiary"
                disabled={resetPassword.isPending}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-tertiary hover:text-fg-primary"
                aria-label={showPassword ? t("hide") : t("show")}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-semibold text-fg-primary mb-2">
              {t("confirmPasswordLabel")}
            </label>
            <div className="relative">
              <input
                id="confirm-password"
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t("confirmPasswordPlaceholder")}
                className="w-full p-3 pr-12 bg-bg-surface/60 border border-border-light/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary/30 focus:border-accent-primary/50 text-fg-primary placeholder:text-fg-tertiary"
                disabled={resetPassword.isPending}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-tertiary hover:text-fg-primary"
                aria-label={showConfirmPassword ? t("hide") : t("show")}
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="reset-pin" className="block text-sm font-semibold text-fg-primary mb-2">
              {t("pinLabel")}
            </label>
            <input
              id="reset-pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={resetPin}
              onChange={(e) => setResetPin(e.target.value)}
              placeholder={t("pinPlaceholder")}
              className="w-full p-3 bg-bg-surface/60 border border-border-light/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary/30 focus:border-accent-primary/50 text-fg-primary placeholder:text-fg-tertiary"
              disabled={resetPassword.isPending}
            />
            <p className="mt-1 text-xs text-fg-tertiary">
              {t("pinHelp")}
            </p>
          </div>

          <div className="bg-accent-primary/5 border border-accent-primary/20 rounded-lg p-4">
            <p className="text-sm text-fg-secondary">
              💡 <strong className="text-fg-primary">{t("tipLabel")}</strong> {t("tipBody")}
            </p>
          </div>

          <button
            type="submit"
            disabled={resetPassword.isPending || !newPassword || !confirmPassword || !resetPin}
            className="w-full px-6 py-3 bg-gradient-to-r from-accent-primary to-accent-secondary text-white font-semibold rounded-lg hover:shadow-xl hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Lock size={18} />
            {resetPassword.isPending ? t("submitting") : t("submit")}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-border-light/40 text-center">
          <Link
            href="/notes"
            className="text-sm text-accent-primary hover:text-accent-hover font-medium transition-colors"
          >
            {t("backToNotes")}
          </Link>
        </div>
      </div>
    </div>
  );
}
