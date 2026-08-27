/**
 * API keys and webhooks.
 *
 * Its own router rather than a corner of `agent`, for the same reason billing is:
 * these are account-level integration concerns and the assistant is merely one
 * thing a key can reach.
 *
 * Everything here is gated on `entitlements.apiAccess`, checked per procedure
 * rather than once at the router. A single guard at the top reads as tidier and
 * fails open the moment somebody adds a procedure below it.
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { entitlementsFor } from "~/server/billing/entitlements";
import {
  calendarConnections,
  documents,
  externalEvents,
  webhookDeliveries,
  webhooks,
} from "~/server/db/schema";
import { isGoogleCalendarConfigured } from "~/server/calendar/google";
import { syncConnection } from "~/server/calendar/sync";
import { assertProjectAccess } from "~/server/api/authz";
import {
  MAX_DOCUMENT_BYTES,
  ingestDocument,
  isSupportedDocumentType,
} from "~/server/llm/documents/ingest";
import {
  listApiKeys,
  mintApiKey,
  revokeApiKey,
} from "~/server/api/apiKeys";
import {
  generateWebhookSecret,
  isAllowedWebhookUrl,
} from "~/server/api/webhooks";

/** How many live keys and webhooks one account may hold. */
const MAX_KEYS = 10;
const MAX_WEBHOOKS = 5;

function assertDocuments(ctx: Parameters<typeof entitlementsFor>[0]): void {
  if (!entitlementsFor(ctx).documents) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Document search is a Pro feature.",
    });
  }
}

function assertApiAccess(ctx: Parameters<typeof entitlementsFor>[0]): void {
  if (!entitlementsFor(ctx).apiAccess) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "API access is a Pro feature.",
    });
  }
}

export const integrationRouter = createTRPCRouter({
  // ---- API keys -----------------------------------------------------------

  keys: protectedProcedure.query(async ({ ctx }) => {
    assertApiAccess(ctx);
    return listApiKeys(ctx.session.user.id);
  }),

  /**
   * Mint a key.
   *
   * The response carries the plaintext, and it is the only time it ever will —
   * nothing stores it and nothing can recover it. The client must show it once
   * and say so.
   */
  createKey: protectedProcedure
    .input(z.object({ label: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      assertApiAccess(ctx);

      const existing = await listApiKeys(ctx.session.user.id);
      // Revoked keys are kept for the audit trail, so the cap counts live ones.
      const live = existing.filter((k) => !k.revokedAt).length;

      if (live >= MAX_KEYS) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `You can have ${String(MAX_KEYS)} active keys. Revoke one to create another.`,
        });
      }

      const minted = await mintApiKey({
        userId: ctx.session.user.id,
        label: input.label,
      });

      return {
        id: minted.id,
        prefix: minted.prefix,
        /** Shown once. Never retrievable again. */
        plaintext: minted.plaintext,
      };
    }),

  revokeKey: protectedProcedure
    .input(z.object({ keyId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      assertApiAccess(ctx);

      const revoked = await revokeApiKey({
        userId: ctx.session.user.id,
        keyId: input.keyId,
      });

      if (!revoked) {
        // Covers "not yours", "does not exist" and "already revoked" alike. The
        // distinctions are only useful to someone probing for key ids.
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No active key with that id.",
        });
      }

      return { ok: true };
    }),

  // ---- Webhooks -----------------------------------------------------------

  webhooks: protectedProcedure.query(async ({ ctx }) => {
    assertApiAccess(ctx);

    return ctx.db
      .select({
        id: webhooks.id,
        url: webhooks.url,
        events: webhooks.events,
        enabled: webhooks.enabled,
        failureCount: webhooks.failureCount,
        createdAt: webhooks.createdAt,
      })
      .from(webhooks)
      .where(eq(webhooks.userId, ctx.session.user.id))
      .orderBy(webhooks.id);
  }),

  createWebhook: protectedProcedure
    .input(
      z.object({
        url: z.string().url().max(2000),
        /** Event names, or empty for everything. */
        events: z.array(z.string().max(64)).max(20).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertApiAccess(ctx);

      // Validated here as well as at delivery time. Refusing at registration is
      // what makes the rule visible to the user; the delivery-time check is what
      // makes it hold for rows that predate a tightening of the rule.
      if (!isAllowedWebhookUrl(input.url)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That URL cannot be used. Webhooks must be HTTPS and must not point at a private or internal address.",
        });
      }

      const [{ count } = { count: 0 }] = await ctx.db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(webhooks)
        .where(eq(webhooks.userId, ctx.session.user.id));

      if (count >= MAX_WEBHOOKS) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `You can have ${String(MAX_WEBHOOKS)} webhooks. Delete one to add another.`,
        });
      }

      const secret = generateWebhookSecret();

      const [row] = await ctx.db
        .insert(webhooks)
        .values({
          userId: ctx.session.user.id,
          url: input.url,
          secret,
          events: input.events.join(","),
        })
        .returning({ id: webhooks.id });

      return {
        id: row?.id ?? null,
        /** Shown once — the receiver needs it to verify signatures. */
        secret,
      };
    }),

  updateWebhook: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        events: z.array(z.string().max(64)).max(20).optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertApiAccess(ctx);

      const updated = await ctx.db
        .update(webhooks)
        .set({
          ...(input.events !== undefined
            ? { events: input.events.join(",") }
            : {}),
          // Re-enabling clears the failure count. The user has presumably fixed
          // the endpoint, and holding nine strikes against it would disable it
          // again on the next hiccup.
          ...(input.enabled !== undefined
            ? { enabled: input.enabled, ...(input.enabled ? { failureCount: 0 } : {}) }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(webhooks.id, input.id),
            eq(webhooks.userId, ctx.session.user.id),
          ),
        )
        .returning({ id: webhooks.id });

      if (!updated.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found." });
      }

      return { ok: true };
    }),

  deleteWebhook: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      assertApiAccess(ctx);

      await ctx.db
        .delete(webhooks)
        .where(
          and(
            eq(webhooks.id, input.id),
            eq(webhooks.userId, ctx.session.user.id),
          ),
        );

      return { ok: true };
    }),

  // ---- Calendar -----------------------------------------------------------

  /**
   * The caller's calendar connection, if any.
   *
   * Never returns a token, encrypted or otherwise. What the UI needs is whether a
   * calendar is attached, which account, when it last synced and whether it is
   * currently failing — and a token in a tRPC response would end up in a browser
   * cache and a network log for no reason.
   */
  calendar: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({
        id: calendarConnections.id,
        provider: calendarConnections.provider,
        accountEmail: calendarConnections.accountEmail,
        lastSyncedAt: calendarConnections.lastSyncedAt,
        lastError: calendarConnections.lastError,
        failureCount: calendarConnections.failureCount,
        createdAt: calendarConnections.createdAt,
      })
      .from(calendarConnections)
      .where(eq(calendarConnections.userId, ctx.session.user.id))
      .limit(1);

    const [{ count } = { count: 0 }] = row
      ? await ctx.db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(externalEvents)
          .where(eq(externalEvents.connectionId, row.id))
      : [{ count: 0 }];

    return {
      connection: row ?? null,
      eventCount: count,
      // Reported separately rather than as one `available` boolean. The two
      // reasons a Connect button would dead-end are not interchangeable: a Free
      // plan is an upgrade prompt, a missing client id is a deployment gap the
      // user can do nothing about, and collapsing them means the UI has to guess.
      entitled: entitlementsFor(ctx).calendarSync,
      configured: isGoogleCalendarConfigured(),
    };
  }),

  /** Pull now, rather than waiting for the next sweep. */
  syncCalendar: protectedProcedure.mutation(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ id: calendarConnections.id })
      .from(calendarConnections)
      .where(eq(calendarConnections.userId, ctx.session.user.id))
      .limit(1);

    if (!row) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No calendar is connected.",
      });
    }

    return syncConnection(row.id);
  }),

  /**
   * Disconnect.
   *
   * Deletes the connection, which cascades to the imported events — the right
   * behaviour, because those rows are a shadow of a calendar we can no longer
   * read and would otherwise sit there going stale forever.
   *
   * It does *not* revoke the grant at Google. That needs a separate call and can
   * fail independently, and a disconnect that appeared to fail because revocation
   * timed out would leave the user unsure what state they are in. The tokens are
   * destroyed here, so the practical effect is the same.
   */
  disconnectCalendar: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .delete(calendarConnections)
      .where(eq(calendarConnections.userId, ctx.session.user.id));

    return { ok: true };
  }),

  // ---- Documents ----------------------------------------------------------

  documents: protectedProcedure.query(async ({ ctx }) => {
    assertDocuments(ctx);

    return ctx.db
      .select({
        id: documents.id,
        filename: documents.filename,
        projectId: documents.projectId,
        status: documents.status,
        error: documents.error,
        pageCount: documents.pageCount,
        chunkCount: documents.chunkCount,
        truncated: documents.truncated,
        sizeBytes: documents.sizeBytes,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(eq(documents.userId, ctx.session.user.id))
      .orderBy(desc(documents.createdAt));
  }),

  /**
   * Register an uploaded file and index it.
   *
   * Two steps rather than one because the bytes are already at the upload
   * provider by the time this is called — the client uploads directly, and this
   * records what arrived and turns it into passages.
   *
   * Indexing runs inline. It is bounded (see the caps in `ingest.ts`) and this
   * way the user learns immediately whether their file is searchable, rather than
   * watching a `pending` row and wondering. A job queue is the right answer at a
   * scale this product is not at.
   */
  addDocument: protectedProcedure
    .input(
      z.object({
        filename: z.string().trim().min(1).max(256),
        storageKey: z.string().url().max(2000),
        mimeType: z.string().max(128),
        sizeBytes: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
        projectId: z.number().int().positive().nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertDocuments(ctx);

      if (!isSupportedDocumentType(input.mimeType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only PDF and plain-text files can be indexed.",
        });
      }

      // A document attached to a project is visible to everyone who can see that
      // project, so the caller must be able to write to it — read access would
      // let someone add a document to a project they can only look at.
      if (input.projectId !== null) {
        await assertProjectAccess(ctx, input.projectId, "write");
      }

      const [row] = await ctx.db
        .insert(documents)
        .values({
          userId: ctx.session.user.id,
          projectId: input.projectId,
          filename: input.filename,
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
        })
        .returning({ id: documents.id });

      if (!row) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }

      const result = await ingestDocument(row.id);

      return { id: row.id, ...result };
    }),

  /** Re-index a document — for a `failed` row whose cause has been fixed. */
  reindexDocument: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      assertDocuments(ctx);

      const [owned] = await ctx.db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.id, input.id),
            eq(documents.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (!owned) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document not found." });
      }

      return ingestDocument(input.id);
    }),

  deleteDocument: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      assertDocuments(ctx);

      // Chunks cascade. The stored file at the upload provider does not — deleting
      // it needs the provider's API and is a separate concern; what this removes
      // is the product's ability to read it, which is what the user asked for.
      await ctx.db
        .delete(documents)
        .where(
          and(
            eq(documents.id, input.id),
            eq(documents.userId, ctx.session.user.id),
          ),
        );

      return { ok: true };
    }),

  /**
   * Recent delivery attempts for one webhook.
   *
   * The reason the deliveries table is not optional: without this the only answer
   * to "why did my endpoint not fire?" lives in server logs the user cannot read.
   */
  webhookDeliveries: protectedProcedure
    .input(
      z.object({
        webhookId: z.number().int().positive(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      assertApiAccess(ctx);

      // Ownership through the parent row, so a delivery log cannot be read by id
      // alone.
      const [owned] = await ctx.db
        .select({ id: webhooks.id })
        .from(webhooks)
        .where(
          and(
            eq(webhooks.id, input.webhookId),
            eq(webhooks.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (!owned) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found." });
      }

      return ctx.db
        .select({
          id: webhookDeliveries.id,
          event: webhookDeliveries.event,
          statusCode: webhookDeliveries.statusCode,
          attempts: webhookDeliveries.attempts,
          ok: webhookDeliveries.ok,
          detail: webhookDeliveries.detail,
          createdAt: webhookDeliveries.createdAt,
        })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.webhookId, input.webhookId))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(input.limit);
    }),
});
