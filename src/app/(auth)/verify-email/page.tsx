"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle, AlertCircle, Mail } from "lucide-react";
import { api } from "~/trpc/react";

/**
 * Landing page for the confirmation link in the verification email.
 *
 * Credentials sign-in is refused until the address is confirmed, so this is the
 * step that makes a new account usable. It is a public route — the token is the
 * credential and there is no session yet.
 */
function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") ?? "";

  const [resendEmail, setResendEmail] = useState("");
  const [resent, setResent] = useState(false);

  const verify = api.auth.verifyEmail.useMutation();
  const resend = api.auth.resendVerification.useMutation({
    onSuccess: () => setResent(true),
  });

  // Redeem exactly once. Tokens are single-use, so a second attempt — from a
  // re-render or React's development double-effect — would report "not valid" for
  // a link that had just worked.
  const attempted = useRef(false);
  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    verify.mutate({ token });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per token
  }, [token]);

  const isVerified = verify.isSuccess;
  const hasFailed = verify.isError;

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-bg-secondary/60 border border-border-light/40 rounded-2xl p-8">
        {!token ? (
          <div className="space-y-3 text-center">
            <AlertCircle className="mx-auto text-amber-500" size={32} />
            <h1 className="text-xl font-semibold text-fg-primary">
              Nothing to confirm
            </h1>
            <p className="text-sm text-fg-secondary">
              This page needs the confirmation link from your email.
            </p>
          </div>
        ) : verify.isPending ? (
          <div className="space-y-3 text-center">
            <Mail className="mx-auto text-fg-secondary animate-pulse" size={32} />
            <h1 className="text-xl font-semibold text-fg-primary">
              Confirming your email…
            </h1>
          </div>
        ) : isVerified ? (
          <div className="space-y-4 text-center">
            <CheckCircle className="mx-auto text-emerald-500" size={32} />
            <h1 className="text-xl font-semibold text-fg-primary">
              Email confirmed
            </h1>
            <p className="text-sm text-fg-secondary">
              {verify.data?.email} is confirmed. You can sign in now.
            </p>
            <Link
              href="/"
              className="inline-block px-6 py-2.5 bg-accent-primary text-white font-medium rounded-lg hover:bg-accent-secondary transition-colors"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-3 text-center">
              <AlertCircle className="mx-auto text-red-500" size={32} />
              <h1 className="text-xl font-semibold text-fg-primary">
                This link didn&apos;t work
              </h1>
              <p className="text-sm text-fg-secondary">
                {hasFailed ? verify.error.message : "Please request a new link."}
              </p>
            </div>

            {resent ? (
              <p className="text-sm text-center text-fg-secondary">
                If that address needs confirming, a new link is on its way.
              </p>
            ) : (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  resend.mutate({ email: resendEmail });
                }}
              >
                <label
                  htmlFor="resend-email"
                  className="block text-sm text-fg-secondary"
                >
                  Send a new confirmation link
                </label>
                <input
                  id="resend-email"
                  type="email"
                  required
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2 rounded-lg bg-bg-primary text-fg-primary border border-border-light/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
                />
                <button
                  type="submit"
                  disabled={resend.isPending}
                  className="w-full px-6 py-2.5 bg-accent-primary text-white font-medium rounded-lg hover:bg-accent-secondary transition-colors disabled:opacity-60"
                >
                  {resend.isPending ? "Sending…" : "Send link"}
                </button>
                {resend.isError ? (
                  <p className="text-xs text-red-500">{resend.error.message}</p>
                ) : null}
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-bg-primary flex items-center justify-center">
          <div className="text-fg-secondary">Loading…</div>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
