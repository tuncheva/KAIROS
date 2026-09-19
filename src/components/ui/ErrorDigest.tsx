"use client";

import { useState } from "react";

/**
 * The digest line under an error screen.
 *
 * The digest is the only handle support has on a server-side error; without it
 * a report is "it broke on some page at some time". It used to be printed as
 * dead text, which meant reading a hex string off the screen and typing it into
 * a ticket. It is a button now: one press puts the full digest on the clipboard
 * and the line says so.
 */
export function ErrorDigest({
  digest,
  copyLabel,
  copiedLabel,
}: {
  digest: string;
  /** Already-translated, with {digest} filled in. */
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(digest)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
      className="kairos-tap h-control-sm border-border-light text-fg-quaternary hover:border-border-strong hover:text-fg-tertiary inline-flex items-center rounded-sm border px-3 font-mono text-[10px] tracking-[0.16em] uppercase transition-colors"
    >
      {copied ? copiedLabel : copyLabel}
    </button>
  );
}
