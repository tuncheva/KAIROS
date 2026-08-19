import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Integration suite: real tRPC procedures against a real Postgres.
 *
 * Separate from the default config because these tests need the node environment
 * (not jsdom), no React plugin, a real `DATABASE_URL`, and far longer timeouts —
 * provisioning a scratch schema runs the whole migration set.
 *
 * See `tests/integration/harness.ts` for how isolation works: each run builds its
 * own schema and drops it afterwards, so this is safe against a database that holds
 * real data.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["./tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // One worker: every file provisions a schema, and running them in parallel
    // multiplies connections against the same instance for no gain.
    fileParallelism: false,
    server: {
      deps: {
        // `appRouter` reaches `~/server/auth` -> next-auth, whose ESM entry imports
        // "next/server" without an extension. Node's resolver rejects that; letting
        // Vite transform these packages lets its resolver handle the exports map.
        inline: ["next-auth", "@auth/core", "@auth/drizzle-adapter"],
      },
    },
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
});
