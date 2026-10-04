/**
 * Browser side of Web Push: detection, service-worker registration, subscribe.
 *
 * iOS adds two rules the other platforms do not have, and most of this file
 * exists to explain them to the user rather than fail silently:
 * - push exists only in a Home Screen app (`display-mode: standalone`), never
 *   in a Safari tab — there `PushManager` is simply absent;
 * - the permission prompt may only come from a tap, so `subscribe()` must be
 *   called synchronously from a click handler, before any other `await`.
 */

export const SW_URL = "/sw.js";

export type PushState =
  /** The server has no VAPID keys; nothing a user can do. */
  | "unconfigured"
  /** iPhone/iPad in a Safari tab: needs Add to Home Screen first. */
  | "needs-install"
  /** Browser without Push API at all. */
  | "unsupported"
  | "denied"
  | "off"
  | "on";

export function isIOS(nav: Navigator = navigator): boolean {
  // iPadOS 13+ reports itself as a Mac; touch points give it away.
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
}

export function isStandalone(win: Window = window): boolean {
  const legacy = (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return legacy || win.matchMedia?.("(display-mode: standalone)").matches === true;
}

export function isPushSupported(win: Window = window): boolean {
  return "serviceWorker" in win.navigator && "PushManager" in win && "Notification" in win;
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
  } catch {
    return null;
  }
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Which of the states above this device is in, given server configuration. */
export async function detectPushState(serverConfigured: boolean): Promise<PushState> {
  if (!serverConfigured) return "unconfigured";
  if (!isPushSupported()) return isIOS() && !isStandalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return (await getCurrentSubscription()) ? "on" : "off";
}

export interface SerializedSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

export function serialize(sub: PushSubscription): SerializedSubscription | null {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return null;
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    userAgent: navigator.userAgent.slice(0, 512),
  };
}

/**
 * Ask for permission and subscribe. Call straight from a click handler: the
 * permission request is the first await, as iOS requires.
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<SerializedSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "denied" : "dismissed");

  const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await registerServiceWorker());
  if (!reg) throw new Error("no-service-worker");
  await navigator.serviceWorker.ready;

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));

  const serialized = serialize(sub);
  if (!serialized) throw new Error("bad-subscription");
  return serialized;
}

/** Unsubscribe this browser. Returns the endpoint so the server row can go too. */
export async function unsubscribeFromPush(): Promise<string | null> {
  const sub = await getCurrentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  return endpoint;
}

export async function setAppBadge(count: number): Promise<void> {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    /* badge permission not granted; nothing to do */
  }
}
