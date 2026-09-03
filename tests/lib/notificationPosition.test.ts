import { describe, expect, it } from "vitest";

import {
  applyNotificationPosition,
  DEFAULT_NOTIFICATION_POSITION,
  NOTIFICATION_POSITIONS,
  RESERVED_POSITION,
  SELECTABLE_POSITIONS,
  toastPositionFor,
} from "~/lib/notificationPosition";
import { THEME_INIT_SCRIPT } from "~/server/http/themeInitScript";

/**
 * The point of the preference is that two surfaces can never want the same
 * corner. That is a property, so it is asserted as one rather than by
 * eyeballing the mapping table.
 */
describe("notification position", () => {
  it("never puts the toasts where the notifications are", () => {
    for (const position of NOTIFICATION_POSITIONS) {
      expect(toastPositionFor(position)).not.toBe(position);
    }
  });

  it("keeps both surfaces out of the corner Ask Kairos owns", () => {
    expect(SELECTABLE_POSITIONS).not.toContain(RESERVED_POSITION);
    for (const position of SELECTABLE_POSITIONS) {
      expect(toastPositionFor(position)).not.toBe(RESERVED_POSITION);
    }
  });

  it("puts the toasts on the opposite edge, always", () => {
    for (const position of NOTIFICATION_POSITIONS) {
      const edge = position.startsWith("top") ? "top" : "bottom";
      expect(toastPositionFor(position).startsWith(edge)).toBe(false);
    }
  });

  it("defaults to today's behaviour, so nobody's screen moves unasked", () => {
    expect(DEFAULT_NOTIFICATION_POSITION).toBe("top-right");
  });

  it("writes both anchors onto the root", () => {
    const root = document.createElement("html");
    applyNotificationPosition("bottom-left", root);

    expect(root.dataset.notifBlock).toBe("end");
    expect(root.dataset.notifInline).toBe("start");
    expect(root.dataset.toastBlock).toBe("start");
    expect(root.dataset.toastInline).toBe("end");
    expect(root.style.getPropertyValue("--notif-anchor-inline")).toBe("flex-start");
    expect(root.style.getPropertyValue("--toast-anchor-inline")).toBe("flex-end");
  });
});

/**
 * The pre-paint script re-implements the mapping in ES5, because it has to run
 * before any module does. Two copies of a rule drift; this is the gate.
 */
describe("the pre-paint script agrees with the module", () => {
  it("lists the same slots", () => {
    for (const position of NOTIFICATION_POSITIONS) {
      expect(THEME_INIT_SCRIPT).toContain(`'${position}'`);
    }
  });

  it("carries the same opposite-corner mapping", () => {
    for (const position of NOTIFICATION_POSITIONS) {
      expect(THEME_INIT_SCRIPT).toContain(
        `'${position}': '${toastPositionFor(position)}'`,
      );
    }
  });

  it("falls back to the same default", () => {
    expect(THEME_INIT_SCRIPT).toContain(`pos = '${DEFAULT_NOTIFICATION_POSITION}'`);
  });
});
