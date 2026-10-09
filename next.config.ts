import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/config.ts");

const nextConfig: NextConfig = {
  // Keep pdfjs-dist out of the webpack/turbopack bundle — its legacy build
  // references worker files that bundlers cannot statically resolve.
  // redis is an optional peer dependency and should not be bundled
  serverExternalPackages: ["pdfjs-dist", "redis", "web-push"],
  // Phosphor isn't on Next's default list, so without this dev compiled all
  // ~4,500 icon modules per layer (cold `/` took ~70s) to render ~60 icons.
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react"],
  },
  // The service worker must never be served stale: a cached old worker keeps
  // handling pushes with old code until the browser's 24h update check.
  // The proxy skips dotted paths, so these are the only headers it gets.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "utfs.io",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
