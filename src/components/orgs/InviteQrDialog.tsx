"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, Loader2, RefreshCw, ShieldOff, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { useToast } from "~/components/providers/ToastProvider";
import { api } from "~/trpc/react";

/**
 * Live seconds left on a token.
 *
 * Ticks locally off the server-issued `expiresAt` rather than polling: the whole
 * point of the countdown is that the person holding the screen can see the code
 * dying, and a poll would make that jumpy.
 */
function useCountdown(expiresAt: Date | null | undefined): number {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!expiresAt) {
      setSecondsLeft(0);
      return;
    }

    const tick = () =>
      setSecondsLeft(
        Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)),
      );

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  return secondsLeft;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function InviteQrDialog({
  organizationId,
  organizationName,
  onClose,
}: {
  organizationId?: number;
  organizationName?: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("org");
  const tCommon = useTranslations("common");
  const toast = useToast();

  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const utils = api.useUtils();
  const input = organizationId ? { organizationId } : undefined;

  const existing = api.organization.getJoinQr.useQuery(input, {
    refetchOnWindowFocus: false,
  });

  // Revoking is the one state where an empty dialog is the correct dialog. The
  // auto-mint below fills any empty slot, so without this flag pressing revoke
  // would hand out a fresh code on the very next render.
  const [revoked, setRevoked] = useState(false);

  const rotate = api.organization.rotateJoinQr.useMutation({
    onSuccess: (data) => {
      // Paint the new code immediately rather than waiting for a refetch, so
      // the QR on screen is never blank between rotations.
      setRevoked(false);
      setLocalCode(data);
      utils.organization.getJoinQr.setData(input, data);
    },
    onError: (error) => toast.error(error.message),
  });

  const revoke = api.organization.revokeJoinQr.useMutation({
    onSuccess: () => {
      setRevoked(true);
      setLocalCode(null);
      utils.organization.getJoinQr.setData(input, null);
    },
    onError: (error) => toast.error(error.message),
  });

  type JoinQr = NonNullable<typeof existing.data>;
  const [localCode, setLocalCode] = useState<JoinQr | null>(null);

  const active = localCode ?? existing.data ?? null;
  const secondsLeft = useCountdown(active?.expiresAt);
  const isDead = !active || secondsLeft <= 0;

  // A dialog that is open in the room should always have a scannable code on
  // it, so an expiry mints the next one instead of leaving a dead square.
  const rotateRef = useRef(rotate);
  rotateRef.current = rotate;
  useEffect(() => {
    if (!active) return;
    if (secondsLeft > 0) return;
    if (revoked) return;
    if (rotateRef.current.isPending) return;
    rotateRef.current.mutate(input);
    // `input` is derived from a stable prop; re-running on every tick is
    // prevented by the `secondsLeft > 0` guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, active, revoked]);

  // Nothing outstanding when the dialog opens — mint the first one.
  useEffect(() => {
    if (existing.isLoading) return;
    if (revoked) return;
    if (existing.data ?? localCode) return;
    if (rotateRef.current.isPending) return;
    rotateRef.current.mutate(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.isLoading, existing.data, revoked]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const copy = useCallback(
    async (value: string, what: "link" | "code") => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(what);
        window.setTimeout(() => setCopied(null), 1600);
      } catch {
        toast.error(tCommon("copyFailed"));
      }
    },
    [toast, tCommon],
  );

  const busy = rotate.isPending || existing.isLoading;
  const title = organizationName ?? active?.organizationName ?? "";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("inviteQrTitle")}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-border-light/60 bg-bg-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-light/40 px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-fg-primary">
              {t("inviteQrTitle")}
            </h2>
            {title ? (
              <p className="mt-0.5 truncate text-xs text-fg-tertiary">{title}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tCommon("close")}
            className="rounded-lg p-1.5 text-fg-tertiary transition-colors hover:bg-bg-elevated hover:text-fg-primary"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5">
          <p className="mb-4 text-xs leading-relaxed text-fg-secondary">
            {t("inviteQrHint")}
          </p>

          <div className="relative mx-auto flex h-[248px] w-[248px] items-center justify-center rounded-xl bg-white p-3">
            {active && !isDead ? (
              <div
                className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
                // The SVG is produced by the QR encoder on our own server from a
                // URL we built, never from user text.
                dangerouslySetInnerHTML={{ __html: active.qrSvg }}
              />
            ) : revoked ? (
              <ShieldOff size={30} className="text-slate-300" />
            ) : (
              <Loader2 size={28} className="animate-spin text-slate-400" />
            )}
          </div>

          <div className="mt-4 flex items-center justify-center gap-2 text-xs">
            {revoked ? (
              <span className="text-fg-tertiary">{t("inviteQrRevoked")}</span>
            ) : isDead ? (
              <span className="text-fg-tertiary">{t("inviteQrRefreshing")}</span>
            ) : (
              <span className="text-fg-secondary">
                {t("inviteQrExpiresIn", { time: formatCountdown(secondsLeft) })}
              </span>
            )}
          </div>

          {active && !isDead ? (
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => void copy(active.url, "link")}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-bg-elevated px-3 py-2 text-xs font-medium text-fg-secondary transition-colors hover:text-fg-primary"
              >
                {copied === "link" ? <Check size={14} /> : <Link2 size={14} />}
                {copied === "link" ? tCommon("copied") : t("inviteQrCopyLink")}
              </button>
              <button
                type="button"
                onClick={() => void copy(active.code, "code")}
                className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 font-mono text-xs tracking-[0.15em] text-fg-tertiary transition-colors hover:bg-bg-elevated hover:text-fg-secondary"
                title={t("inviteQrCopyCode")}
              >
                {copied === "code" ? <Check size={12} /> : <Copy size={12} />}
                {active.code}
              </button>
            </div>
          ) : null}

          <div className="mt-4 flex items-center gap-2 border-t border-border-light/40 pt-4">
            <button
              type="button"
              onClick={() => rotate.mutate(input)}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              <RefreshCw size={14} className={busy ? "animate-spin" : undefined} />
              {t("inviteQrRegenerate")}
            </button>
            {active && !isDead ? (
              <button
                type="button"
                onClick={() => revoke.mutate(input)}
                disabled={revoke.isPending}
                className="rounded-lg px-3 py-2 text-xs font-medium text-fg-tertiary transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-60"
              >
                {t("inviteQrRevoke")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
