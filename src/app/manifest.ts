import type { MetadataRoute } from "next";

/**
 * Makes "Add to Home Screen" install KAIROS as an app rather than a bookmark.
 *
 * `display: "standalone"` is what iOS checks before it will offer Web Push at
 * all (iOS 16.4+): a Home Screen icon without it opens in Safari and cannot
 * subscribe. `id` pins the app's identity to the root so a later change to
 * `start_url` does not orphan existing installs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "KAIROS",
    short_name: "KAIROS",
    description: "Coordinate events, manage projects, and collaborate with your team",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0f",
    theme_color: "#0a0a0f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
