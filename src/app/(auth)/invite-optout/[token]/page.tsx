"use client";

import { use, useState } from "react";
import Link from "next/link";

import { Check, Loader2, Mail } from "~/components/ui/icons";

/**
 * The page behind the invitation email's "Don't send me invitations again".
 *
 * It asks for one click rather than acting on arrival: mail scanners open every
 * link in a message, and an opt-out that fired on a GET would opt people out of
 * invitations they never saw. English only, like the email it is linked from.
 */
export default function InviteOptOutPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  const confirm = async () => {
    setState("busy");
    try {
      const res = await fetch(`/api/invite-optout/${encodeURIComponent(token)}`, {
        method: "POST",
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="bg-bg-primary flex min-h-dvh items-center justify-center p-4">
      <div className="bg-bg-secondary/60 border-border-light/40 w-full max-w-md space-y-5 rounded-lg border p-8 text-center">
        {state === "done" ? (
          <>
            <Check className="text-status-success-ink mx-auto" size={32} />
            <h1 className="font-display text-fg-primary text-[22px] leading-tight font-normal">
              You won&apos;t get KAIROS invitations again
            </h1>
            <p className="text-fg-secondary text-sm">
              Pending invitations to your address were withdrawn. The people who invited you
              are not told that you opted out.
            </p>
          </>
        ) : (
          <>
            <Mail className="text-fg-secondary mx-auto" size={32} />
            <h1 className="font-display text-fg-primary text-[22px] leading-tight font-normal">
              Stop KAIROS invitations?
            </h1>
            <p className="text-fg-secondary text-sm">
              Nobody will be able to invite this email address to a KAIROS workspace again.
              To undo it later, write to us from this address.
            </p>
            {state === "error" ? (
              <p className="text-status-danger-ink text-sm">
                That link is not valid. Copy it from the email again, or write to us.
              </p>
            ) : null}
            <button
              type="button"
              disabled={state === "busy"}
              onClick={() => void confirm()}
              className="bg-accent-primary hover:bg-accent-hover inline-flex h-10 items-center gap-2 rounded-md px-5 text-sm font-semibold text-white transition-colors disabled:opacity-60"
            >
              {state === "busy" ? <Loader2 size={14} className="animate-spin" /> : null}
              Don&apos;t send me invitations
            </button>
          </>
        )}
        <p>
          <Link href="/privacy#invitations" className="text-fg-tertiary text-xs underline">
            How we handle your address
          </Link>
        </p>
      </div>
    </div>
  );
}
