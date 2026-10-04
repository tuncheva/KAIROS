import { describe, expect, it } from "vitest";
import { detectPushState, isIOS, isStandalone, urlBase64ToUint8Array } from "~/lib/pushClient";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

function nav(userAgent: string, extra: Partial<Navigator> = {}): Navigator {
  return { userAgent, platform: "", maxTouchPoints: 0, ...extra } as Navigator;
}

describe("isIOS", () => {
  it("recognises an iPhone", () => {
    expect(isIOS(nav(IPHONE))).toBe(true);
  });

  it("recognises an iPad that reports itself as a Mac", () => {
    expect(isIOS(nav(MAC, { platform: "MacIntel", maxTouchPoints: 5 }))).toBe(true);
  });

  it("does not mistake a real Mac for an iPad", () => {
    expect(isIOS(nav(MAC, { platform: "MacIntel", maxTouchPoints: 0 }))).toBe(false);
  });
});

describe("isStandalone", () => {
  const win = (standalone: boolean | undefined, displayMode: boolean) =>
    ({
      navigator: { standalone },
      matchMedia: () => ({ matches: displayMode }),
    }) as unknown as Window;

  it("is true in an iOS Home Screen app", () => {
    expect(isStandalone(win(true, false))).toBe(true);
  });

  it("is true when display-mode is standalone", () => {
    expect(isStandalone(win(undefined, true))).toBe(true);
  });

  it("is false in a browser tab", () => {
    expect(isStandalone(win(false, false))).toBe(false);
  });
});

describe("detectPushState", () => {
  it("reports unconfigured before anything else", async () => {
    await expect(detectPushState(false)).resolves.toBe("unconfigured");
  });

  it("reports unsupported where the Push API is missing (jsdom)", async () => {
    // jsdom has no PushManager and is not iOS.
    await expect(detectPushState(true)).resolves.toBe("unsupported");
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes an unpadded base64url VAPID key", () => {
    const bytes = urlBase64ToUint8Array("AQID_-8");
    expect(Array.from(bytes)).toEqual([1, 2, 3, 255, 239]);
  });
});
