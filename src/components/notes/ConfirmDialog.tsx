"use client";

/**
 * The notes confirmation.
 *
 * This file used to carry its own copy of the focus trap, Escape handling and
 * `activeElement` restore. All of it now lives in `components/ui/ConfirmDialog`
 * — see that file for why there is exactly one of these. What remains here is
 * the part that is genuinely local: the `notes` namespace supplies the default
 * "Cancel" and "Working…" labels, so every call site on this surface does not
 * have to pass them.
 */

import { useTranslations } from "next-intl";

import { ConfirmDialog as UiConfirmDialog } from "~/components/ui/ConfirmDialog";

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  isPending,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  /** Defaults to "Cancel"; the reset prompt says "Try again" instead. */
  cancelLabel?: string;
  destructive?: boolean;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("notes");

  return (
    <UiConfirmDialog
      title={title}
      message={message}
      confirmLabel={isPending ? t("common.working") : confirmLabel}
      cancelLabel={cancelLabel ?? t("common.cancel")}
      destructive={destructive}
      isPending={isPending}
      onCancel={onCancel}
      onConfirm={() => onConfirm()}
    />
  );
}
