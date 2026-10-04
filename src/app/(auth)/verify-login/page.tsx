"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle, ShieldCheck } from "~/components/ui/icons";
import { api } from "~/trpc/react";

/**
 * Landing page for the link in the two-step sign-in email.
 *
 * Opening it changes nothing. Mail scanners fetch every link in a message, and
 * some run its scripts, so approving on load would let a scanner approve the
 * sign-in before the person had read the email. The decision is a button press.
 *
 * Approving does not sign in *this* device — it unlocks the screen that asked,
 * which is polling for exactly this. See `~/server/auth/twoFactor`.
 *
 * Public: whoever opens it has no session, and the token in the link is the
 * credential.
 */
function VerifyLoginContent() {
  const t = useTranslations("auth.verifyLogin");
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") ?? "";

  const review = api.auth.reviewTwoFactorLink.useQuery(
    { token },
    { enabled: !!token, retry: false, refetchOnWindowFocus: false },
  );
  const decide = api.auth.decideTwoFactorLink.useMutation();

  const status = decide.data?.status ?? review.data?.status;
  const requestedAt = review.data?.requestedAt ?? null;

  const iconBox = "mx-auto";
  const heading = "font-display text-[22px] leading-tight font-normal text-fg-primary";
  const body = "text-sm text-fg-secondary";

  let content: React.ReactNode;

  if (!token || status === "invalid") {
    content = (
      <div className="space-y-3 text-center">
        <AlertCircle className={`${iconBox} text-status-warning-ink`} size={32} />
        <h1 className={heading}>{t("invalidTitle")}</h1>
        <p className={body}>{t("invalidBody")}</p>
      </div>
    );
  } else if (review.isLoading) {
    content = (
      <div className="space-y-3 text-center">
        <ShieldCheck className={`${iconBox} animate-pulse text-fg-secondary`} size={32} />
        <h1 className={heading}>{t("loading")}</h1>
      </div>
    );
  } else if (review.isError) {
    content = (
      <div className="space-y-3 text-center">
        <AlertCircle className={`${iconBox} text-status-danger-ink`} size={32} />
        <h1 className={heading}>{t("invalidTitle")}</h1>
        <p className={body}>{review.error.message}</p>
      </div>
    );
  } else if (status === "expired") {
    content = (
      <div className="space-y-3 text-center">
        <AlertCircle className={`${iconBox} text-status-warning-ink`} size={32} />
        <h1 className={heading}>{t("expiredTitle")}</h1>
        <p className={body}>{t("expiredBody")}</p>
      </div>
    );
  } else if (status === "approved") {
    content = (
      <div className="space-y-3 text-center">
        <CheckCircle className={`${iconBox} text-status-success-ink`} size={32} />
        <h1 className={heading}>{t("approvedTitle")}</h1>
        <p className={body}>{t("approvedBody")}</p>
      </div>
    );
  } else if (status === "denied") {
    content = (
      <div className="space-y-4 text-center">
        <ShieldCheck className={`${iconBox} text-status-danger-ink`} size={32} />
        <h1 className={heading}>{t("deniedTitle")}</h1>
        <p className={body}>{t("deniedBody")}</p>
        <Link
          href="/"
          className="inline-block px-6 py-2.5 bg-accent-primary text-white font-medium rounded-lg hover:bg-accent-secondary transition-colors"
        >
          {t("resetPassword")}
        </Link>
      </div>
    );
  } else {
    content = (
      <div className="space-y-5">
        <div className="space-y-3 text-center">
          <ShieldCheck className={`${iconBox} text-accent-primary`} size={32} />
          <h1 className={heading}>{t("pendingTitle")}</h1>
          <p className={body}>
            {requestedAt
              ? t("pendingBodyAt", {
                  time: new Date(requestedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })
              : t("pendingBody")}
          </p>
          <p className="text-xs text-fg-tertiary">{t("pendingNote")}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ token, decision: "approve" })}
            className="flex-1 px-6 py-2.5 bg-accent-primary text-white font-medium rounded-lg hover:bg-accent-secondary transition-colors disabled:opacity-60"
          >
            {t("approve")}
          </button>
          <button
            type="button"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ token, decision: "deny" })}
            className="flex-1 px-6 py-2.5 border border-border-light/60 text-fg-primary font-medium rounded-lg hover:bg-bg-tertiary/60 transition-colors disabled:opacity-60"
          >
            {t("deny")}
          </button>
        </div>
        {decide.isError ? (
          <p className="text-xs text-center text-status-danger-ink">{decide.error.message}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-bg-primary flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-bg-secondary/60 border border-border-light/40 rounded-lg p-8">
        {content}
      </div>
    </div>
  );
}

export default function VerifyLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-bg-primary flex items-center justify-center">
          <div className="text-fg-secondary">…</div>
        </div>
      }
    >
      <VerifyLoginContent />
    </Suspense>
  );
}
