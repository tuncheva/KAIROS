/**
 * GET /api/export/{csv|markdown|ics} — take your data with you.
 *
 * A route handler rather than a tRPC procedure, because tRPC is the wrong
 * transport for a file: it serialises through superjson into a JSON envelope, so
 * a client would have to decode a payload and synthesise a download from it. A
 * plain response with `Content-Disposition` is what a browser already knows how
 * to save.
 *
 * This replaces `settings.requestDataExport`, which returned
 * "You'll receive an email when it's ready" and then did nothing at all — a
 * button that lies is worse than no button. There is no job queue here on
 * purpose: one user's tasks, notes and events are bounded (see the caps in
 * `collect.ts`), so the export is built and streamed inside the request.
 *
 * Format is part of the paywall. Free exports its tasks as CSV; Pro exports
 * everything. A fully paywalled export reads as hostage-taking, and "can I get
 * my data out" is a question a buyer asks before they commit — see
 * `lib/entitlements`.
 */

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import type { TRPCContext } from "~/server/api/trpc";
import { entitlementsFor } from "~/server/billing/entitlements";
import type { ExportFormat } from "~/lib/entitlements";
import { createLogger } from "~/server/logger";
import { collectExport } from "~/server/export/collect";
import { toCsv, toIcs, toMarkdown } from "~/server/export/formatters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api.export");

const FORMATS: Record<
  ExportFormat,
  { contentType: string; extension: string }
> = {
  csv: { contentType: "text/csv; charset=utf-8", extension: "csv" },
  markdown: { contentType: "text/markdown; charset=utf-8", extension: "md" },
  ics: { contentType: "text/calendar; charset=utf-8", extension: "ics" },
};

function isFormat(value: string): value is ExportFormat {
  return Object.hasOwn(FORMATS, value);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ format: string }> },
) {
  const { format } = await params;

  if (!isFormat(format)) {
    return new Response("Unknown export format", { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;

  // The handler builds its own context rather than receiving one: `collectExport`
  // takes a `TRPCContext` so it can share `loadVisibleScope` with the agent layer,
  // which is the entire reason the scoping is trustworthy here.
  const ctx = { db, session, headers: new Headers() } as TRPCContext;

  const entitlements = entitlementsFor(ctx);
  if (!entitlements.exportFormats.includes(format)) {
    // 403 rather than 404: the format exists, this plan does not include it, and
    // the client needs to be able to tell those apart to offer an upgrade.
    return new Response("This export format is not included in your plan", {
      status: 403,
    });
  }

  try {
    const bundle = await collectExport(ctx, userId);

    const body =
      format === "csv"
        ? toCsv(bundle.tasks)
        : format === "markdown"
          ? toMarkdown(bundle)
          : toIcs(bundle);

    const { contentType, extension } = FORMATS[format];
    const stamp = bundle.exportedAt.toISOString().slice(0, 10);

    log.info("export served", {
      userId,
      format,
      tasks: bundle.tasks.length,
      notes: bundle.notes.length,
      events: bundle.events.length,
      bytes: body.length,
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // The filename is fixed by the server, not echoed from input, so there is
        // nothing here for a header-injection attempt to steer.
        "Content-Disposition": `attachment; filename="kairos-export-${stamp}.${extension}"`,
        // An export is a snapshot of live data and must never be served from a
        // shared cache — `private, no-store` is doing real work on this route.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    log.error("export failed", { userId, format, err });
    return new Response("Export failed", { status: 500 });
  }
}
