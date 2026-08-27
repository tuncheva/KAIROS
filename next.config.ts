import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/config.ts");

const nextConfig: NextConfig = {
  // Keep pdfjs-dist out of the webpack/turbopack bundle — its legacy build
  // references worker files that bundlers cannot statically resolve.
  // redis is an optional peer dependency and should not be bundled
  serverExternalPackages: ["pdfjs-dist", "redis"],
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
