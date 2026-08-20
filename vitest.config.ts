import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.tsx"],
    // Integration tests run under `pnpm test:integration` with their own config:
    // they need the node environment and a real database, and pulling them into the
    // default jsdom suite would make every run depend on DATABASE_URL.
    include: ["./tests/**/*.test.{ts,tsx}"],
    exclude: ["./tests/integration/**"],
    css: true,
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
      // `server-only` exports a throwing build under the node/default export
      // conditions that Vitest resolves with. In tests it is a no-op — see
      // tests/stubs/server-only.ts.
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
