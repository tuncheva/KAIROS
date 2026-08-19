"use client";

import { signIn } from "next-auth/react";
import { X, Mail, Lock, User, Loader2, Eye, EyeOff, ArrowRight, ArrowLeft, KeyRound } from "lucide-react";
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
  | "newPassword";

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
  const [rememberMe, setRememberMe] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [view, setView] = useState<ModalView>("signIn");

  /* Forgot password state */
  const [enteredCode, setEnteredCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
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
        setResetSuccess(false);
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

  const toggleMode = () => {
    resetForm();
    setView(view === "signUp" ? "signIn" : "signUp");
  };

  const handleForgotPassword = () => {
    setError("");
    setView("forgotPassword");
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
      setResetSuccess(true);

      setTimeout(() => {
        setResetSuccess(false);
        resetForm();
        setView("signIn");
      }, 2000);
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
    setView("signIn");
  };

  /* ─── Shared input styles (dark only) ─── */
  const inputClass = "w-full pl-12 pr-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder:text-white/25 focus:outline-none focus:border-accent-primary/50 focus:bg-white/[0.06] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm";
  const inputPasswordClass = "w-full pl-12 pr-12 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder:text-white/25 focus:outline-none focus:border-accent-primary/50 focus:bg-white/[0.06] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm";
  const labelClass = "block text-xs font-bold text-white/60 uppercase tracking-wider";

  /* ─── Render helpers ─── */
  const renderHeader = (title: string, subtitle: string) => (
    <div className="relative px-5 sm:px-8 pt-6 sm:pt-8 pb-5 sm:pb-6 text-center">
      <div className="w-14 h-14 rounded-2xl kairos-neon-btn flex items-center justify-center mx-auto mb-5 shadow-lg shadow-accent-primary/25">
        <Image src="/logo_white.png" alt="Kairos Logo" width={32} height={32} className="w-8 h-8 object-contain" priority />
      </div>
      <h2 className="text-2xl font-bold text-white mb-2 font-display tracking-tight">{title}</h2>
      <p className="text-white/50 text-sm leading-relaxed">{subtitle}</p>
    </div>
  );

  const renderError = () =>
    error ? (
      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-sm text-center">
        {error}
      </div>
    ) : null;

  const renderLoading = () =>
    loadingMessage ? (
      <div className="p-3 bg-accent-primary/10 border border-accent-primary/20 rounded-xl text-accent-primary text-sm text-center flex items-center justify-center gap-2">
        <Loader2 className="animate-spin" size={16} />
        {loadingMessage}
      </div>
    ) : null;

  /* ─── Sign In View ─── */
  const renderSignIn = () => (
    <>
      {renderHeader(t("signIn.title"), t("signIn.subtitle"))}
      <div className="relative px-5 sm:px-8 pb-6 sm:pb-8 space-y-5">
        {renderError()}
        {renderLoading()}

        <form onSubmit={handleEmailSignIn} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className={labelClass}>{t("signIn.emailLabel")}</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" size={18} />
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("signIn.emailPlaceholder")} required disabled={isLoading} className={inputClass} />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className={labelClass}>{t("signIn.passwordLabel")}</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" size={18} />
              <input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("signIn.passwordPlaceholder")} required disabled={isLoading} className={inputPasswordClass} />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors" tabIndex={-1}>
                {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 cursor-pointer group">
              <div onClick={() => setRememberMe(!rememberMe)} className={`w-4 h-4 rounded-full border-2 transition-all duration-200 flex items-center justify-center ${rememberMe ? "border-accent-primary bg-accent-primary" : "border-white/20 hover:border-white/40"}`}>
                {rememberMe && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <span className="text-white/50 group-hover:text-white/70 transition-colors">{t("signIn.rememberMe")}</span>
            </label>
            <button type="button" onClick={handleForgotPassword} className="text-white/50 hover:text-white/70 transition-colors">
              {t("signIn.forgotPassword")}
            </button>
          </div>

          <button type="submit" disabled={isLoading} className="w-full px-6 py-4 kairos-neon-btn rounded-2xl font-semibold text-white transition-all duration-300 shadow-lg shadow-accent-primary/25 hover:shadow-xl hover:shadow-accent-primary/35 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 mt-2">
            {isLoading ? (
              <><Loader2 className="animate-spin" size={20} />{t("signIn.signingIn")}</>
            ) : (
              <>{t("signIn.submit")}<ArrowRight size={18} /></>
            )}
          </button>
        </form>

        {/* OR CONTINUE WITH */}
        <div className="flex items-center gap-4">
          <div className="flex-1 border-t border-white/[0.08]" />
          <span className="text-[10px] font-bold text-white/30 uppercase tracking-[0.15em]">{t("orContinueWith")}</span>
          <div className="flex-1 border-t border-white/[0.08]" />
        </div>

        <div className="flex gap-3">
          <button onClick={handleGoogleSignIn} disabled={isLoading} className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl font-medium text-white/80 hover:bg-white/[0.08] hover:text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm">
            <svg viewBox="0 0 24 24" className="w-4 h-4">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {t("google")}
          </button>
        </div>

        <div className="text-center pt-1">
          <button onClick={toggleMode} disabled={isLoading} className="text-sm text-white/50 hover:text-white/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {t("signIn.noAccount")} <span className="font-semibold text-accent-primary">{t("signIn.createAccount")}</span>
          </button>
        </div>
      </div>
    </>
  );

  /* ─── Sign Up View ─── */
  const renderSignUp = () => (
    <>
      {renderHeader(t("signUp.title"), t("signUp.subtitle"))}
      <div className="relative px-5 sm:px-8 pb-6 sm:pb-8 space-y-5">
        {renderError()}
        {renderLoading()}

        <form onSubmit={handleSignUp} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="name" className={labelClass}>{t("signUp.fullNameLabel")}</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" size={18} />
              <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("signUp.fullNamePlaceholder")} disabled={isLoading} className={inputClass} />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="signup-email" className={labelClass}>{t("signIn.emailLabel")}</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" size={18} />
              <input id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("signIn.emailPlaceholder")} required disabled={isLoading} className={inputClass} />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="signup-password" className={labelClass}>{t("signIn.passwordLabel")}</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" size={18} />
              <input id="signup-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("signIn.passwordPlaceholder")} required minLength={8} disabled={isLoading} className={inputPasswordClass} />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors" tabIndex={-1}>
                {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer group text-sm">
            <div onClick={() => setAgreeTerms(!agreeTerms)} className={`mt-0.5 w-4 h-4 rounded border transition-all duration-200 flex items-center justify-center flex-shrink-0 ${agreeTerms ? "border-accent-primary bg-accent-primary" : "border-white/20 hover:border-white/40"}`}>
              {agreeTerms && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <span className="text-white/50 leading-relaxed">
              {t("signUp.agreeTerms")} <span className="text-accent-primary underline underline-offset-2 cursor-pointer hover:text-accent-primary/80">{t("signUp.termsOfService")}</span> {t("signUp.and")} <span className="text-accent-primary underline underline-offset-2 cursor-pointer hover:text-accent-primary/80">{t("signUp.privacyPolicy")}</span>.
            </span>
          </label>

          <button type="submit" disabled={isLoading || !agreeTerms} className="w-full px-6 py-4 kairos-neon-btn rounded-2xl font-semibold text-white transition-all duration-300 shadow-lg shadow-accent-primary/25 hover:shadow-xl hover:shadow-accent-primary/35 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 mt-2">
            {isLoading ? (
              <><Loader2 className="animate-spin" size={20} />{t("signUp.creatingAccount")}</>
            ) : (
              t("signUp.submit")
            )}
          </button>
        </form>

        <div className="text-center pt-1">
          <button onClick={toggleMode} disabled={isLoading} className="text-sm text-white/50 hover:text-white/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {t("signUp.hasAccount")} <span className="font-semibold text-white">{t("signUp.logIn")}</span>
          </button>
        </div>
      </div>
    </>
  );

  /* ─── Forgot Password View ─── */
  const renderForgotPassword = () => (
    <>
      {renderHeader(t("forgotPassword.title"), t("forgotPassword.subtitle"))}
      <div className="relative px-5 sm:px-8 pb-6 sm:pb-8 space-y-5">
        {renderError()}
        {renderLoading()}

        <form onSubmit={handleSendResetCode} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="reset-email" className={labelClass}>{t("signIn.emailLabel")}</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" size={18} />
              <input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("signIn.emailPlaceholder")} required disabled={isLoading} className={inputClass} />
            </div>
          </div>

          <button type="submit" disabled={isLoading} className="w-full px-6 py-4 kairos-neon-btn rounded-2xl font-semibold text-white transition-all duration-300 shadow-lg shadow-accent-primary/25 hover:shadow-xl hover:shadow-accent-primary/35 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 mt-2">
            {isLoading ? (
              <><Loader2 className="animate-spin" size={20} />{t("forgotPassword.sendingCode")}</>
            ) : (
              <>{t("forgotPassword.submit")}<ArrowRight size={18} /></>
            )}
          </button>
        </form>

        <div className="text-center pt-1">
          <button onClick={handleBackToSignIn} className="text-sm text-white/50 hover:text-white/80 transition-colors flex items-center gap-1.5 mx-auto">
            <ArrowLeft size={14} />
            {t("backToSignIn")}
          </button>
        </div>
      </div>
    </>
  );

  /* ─── Reset Code Verification View ─── */
  const renderResetCode = () => (
    <>
      {renderHeader(t("resetCode.title"), t("resetCode.subtitle", { email }))}
      <div className="relative px-5 sm:px-8 pb-6 sm:pb-8 space-y-5">
        {renderError()}

        <form onSubmit={handleVerifyCode} className="space-y-4">
          <div className="space-y-2">
            <label className={labelClass}>{t("resetCode.label")}</label>
            <div className="flex gap-1.5 justify-center" onPaste={handleCodePaste}>
              {Array.from({ length: 8 }).map((_, i) => (
                <input
                  key={i}
                  ref={(el) => { codeInputsRef.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={enteredCode[i] ?? ""}
                  onChange={(e) => handleCodeInput(i, e.target.value)}
                  onKeyDown={(e) => handleCodeKeyDown(i, e)}
                  className="w-10 h-12 text-center text-lg font-bold bg-white/[0.04] border border-white/[0.08] rounded-lg text-white focus:outline-none focus:border-accent-primary/50 focus:bg-white/[0.06] transition-all duration-200"
                />
              ))}
            </div>
            <p className="text-[11px] text-white/30 text-center mt-2">{t("resetCode.helperText")}</p>
          </div>

          <button type="submit" disabled={enteredCode.length < 8} className="w-full px-6 py-4 kairos-neon-btn rounded-2xl font-semibold text-white transition-all duration-300 shadow-lg shadow-accent-primary/25 hover:shadow-xl hover:shadow-accent-primary/35 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 mt-2">
            {t("resetCode.submit")}
            <KeyRound size={18} />
          </button>
        </form>

        <div className="text-center pt-1">
          <button onClick={handleBackToSignIn} className="text-sm text-white/50 hover:text-white/80 transition-colors flex items-center gap-1.5 mx-auto">
            <ArrowLeft size={14} />
            {t("backToSignIn")}
          </button>
        </div>
      </div>
    </>
  );

  /* ─── New Password View ─── */
  const renderNewPassword = () => (
    <>
      {renderHeader(resetSuccess ? t("newPassword.successTitle") : t("newPassword.title"), resetSuccess ? t("newPassword.successSubtitle") : t("newPassword.subtitle"))}
      <div className="relative px-5 sm:px-8 pb-6 sm:pb-8 space-y-5">
        {resetSuccess ? (
          <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-green-300 text-sm text-center flex items-center justify-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8L7 11L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {t("newPassword.redirecting")}
          </div>
        ) : (
          <>
            {renderError()}
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="new-password" className={labelClass}>{t("newPassword.newPasswordLabel")}</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" size={18} />
                  <input id="new-password" type={showNewPassword ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t("signIn.passwordPlaceholder")} required minLength={8} disabled={isLoading} className={inputPasswordClass} />
                  <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors" tabIndex={-1}>
                    {showNewPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="confirm-password" className={labelClass}>{t("newPassword.confirmPasswordLabel")}</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" size={18} />
                  <input id="confirm-password" type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t("signIn.passwordPlaceholder")} required minLength={8} disabled={isLoading} className={inputPasswordClass} />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors" tabIndex={-1}>
                    {showConfirmPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={isLoading} className="w-full px-6 py-4 kairos-neon-btn rounded-2xl font-semibold text-white transition-all duration-300 shadow-lg shadow-accent-primary/25 hover:shadow-xl hover:shadow-accent-primary/35 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 mt-2">
                {isLoading ? (
                  <><Loader2 className="animate-spin" size={20} />{t("newPassword.resetting")}</>
                ) : (
                  <>{t("newPassword.submit")}<ArrowRight size={18} /></>
                )}
              </button>
            </form>
          </>
        )}

        {!resetSuccess && (
          <div className="text-center pt-1">
            <button onClick={handleBackToSignIn} className="text-sm text-white/50 hover:text-white/80 transition-colors flex items-center gap-1.5 mx-auto">
              <ArrowLeft size={14} />
              {t("backToSignIn")}
            </button>
          </div>
        )}
      </div>
    </>
  );

  const renderVerifyEmailSent = () => (
    <>
      {renderHeader(
        t("verifyEmail.title"),
        t("verifyEmail.subtitle", { email }),
      )}
      <div className="space-y-4">
        <p className="text-sm text-fg-secondary">{t("verifyEmail.body")}</p>

        {resendVerificationMutation.isSuccess ? (
          <p className="text-sm text-emerald-500">{t("verifyEmail.resent")}</p>
        ) : (
          <button
            type="button"
            disabled={resendVerificationMutation.isPending}
            onClick={() => resendVerificationMutation.mutate({ email })}
            className="text-sm text-accent-primary hover:text-accent-hover font-medium transition-colors disabled:opacity-60"
          >
            {resendVerificationMutation.isPending
              ? t("verifyEmail.resending")
              : t("verifyEmail.resend")}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setView("signIn");
            setError("");
          }}
          className="w-full px-6 py-3 bg-accent-primary text-white font-semibold rounded-lg hover:bg-accent-secondary transition-colors"
        >
          {t("verifyEmail.backToSignIn")}
        </button>
      </div>
    </>
  );

  return (
    <div className="dark fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-[#0a0a0f] rounded-3xl shadow-2xl w-full max-w-md max-h-[92dvh] overflow-y-auto border border-white/[0.08] kairos-modal-content">
        {/* Subtle gradient border effect */}
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-b from-accent-primary/10 via-transparent to-transparent pointer-events-none" />

        {/* Close button */}
        <button onClick={onClose} className="absolute top-5 right-5 z-10 p-1.5 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors" aria-label="Close">
          <X size={18} />
        </button>

        {view === "signIn" && renderSignIn()}
        {view === "signUp" && renderSignUp()}
        {view === "verifyEmailSent" && renderVerifyEmailSent()}
        {view === "forgotPassword" && renderForgotPassword()}
        {view === "resetCode" && renderResetCode()}
        {view === "newPassword" && renderNewPassword()}
      </div>
    </div>
  );
}
