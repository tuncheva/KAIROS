"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle } from "~/components/ui/icons";

/**
 * The sign-in failure page.
 *
 * NextAuth's built-in error page prints the raw code — "Access Denied" and a
 * button back to sign in — which is the same screen for a refused account link,
 * a provider that returned no email, and a misconfigured secret. Someone who has
 * just signed up and clicked "continue with Google" has no way to tell what
 * happened or what to try, so each code gets its own explanation and its own
 * next step here.
 */
const MESSAGES: Record<
  string,
  { title: string; body: string; hint?: string }
> = {
  AccessDenied: {
    title: "We couldn't complete that sign-in",
    body:
      "Your provider signed you in, but we couldn't attach it to an account for that address.",
    hint:
      "This usually means the address already has an unconfirmed sign-up on it and the provider didn't tell us the address was verified. Confirm the address from the email we sent, then sign in with your password — or use a provider that verifies your email.",
  },
  OAuthAccountNotLinked: {
    title: "That address is already in use",
    body:
      "An account with this email already exists, created a different way.",
    hint: "Sign in the way you did the first time, then link the provider from your security settings.",
  },
  OAuthSignin: {
    title: "We couldn't reach your provider",
    body: "The sign-in request to Google or Microsoft didn't go through.",
    hint: "Please try again in a moment.",
  },
  OAuthCallback: {
    title: "Your provider's reply didn't arrive intact",
    body: "The round-trip back from Google or Microsoft failed to validate.",
    hint: "This is usually a stale browser tab. Close this one and start the sign-in again.",
  },
  Verification: {
    title: "That link is no longer valid",
    body: "Confirmation links can only be used once, and they expire.",
    hint: "Request a fresh link and open it from the same browser.",
  },
  Configuration: {
    title: "Sign-in is misconfigured",
    body: "Something on our side is wrong, not on yours.",
    hint: "Please try again later — we've logged the failure.",
  },
};

const FALLBACK = {
  title: "We couldn't sign you in",
  body: "Something went wrong on the way back from the sign-in step.",
  hint: "Please try again.",
};

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const code = searchParams?.get("error") ?? "";
  const message = MESSAGES[code] ?? FALLBACK;

  return (
    <div className="min-h-dvh bg-bg-primary flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-bg-secondary/60 border border-border-light/40 rounded-2xl p-8 space-y-5">
        <div className="space-y-3 text-center">
          <AlertCircle className="mx-auto text-amber-500" size={32} />
          <h1 className="text-xl font-semibold text-fg-primary">
            {message.title}
          </h1>
          <p className="text-sm text-fg-secondary">{message.body}</p>
          {message.hint ? (
            <p className="text-sm text-fg-secondary">{message.hint}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Link
            href="/"
            className="block w-full text-center px-6 py-2.5 bg-accent-primary text-white font-medium rounded-lg hover:bg-accent-secondary transition-colors"
          >
            Back to sign in
          </Link>
          <Link
            href="/verify-email"
            className="block w-full text-center px-6 py-2.5 border border-border-light/40 text-fg-secondary font-medium rounded-lg hover:text-fg-primary transition-colors"
          >
            Send a new confirmation email
          </Link>
        </div>

        {code ? (
          /* Kept visible on purpose: it is the one thing that makes a support
             report actionable. */
          <p className="text-xs text-center text-fg-secondary/70">
            Reference: {code}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-bg-primary flex items-center justify-center">
          <p className="text-sm text-fg-secondary">Loading…</p>
        </div>
      }
    >
      <AuthErrorContent />
    </Suspense>
  );
}
