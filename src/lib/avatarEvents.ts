/**
 * A same-tab announcement that the signed-in user's avatar changed.
 *
 * The settings form already writes the new URL into the tRPC cache, but the
 * header avatar is a separate component mounted by a separate page segment, and
 * anything that resubscribes or refetches between the write and the render can
 * put the old image back. This event is the direct path: the uploader says what
 * the new avatar is, and every consumer shows it immediately, without waiting on
 * a query, a session refresh or a reload.
 */
export const AVATAR_UPDATED_EVENT = "kairos:avatar-updated";

export function broadcastAvatarUpdate(imageUrl: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<{ imageUrl: string }>(AVATAR_UPDATED_EVENT, {
      detail: { imageUrl },
    }),
  );
}

/** Subscribe to avatar changes. Returns the unsubscribe function. */
export function onAvatarUpdate(handler: (imageUrl: string) => void) {
  if (typeof window === "undefined") return () => undefined;

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ imageUrl?: unknown }>).detail;
    if (typeof detail?.imageUrl === "string" && detail.imageUrl) {
      handler(detail.imageUrl);
    }
  };

  window.addEventListener(AVATAR_UPDATED_EVENT, listener);
  return () => window.removeEventListener(AVATAR_UPDATED_EVENT, listener);
}
