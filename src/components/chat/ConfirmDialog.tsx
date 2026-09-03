"use client";

/**
 * The chat confirmation.
 *
 * A thin binding over `components/ui/ConfirmDialog`, which owns the focus
 * trap, Escape handling and `activeElement` restore that this file used to
 * duplicate. Only the `chat.direct` labels are local.
 */

import { useTranslations } from "next-intl";

import { ConfirmDialog as UiConfirmDialog } from "~/components/ui/ConfirmDialog";

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive = false,
  isPending,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("chat.direct");

  return (
    <UiConfirmDialog
      title={title}
      message={message}
      confirmLabel={isPending ? t("working") : confirmLabel}
      cancelLabel={t("cancel")}
      destructive={destructive}
      isPending={isPending}
      onCancel={onCancel}
      onConfirm={() => onConfirm()}
    />
  );
}
