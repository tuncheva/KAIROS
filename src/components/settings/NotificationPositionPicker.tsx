"use client";

/**
 * Where notifications appear, as a picture rather than a dropdown.
 *
 * Six slots on a miniature screen, because a list of position names ("top
 * right", "bottom centre") asks the user to imagine the result. Two of the
 * slots are not selectable and say why: one shows where the toasts land as a
 * *consequence* of the choice, and bottom-right is reserved for the Ask Kairos
 * launcher, so the collision this whole preference exists to prevent cannot be
 * recreated from the settings panel.
 *
 * Preview fires a real toast into the chosen corner. A position control whose
 * result you cannot see is a guess.
 */

import { useTranslations } from "next-intl";

import { useToast } from "~/components/providers/ToastProvider";
import {
  applyNotificationPosition,
  NOTIFICATION_POSITIONS,
  RESERVED_POSITION,
  toastPositionFor,
  type NotificationPosition,
} from "~/lib/notificationPosition";

const LABEL_KEY: Record<NotificationPosition, string> = {
  "top-left": "posTopLeft",
  "top-center": "posTopCenter",
  "top-right": "posTopRight",
  "bottom-left": "posBottomLeft",
  "bottom-center": "posBottomCenter",
  "bottom-right": "posBottomRight",
};

type Translator = (key: string, values?: Record<string, unknown>) => string;

export function NotificationPositionPicker({
  value,
  disabled,
  onChange,
}: {
  value: NotificationPosition;
  disabled: boolean;
  onChange: (next: NotificationPosition) => void;
}) {
  const useT = useTranslations as unknown as (namespace: string) => Translator;
  const t = useT("settings.notifications");
  const toast = useToast();

  const toastSlot = toastPositionFor(value);

  return (
    <div className="flex flex-col gap-4">
      {/* A 16:10 stand-in for the viewport. The frame matters: without it the
          six buttons read as a segmented control rather than as places. */}
      <div
        role="radiogroup"
        aria-label={t("positionLabel")}
        className="grid aspect-[16/10] w-full max-w-sm grid-cols-3 grid-rows-2 gap-1.5 rounded-xl border border-border-light bg-bg-secondary p-1.5"
      >
        {NOTIFICATION_POSITIONS.map((slot) => {
          const label = t(LABEL_KEY[slot]);
          const isSelected = slot === value;
          const isToastSlot = slot === toastSlot;
          const isReserved = slot === RESERVED_POSITION;
          const selectable = !isReserved && !isToastSlot;

          if (!selectable) {
            return (
              <div
                key={slot}
                className={`flex items-center justify-center rounded-lg border border-dashed px-1 text-center text-[10px] leading-tight font-medium ${
                  isReserved
                    ? "border-border-light text-fg-quaternary"
                    : "border-success/40 bg-success/8 text-success"
                }`}
              >
                {isReserved ? t("positionReserved") : t("positionToasts")}
              </div>
            );
          }

          return (
            <button
              key={slot}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={label}
              disabled={disabled}
              onClick={() => onChange(slot)}
              className={`flex items-center justify-center rounded-lg border px-1 text-center text-[10px] leading-tight font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:outline-none disabled:opacity-50 ${
                isSelected
                  ? "border-accent-primary bg-accent-primary/12 text-accent-primary"
                  : "border-border-light text-fg-tertiary hover:border-border-medium hover:text-fg-secondary"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-fg-tertiary">
        {t("positionSummary", {
          notifications: t(LABEL_KEY[value]),
          toasts: t(LABEL_KEY[toastSlot]),
        })}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            /* Apply first: the preference may still be in flight, and a
               preview that lands in the previous corner teaches the wrong
               thing. The provider writes the same values when the mutation
               settles, so this is not a second source of truth. */
            applyNotificationPosition(value, document.documentElement);
            toast.info(t("positionPreviewToast"));
          }}
          className="rounded-lg border border-border-medium px-3 py-1.5 text-xs font-semibold text-fg-secondary transition-colors hover:border-accent-primary hover:text-accent-primary disabled:opacity-50"
        >
          {t("positionPreview")}
        </button>
        <span className="text-[11px] text-fg-quaternary">{t("positionMobileNote")}</span>
      </div>
    </div>
  );
}
