/**
 * Where the two on-screen notification surfaces live.
 *
 * KAIROS shows transient messages in two places: the floating notification
 * popups (`NotificationSystem`) and the toast stack (`ToastProvider`). Before
 * this was a preference, the toast viewport was put bottom-left purely because
 * top-right and bottom-right were already taken. The moment position becomes
 * user-chosen that reasoning collapses — both surfaces cannot own the corner
 * the user picked.
 *
 * So there is **one** preference, not two. The user positions the notification
 * popups; the toast stack takes the diagonally opposite corner. A collision
 * becomes structurally impossible rather than something two settings have to
 * be checked against each other to avoid.
 *
 * Both surfaces read CSS custom properties set once on `<html>` rather than
 * each holding its own switch on the position string. That is also what lets
 * the pre-paint script (`themeInitScript`) place a toast that fires before
 * React has hydrated.
 */

export const NOTIFICATION_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export type NotificationPosition = (typeof NOTIFICATION_POSITIONS)[number];

export const DEFAULT_NOTIFICATION_POSITION: NotificationPosition = "top-right";

/**
 * Reserved for `AskKairosLauncher`, which is a draggable pill anchored there.
 *
 * It stays in the enum because the column may already hold it, but it is never
 * offered in settings and is never chosen as a toast anchor.
 */
export const RESERVED_POSITION: NotificationPosition = "bottom-right";

/** The five slots a user may pick, in reading order. */
export const SELECTABLE_POSITIONS = NOTIFICATION_POSITIONS.filter(
  (p) => p !== RESERVED_POSITION,
);

/** localStorage key, shared with the pre-paint script. */
export const NOTIFICATION_POSITION_STORAGE_KEY = "kairos:notifPosition";

export function isNotificationPosition(value: unknown): value is NotificationPosition {
  return (
    typeof value === "string" &&
    (NOTIFICATION_POSITIONS as readonly string[]).includes(value)
  );
}

/**
 * The corner the toasts take, given where the notifications are.
 *
 * Diagonally opposite, except that nothing may land in the reserved corner:
 * `top-left` would invert to `bottom-right`, so it falls back to the bottom
 * centre — still on the opposite edge, still nowhere near the popups.
 */
export function toastPositionFor(position: NotificationPosition): NotificationPosition {
  switch (position) {
    case "top-left":
      return "bottom-center";
    case "top-center":
      return "bottom-left";
    case "top-right":
      return "bottom-left";
    case "bottom-left":
      return "top-right";
    case "bottom-center":
      return "top-right";
    case "bottom-right":
      return "top-left";
  }
}

/** Splits `top-left` into the two axes the CSS custom properties carry. */
export function splitPosition(position: NotificationPosition): {
  block: "start" | "end";
  inline: "start" | "center" | "end";
} {
  const [block, inline] = position.split("-") as ["top" | "bottom", string];
  return {
    block: block === "top" ? "start" : "end",
    inline: inline === "left" ? "start" : inline === "right" ? "end" : "center",
  };
}

const FLEX: Record<"start" | "center" | "end", string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
};

/**
 * Writes both surfaces' anchors onto `<html>`.
 *
 * Kept as a plain function over a `Document` so the pre-paint script, the
 * preferences provider and the settings preview can all use the same rule —
 * the inline script re-implements it in ES5, and `tests/lib` asserts the two
 * agree.
 */
export function applyNotificationPosition(
  position: NotificationPosition,
  root: HTMLElement,
): void {
  const notif = splitPosition(position);
  const toast = splitPosition(toastPositionFor(position));

  root.dataset.notifBlock = notif.block;
  root.dataset.notifInline = notif.inline;
  root.dataset.toastBlock = toast.block;
  root.dataset.toastInline = toast.inline;

  root.style.setProperty("--notif-anchor-block", FLEX[notif.block]);
  root.style.setProperty("--notif-anchor-inline", FLEX[notif.inline]);
  root.style.setProperty("--toast-anchor-block", FLEX[toast.block]);
  root.style.setProperty("--toast-anchor-inline", FLEX[toast.inline]);
}
