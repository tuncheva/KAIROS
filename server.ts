/**
 * Custom Next.js server.
 *
 * WebSocket handling has moved to a standalone process (ws-server/).
 * This server only handles HTTP requests via Next.js.
 *
 * Usage:
 *   dev:   pnpm dev                   (Next.js on webpack; plain `node`, Node >= 22.18)
 *          Plain node rather than tsx: Node strips this file's types natively,
 *          and tsx's loader otherwise hooks every require of Next's compiled
 *          chunks — cold compiles ran 1.5-2x slower under it. Not a watcher
 *          either: Next hot-reloads src/, next.config and .env itself, and the
 *          watcher restarted this whole process (a cold recompile) on top of
 *          that. Restart by hand after editing this file. The larger heap is
 *          because dev keeps every compiled route in one process, and a dev
 *          server near the default ~4 GB limit stalled and then died.
 *          pnpm ws:dev                (WS server — separate terminal)
 *   prod:  node --import tsx server.ts
 */

import { createServer } from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = parseInt(process.env.PORT ?? "3000", 10);

// Dev uses webpack unless NEXT_DEV_BUNDLER=turbopack. Under Turbopack (Next
// 16.1.1, Windows) a signed-in page load pinned the main thread in native code
// for minutes — every request, tRPC included, queued behind it (50-114s per
// procedure, Supabase CONNECT_TIMEOUTs). The same load under webpack served
// each procedure in 0.3-1.9s. Production builds are unaffected (`next build`).
const turbopack = process.env.NEXT_DEV_BUNDLER === "turbopack";
const app = next({ dev, hostname, port, ...(turbopack ? { turbopack: true } : { webpack: true }) });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const httpServer = createServer((req, res) => {
      void handle(req, res);
    });

    httpServer.listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });

    // Dev only: say so when the process itself is the bottleneck. A request
    // that "takes 95s" while every query is fast means the event loop was
    // blocked (GC pressure, a sync hot path), and nothing else surfaces that.
    if (dev) {
      const lag = monitorEventLoopDelay({ resolution: 50 });
      lag.enable();
      setInterval(() => {
        const maxMs = lag.max / 1e6;
        if (maxMs > 1000) {
          const heapMb = Math.round(process.memoryUsage().heapUsed / 1048576);
          const rssMb = Math.round(process.memoryUsage().rss / 1048576);
          console.warn(`> event loop blocked up to ${Math.round(maxMs)}ms (heap ${heapMb} MB, rss ${rssMb} MB)`);
        }
        lag.reset();
      }, 10_000).unref();
    }
  })
  .catch((err: unknown) => {
    // Without this the promise was unhandled: a failure during Next's prepare
    // step left the process alive with no server listening and nothing logged.
    console.error("> Failed to start server", err);
    process.exit(1);
  });
