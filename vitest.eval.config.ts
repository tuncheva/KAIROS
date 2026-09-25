import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Live eval: the golden set against the configured model.
 *
 * Separate from the default config because it spends real model calls and takes
 * minutes, not seconds. Node environment, no database — every tool is stubbed in
 * the test itself. Run with `pnpm eval:live`; see
 * `tests/agents/evals/routing.live.test.ts`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["./tests/**/*.live.test.ts"],
    // One case can take a tool loop of several completions, and a free tier on
    // a bad day answers in minutes rather than seconds. Results are written
    // after every case, so hitting this still leaves a partial report.
    testTimeout: 4 * 60 * 60 * 1000,
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
      // See vitest.config.ts — `server-only` is a no-op under Vitest.
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
