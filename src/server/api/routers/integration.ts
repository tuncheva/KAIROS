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
import { webhookDeliveries, webhooks } from "~/server/db/schema";
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
