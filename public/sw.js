/*
 * KAIROS service worker — Web Push only.
 *
 * Deliberately no `fetch` handler and no caching: this worker exists so the
 * Home Screen app can receive notifications while closed, and an offline cache
 * would be a second, much larger feature with its own staleness bugs.
 *
 * Payloads are Declarative Web Push (`{ web_push: 8030, notification: {...} }`,
 * see src/server/notifications/push.ts). Safari 18.4+ can display that without
 * us, but it still hands it to this `push` event first; every other browser
 * only ever gets it here. Either way we must show a notification for every
 * push — iOS revokes the permission of a site whose pushes stay silent.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function readPayload(event) {
  if (!event.data) return {};
  try {
    const json = event.data.json();
    return json && typeof json === "object" ? json : {};
  } catch {
    return { notification: { body: event.data.text() } };
  }
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  const n = payload.notification || payload;
  const title = n.title || "KAIROS";
  const url = n.navigate || (n.data && n.data.url) || "/";

  const work = [
    self.registration.showNotification(title, {
      body: n.body || "",
      data: { ...(n.data || {}), url },
      icon: "/icons/icon-192.png",
      // Android draws the badge in the status bar as a silhouette (every opaque
      // pixel turns white), so it must be a white mark on transparency — the
      // full-colour icon would show up as a solid square.
      badge: "/icons/badge-96.png",
      tag: n.data && n.data.notificationId ? `n-${n.data.notificationId}` : undefined,
    }),
  ];

  if (n.app_badge !== undefined && "setAppBadge" in self.navigator) {
    const count = Number(n.app_badge);
    work.push(
      (count > 0 ? self.navigator.setAppBadge(count) : self.navigator.clearAppBadge()).catch(() => {}),
    );
  }

  event.waitUntil(Promise.all(work));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Always navigate within this origin, keeping the payload's path. The server
  // builds absolute URLs from its configured app URL; if that is missing or
  // stale (a localhost default on a deployed site), the path is still right.
  let target = new URL("/", self.location.origin);
  try {
    const candidate = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
    target = new URL(candidate.pathname + candidate.search + candidate.hash, self.location.origin);
  } catch {
    /* keep the root */
  }

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) {
          await client.navigate(target.href).catch(() => {});
        }
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});

/*
 * The push service rotated our subscription. Re-subscribe and tell the server;
 * if this fails (signed out, offline) the app re-syncs on its next open anyway.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const options = event.oldSubscription && event.oldSubscription.options;
      if (!options || !options.applicationServerKey) return;
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: options.applicationServerKey,
      });
      await fetch("/api/trpc/notification.pushSubscribe", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: sub.toJSON() }),
      });
    })().catch(() => {}),
  );
});
