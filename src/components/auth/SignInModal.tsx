"use client";

import { signIn } from "next-auth/react";
import { X, Loader2, Eye, EyeOff, ArrowRight, ArrowLeft, KeyRound, Check } from "lucide-react";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import Image from "next/image";
import { useTranslations } from "next-intl";

/* ─── Types ─── */
type ModalView =
  | "signIn"
  | "signUp"
  | "verifyEmailSent"
  | "forgotPassword"
  | "resetCode"
  | "newPassword"
  | "done";

/** Which views show the sign in / sign up tab pair. */
const TABBED: ReadonlySet<ModalView> = new Set<ModalView>(["signIn", "signUp"]);

export function SignInModal({
  isOpen,
  onClose,
  initialEmail,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialEmail?: string;
}) {
  const t = useTranslations("auth.modal");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadingMessage, setLoadingMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [view, setView] = useState<ModalView>("signIn");

  /* The panel slides in from the side the tab sits on, and the dot follows the
     hovered tab rather than the active one while the pointer is over them. */
  const [slide, setSlide] = useState<"from-left" | "from-right">("from-left");
  const [hoveredTab, setHoveredTab] = useState<"signIn" | "signUp" | null>(null);

  /* Forgot password state */
  const [enteredCode, setEnteredCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const codeInputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const router = useRouter();
  const signupMutation = api.auth.signup.useMutation();
  const resendVerificationMutation = api.auth.resendVerification.useMutation();
  const requestResetMutation = api.auth.requestPasswordReset.useMutation();
  const verifyCodeMutation = api.auth.verifyResetCode.useMutation();
  const resetPasswordMutation = api.auth.resetPassword.useMutation();

  /* Handle code input (8 separate boxes) */
  const handleCodeInput = useCallback((index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const char = value.slice(-1);
    setEnteredCode((prev) => {
      const arr = prev.split("");
      arr[index] = char;
      return arr.join("").slice(0, 8);
    });
    if (char && index < 7) {
      codeInputsRef.current[index + 1]?.focus();
    }
  }, []);

  const handleCodeKeyDown = useCallback((index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !enteredCode[index] && index > 0) {
      codeInputsRef.current[index - 1]?.focus();
    }
  }, [enteredCode]);

  const handleCodePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 8);
    setEnteredCode(pasted);
    const nextIndex = Math.min(pasted.length, 7);
    codeInputsRef.current[nextIndex]?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (!initialEmail) return;
    setEmail(initialEmail);
  }, [isOpen, initialEmail]);

  /* Reset everything when modal closes */
  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setEmail(initialEmail ?? "");
        setPassword("");
        setName("");
        setError("");
        setLoadingMessage("");
        setShowPassword(false);
        setAgreeTerms(false);
        setEnteredCode("");
        setNewPassword("");
        setConfirmPassword("");
        setShowNewPassword(false);
        setShowConfirmPassword(false);
        setView("signIn");
        setSlide("from-left");
        setHoveredTab(null);
      }, 200);
      return () => clearTimeout(t);
    }
  }, [isOpen, initialEmail]);

  /* ─── Early return AFTER all hooks ─── */
  if (!isOpen) return null;

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setLoadingMessage(t("signIn.verifyingCredentials"));

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(t("signIn.invalidCredentials"));
      } else {
        onClose();
        router.push("/");
        router.refresh();
      }
    } catch (error) {
      console.error("Sign in error:", error);
      setError(t("signIn.error"));
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      await signupMutation.mutateAsync({
        email,
        password,
        name: name || undefined,
      });

      // No automatic sign-in any more: the account starts unverified and
      // credentials sign-in is refused until the emailed link is redeemed, so
      // attempting it here would only ever produce a confusing failure.
      setPassword("");
      setView("verifyEmailSent");
    } catch (error) {
      console.error("Sign up error:", error);
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError(t("signUp.error"));
      }
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  const handleGoogleSignIn = async () => {
    await signIn("google", { callbackUrl: "/" });
  };

  const resetForm = () => {
    setEmail(initialEmail ?? "");
    setPassword("");
    setName("");
    setError("");
    setLoadingMessage("");
    setShowPassword(false);
    setAgreeTerms(false);
    setEnteredCode("");
    setNewPassword("");
    setConfirmPassword("");
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  /** Move to `next`, sliding the panel in from whichever tab it belongs to. */
  const goTo = (next: ModalView) => {
    if (next === "signIn" || next === "signUp") {
      setSlide(next === "signUp" ? "from-right" : "from-left");
    }
    setError("");
    setView(next);
  };

  const goToTab = (next: "signIn" | "signUp") => {
    resetForm();
    goTo(next);
  };

  const handleSendResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError(t("forgotPassword.emailRequired"));
      return;
    }
    setIsLoading(true);
    setError("");
    setLoadingMessage(t("forgotPassword.sendingCode"));

    try {
      await requestResetMutation.mutateAsync({ email });
      setIsLoading(false);
      setLoadingMessage("");
      setView("resetCode");
    } catch (err) {
      setIsLoading(false);
      setLoadingMessage("");
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t("forgotPassword.sendFailed"));
      }
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await verifyCodeMutation.mutateAsync({ email, code: enteredCode });
      setIsLoading(false);
      setView("newPassword");
    } catch {
      setIsLoading(false);
      setError(t("resetCode.invalid"));
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError(t("newPassword.minLength"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("newPassword.mismatch"));
      return;
    }

    setIsLoading(true);
    setLoadingMessage(t("newPassword.resetting"));

    try {
      await resetPasswordMutation.mutateAsync({
        email,
        code: enteredCode,
        newPassword,
      });

      setIsLoading(false);
      setLoadingMessage("");
      setView("done");
    } catch (err) {
      setIsLoading(false);
      setLoadingMessage("");
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t("newPassword.failed"));
      }
    }
  };

  const handleBackToSignIn = () => {
    resetForm();
    goTo("signIn");
  };

  /* ─── Shared bits ─── */
  const eyebrowClass = "font-mono text-[11px] uppercase tracking-[0.2em] text-accent-primary";
  const primaryBtnClass =
    "k-btn flex items-center justify-center gap-2.5 rounded-xl bg-accent-primary px-7 py-4 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-40";
  const backLinkClass =
    "k-auth-lnk flex items-center gap-1.5 self-start text-sm text-white/55";

  const passwordEye = (shown: boolean, toggle: () => void) => (
    <button className="k-auth-eye" type="button" onClick={toggle} tabIndex={-1} aria-label={t("signIn.passwordLabel")}>
      {shown ? <Eye size={18} /> : <EyeOff size={18} />}
    </button>
  );

  const backToSignIn = () => (
    <button type="button" onClick={handleBackToSignIn} className={backLinkClass}>
      <ArrowLeft size={14} />
      {t("backToSignIn")}
    </button>
  );

  /* Eyebrow / title / subtitle for the current view. */
  const copy: Record<ModalView, { step: string; title: string; sub: string }> = {
    signIn: { step: t("steps.signIn"), title: t("signIn.title"), sub: t("signIn.subtitle") },
    signUp: { step: t("steps.signUp"), title: t("signUp.title"), sub: t("signUp.subtitle") },
    verifyEmailSent: {
      step: t("steps.verifyEmail"),
      title: t("verifyEmail.title"),
      sub: t("verifyEmail.subtitle", { email }),
    },
    forgotPassword: {
      step: t("steps.forgotPassword"),
      title: t("forgotPassword.title"),
      sub: t("forgotPassword.subtitle"),
    },
    resetCode: {
      step: t("steps.resetCode"),
      title: t("resetCode.title"),
      sub: t("resetCode.subtitle", { email }),
    },
    newPassword: {
      step: t("steps.newPassword"),
      title: t("newPassword.title"),
      sub: t("newPassword.subtitle"),
    },
    done: { step: t("steps.done"), title: t("done.title"), sub: t("done.subtitle") },
  };

  /* ─── Views ─── */
  const renderSignIn = () => (
    <div className={`k-auth-body k-auth-${slide} mt-8 flex flex-col gap-6`}>
      <input
        className="k-auth-fld"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("signIn.emailPlaceholder")}
        aria-label={t("signIn.emailLabel")}
        autoComplete="email"
        required
        disabled={isLoading}
      />

      <div className="k-auth-fld-row">
        <input
          className="k-auth-fld"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("signIn.passwordLabel")}
          aria-label={t("signIn.passwordLabel")}
          autoComplete="current-password"
          required
          disabled={isLoading}
        />
        {passwordEye(showPassword, () => setShowPassword(!showPassword))}
      </div>

      <div className="flex items-center gap-4">
        <button type="submit" disabled={isLoading} className={`${primaryBtnClass} flex-1`}>
          {isLoading ? (
            <><Loader2 className="animate-spin" size={18} />{t("signIn.signingIn")}</>
          ) : (
            <>{t("signIn.submit")}<ArrowRight size={17} /></>
          )}
        </button>
        <button
          type="button"
          onClick={() => goTo("forgotPassword")}
          className="k-auth-lnk whitespace-nowrap text-sm text-white/55"
        >
          {t("signIn.forgotPassword")}
        </button>
      </div>

      <button
        type="button"
        onClick={() => void handleGoogleSignIn()}
        disabled={isLoading}
        className="k-ghost flex w-full items-center justify-center gap-2.5 rounded-xl border border-white/[0.14] bg-transparent px-4 py-3.5 text-[15px] font-semibold text-white/85 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg className="k-brand-mark" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        {t("google")}
      </button>
    </div>
  );

  const renderSignUp = () => (
    <div className={`k-auth-body k-auth-${slide} mt-8 flex flex-col gap-6`}>
      <div className="grid gap-5 sm:grid-cols-2">
        <input
          className="k-auth-fld"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("signUp.fullNamePlaceholder")}
          aria-label={t("signUp.fullNameLabel")}
          autoComplete="name"
          disabled={isLoading}
        />
        <input
          className="k-auth-fld"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("signIn.emailPlaceholder")}
          aria-label={t("signIn.emailLabel")}
          autoComplete="email"
          required
          disabled={isLoading}
        />
      </div>

      <div className="k-auth-fld-row">
        <input
          className="k-auth-fld"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("signUp.passwordPlaceholder")}
          aria-label={t("signIn.passwordLabel")}
          autoComplete="new-password"
          required
          minLength={8}
          disabled={isLoading}
        />
        {passwordEye(showPassword, () => setShowPassword(!showPassword))}
      </div>

      <button type="submit" disabled={isLoading || !agreeTerms} className={`${primaryBtnClass} w-full`}>
        {isLoading ? (
          <><Loader2 className="animate-spin" size={18} />{t("signUp.creatingAccount")}</>
        ) : (
          <>{t("signUp.submit")}<ArrowRight size={17} /></>
        )}
      </button>

      {/* Consent stays an explicit opt-in — the button is gated on it. */}
      <label className="group flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed text-white/50">
        <input
          type="checkbox"
          checked={agreeTerms}
          onChange={(e) => setAgreeTerms(e.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors duration-200 ${
            agreeTerms
              ? "border-accent-primary bg-accent-primary"
              : "border-white/20 group-hover:border-white/40"
          }`}
        >
          {agreeTerms && <Check size={11} strokeWidth={3} className="text-white" />}
        </span>
        <span>
          {t("signUp.agreeTerms")}{" "}
          <a href="/terms" className="text-accent-primary underline underline-offset-2">{t("signUp.termsOfService")}</a>{" "}
          {t("signUp.and")}{" "}
          <a href="/privacy" className="text-accent-primary underline underline-offset-2">{t("signUp.privacyPolicy")}</a>.
        </span>
      </label>
    </div>
  );

  const renderForgotPassword = () => (
    <div className="k-auth-body mt-9 flex flex-col gap-6">
      <input
        className="k-auth-fld"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("signIn.emailPlaceholder")}
        aria-label={t("signIn.emailLabel")}
        autoComplete="email"
        required
        disabled={isLoading}
      />
      <button type="submit" disabled={isLoading} className={`${primaryBtnClass} w-full`}>
        {isLoading ? (
          <><Loader2 className="animate-spin" size={18} />{t("forgotPassword.sendingCode")}</>
        ) : (
          <>{t("forgotPassword.submit")}<ArrowRight size={17} /></>
        )}
      </button>
      {backToSignIn()}
    </div>
  );

  const renderResetCode = () => (
    <div className="k-auth-body mt-9 flex flex-col gap-7">
      <div className="grid grid-cols-8 gap-2.5" onPaste={handleCodePaste}>
        {Array.from({ length: 8 }).map((_, i) => (
          <input
            key={i}
            ref={(el) => { codeInputsRef.current[i] = el; }}
            className="k-auth-box"
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={enteredCode[i] ?? ""}
            onChange={(e) => handleCodeInput(i, e.target.value)}
            onKeyDown={(e) => handleCodeKeyDown(i, e)}
            aria-label={`${t("resetCode.label")} ${i + 1}`}
          />
        ))}
      </div>

      <p className="font-mono text-[11px] tracking-[0.12em] text-white/45">{t("resetCode.expiry")}</p>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={isLoading || enteredCode.length < 8}
          className={`${primaryBtnClass} flex-1`}
        >
          {isLoading ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <>{t("resetCode.submit")}<KeyRound size={17} /></>
          )}
        </button>
        <button
          type="button"
          onClick={() => requestResetMutation.mutate({ email })}
          disabled={requestResetMutation.isPending}
          className="k-auth-lnk whitespace-nowrap text-sm text-accent-primary"
        >
          {t("resetCode.resend")}
        </button>
      </div>

      {backToSignIn()}
    </div>
  );

  const renderNewPassword = () => (
    <div className="k-auth-body mt-9 flex flex-col gap-6">
      <div className="k-auth-fld-row">
        <input
          className="k-auth-fld"
          type={showNewPassword ? "text" : "password"}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={t("newPassword.newPasswordPlaceholder")}
          aria-label={t("newPassword.newPasswordLabel")}
          autoComplete="new-password"
          required
          minLength={8}
          disabled={isLoading}
        />
        {passwordEye(showNewPassword, () => setShowNewPassword(!showNewPassword))}
      </div>

      <div className="k-auth-fld-row">
        <input
          className="k-auth-fld"
          type={showConfirmPassword ? "text" : "password"}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder={t("newPassword.confirmPasswordPlaceholder")}
          aria-label={t("newPassword.confirmPasswordLabel")}
          autoComplete="new-password"
          required
          minLength={8}
          disabled={isLoading}
        />
        {passwordEye(showConfirmPassword, () => setShowConfirmPassword(!showConfirmPassword))}
      </div>

      <button type="submit" disabled={isLoading} className={`${primaryBtnClass} w-full`}>
        {isLoading ? (
          <><Loader2 className="animate-spin" size={18} />{t("newPassword.resetting")}</>
        ) : (
          <>{t("newPassword.submit")}<ArrowRight size={17} /></>
        )}
      </button>

      {backToSignIn()}
    </div>
  );

  const renderVerifyEmailSent = () => (
    <div className="k-auth-body mt-9 flex flex-col items-start gap-6">
      <p className="max-w-[380px] text-[15px] leading-relaxed text-white/55">{t("verifyEmail.body")}</p>

      {resendVerificationMutation.isSuccess ? (
        <p className="text-sm text-accent-primary">{t("verifyEmail.resent")}</p>
      ) : (
        <button
          type="button"
          disabled={resendVerificationMutation.isPending}
          onClick={() => resendVerificationMutation.mutate({ email })}
          className="k-auth-lnk text-sm text-accent-primary"
        >
          {resendVerificationMutation.isPending ? t("verifyEmail.resending") : t("verifyEmail.resend")}
        </button>
      )}

      <button type="button" onClick={handleBackToSignIn} className={primaryBtnClass}>
        {t("verifyEmail.backToSignIn")}
        <ArrowRight size={17} />
      </button>
    </div>
  );

  const renderDone = () => (
    <div className="mt-9 flex flex-col items-start gap-7">
      <div className="k-auth-pop flex h-[72px] w-[72px] items-center justify-center rounded-full border border-accent-primary/30 bg-accent-primary/10 text-accent-primary">
        <Check size={32} strokeWidth={1.6} />
      </div>
      <button type="button" onClick={handleBackToSignIn} className={primaryBtnClass}>
        {t("newPassword.continueToSignIn")}
        <ArrowRight size={17} />
      </button>
    </div>
  );

  /* The submit handler for whichever form is on screen; views without a form
     of their own render inside a no-op <form>. */
  const onSubmit: Record<ModalView, (e: React.FormEvent) => void> = {
    signIn: (e) => void handleEmailSignIn(e),
    signUp: (e) => void handleSignUp(e),
    forgotPassword: (e) => void handleSendResetCode(e),
    resetCode: (e) => void handleVerifyCode(e),
    newPassword: (e) => void handleResetPassword(e),
    verifyEmailSent: (e) => e.preventDefault(),
    done: (e) => e.preventDefault(),
  };

  const shownTab = hoveredTab ?? (view === "signUp" ? "signUp" : "signIn");
  const { step, title, sub } = copy[view];

  return (
    <div className="dark fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />

      <div className="k-auth-shell relative grid max-h-[94dvh] w-full max-w-5xl overflow-hidden rounded-[18px] border border-white/10 bg-[#08080c] lg:grid-cols-2">
        {/* ─── Left: brand panel (hidden on narrow screens) ─── */}
        <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.08] bg-[#0a0a10] p-11 lg:flex">
          <div
            aria-hidden="true"
            className="k-drift-slow pointer-events-none absolute -bottom-[180px] -left-[120px] h-[620px] w-[620px] rounded-full blur-[90px]"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, rgb(var(--accent-primary) / 0.26), transparent 64%)",
            }}
          />

          <div className="relative flex items-center gap-3">
            <div
              className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px]"
              style={{
                background:
                  "linear-gradient(140deg, rgb(var(--accent-primary)), rgb(var(--accent-secondary)))",
              }}
            >
              <Image src="/logo_white.png" alt="Kairos" width={18} height={18} className="h-[18px] w-[18px] object-contain" priority />
            </div>
            <span className="font-display text-2xl text-white">Kairos</span>
          </div>

          <div className="relative">
            <p className="font-display text-[52px] font-normal leading-[1.12] tracking-[-0.01em] text-white">
              {t("brand.taglineLead")}{" "}
              <em className="italic text-accent-primary">{t("brand.taglineAccent")}</em>
            </p>
            <p className="mt-[22px] max-w-[340px] text-base leading-[1.7] text-white/65">
              {t("brand.blurb")}
            </p>
          </div>

          <div className="relative flex gap-9">
            {[
              { n: "3", label: t("brand.statWorkspaces"), accent: false },
              { n: "5", label: t("brand.statLanguages"), accent: false },
              { n: "1", label: t("brand.statOnePlace"), accent: true },
            ].map((s) => (
              <div key={s.label}>
                <div className={`font-display text-[38px] leading-none ${s.accent ? "text-accent-primary" : "text-white"}`}>
                  {s.n}
                </div>
                <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Right: the flow ─── */}
        <div className="relative flex flex-col justify-center overflow-y-auto px-7 py-12 sm:px-14 sm:py-14">
          <button
            onClick={onClose}
            className="k-auth-lnk absolute right-6 top-6 flex text-white/35"
            aria-label={t("close")}
          >
            <X size={18} />
          </button>

          <div className={eyebrowClass}>{step}</div>
          <h2 className="mt-4 font-display text-[38px] font-normal leading-[1.06] tracking-[-0.01em] text-white sm:text-[46px]">
            {title}
          </h2>
          <p className="mt-3 max-w-[380px] text-base leading-[1.65] text-white/60">{sub}</p>

          {TABBED.has(view) && (
            <div
              data-auth-pos={shownTab}
              onMouseLeave={() => setHoveredTab(null)}
              className="relative mt-7 flex max-w-[300px] border-b border-white/10"
            >
              <button
                type="button"
                className="k-auth-tab"
                data-on={shownTab === "signIn"}
                onClick={() => goToTab("signIn")}
                onMouseEnter={() => setHoveredTab("signIn")}
              >
                {t("tabs.signIn")}
              </button>
              <button
                type="button"
                className="k-auth-tab"
                data-on={shownTab === "signUp"}
                onClick={() => goToTab("signUp")}
                onMouseEnter={() => setHoveredTab("signUp")}
              >
                {t("tabs.signUp")}
              </button>
              <span className="k-auth-rail"><span className="k-auth-dot" /></span>
            </div>
          )}

          {(error || loadingMessage) && (
            <div className="mt-6 flex flex-col gap-2">
              {error && (
                <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </p>
              )}
              {loadingMessage && (
                <p className="flex items-center gap-2 rounded-xl border border-accent-primary/25 bg-accent-primary/10 px-4 py-3 text-sm text-accent-primary">
                  <Loader2 className="animate-spin" size={16} />
                  {loadingMessage}
                </p>
              )}
            </div>
          )}

          <form onSubmit={onSubmit[view]} noValidate={view === "verifyEmailSent" || view === "done"}>
            {view === "signIn" && renderSignIn()}
            {view === "signUp" && renderSignUp()}
            {view === "verifyEmailSent" && renderVerifyEmailSent()}
            {view === "forgotPassword" && renderForgotPassword()}
            {view === "resetCode" && renderResetCode()}
            {view === "newPassword" && renderNewPassword()}
            {view === "done" && renderDone()}
          </form>
        </div>
      </div>
    </div>
  );
}
