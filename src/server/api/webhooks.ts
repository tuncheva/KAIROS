/**
 * Outbound webhooks: signing, delivery, and knowing when to stop.
 *
 * The complement to API keys — those let something call in, these let the product
 * call out. What makes this more than `fetch` is everything around the request:
 *
 * **Signed.** The receiver has no other way to know a POST came from us. HMAC-
 * SHA256 over `{timestamp}.{body}`, with the timestamp inside the signed material
 * so a captured delivery cannot be replayed against the endpoint a week later.
 *
 * **Bounded.** A user-supplied URL is a request this server makes on someone
 * else's behalf, which is an SSRF surface. The URL is validated at the boundary,
 * the request has a hard timeout, and the response is read only far enough to log
 * a diagnosis.
 *
 * **Self-limiting.** Failures are counted and a persistently dead endpoint is
 * disabled. A webhook that posts to a gone host on every workspace change is an
 * outbound flood nobody asked for, and the person who suffers is whoever owns the
 * address that replaced it.
 */

import "server-only";

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { webhookDeliveries, webhooks } from "~/server/db/schema";
import { createLogger } from "~/server/logger";

import {
  generateWebhookSecret,
  isAllowedWebhookUrl,
  signPayload,
} from "./webhookSecurity";

// Re-exported so callers have one import site for "webhooks", and so moving the
// pure half out is not a change every consumer has to notice.
export { generateWebhookSecret, isAllowedWebhookUrl, signPayload };

const log = createLogger("api.webhooks");

/** Attempts per delivery, including the first. */
const MAX_ATTEMPTS = 3;

/** Backoff before each retry, in ms. Short: nobody is waiting, but nothing queues. */
const RETRY_DELAYS_MS = [500, 2_000];

/** Per-attempt timeout. A slow endpoint must not hold a connection open. */
const TIMEOUT_MS = 5_000;

/** Consecutive failed deliveries before the webhook is switched off. */
const MAX_FAILURES = 10;

/** How much of a response body is kept for diagnosis. */
const DETAIL_LIMIT = 500;

export interface DeliveryOutcome {
  ok: boolean;
  statusCode: number | null;
  attempts: number;
  detail: string | null;
}

async function attemptOnce(input: {
  url: string;
  secret: string;
  event: string;
  body: string;
}): Promise<{ ok: boolean; statusCode: number | null; detail: string | null }> {
  const timestamp = Date.now();
  const signature = signPayload({
    secret: input.secret,
    timestamp,
    body: input.body,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Kairos-Event": input.event,
        "X-Kairos-Timestamp": String(timestamp),
        "X-Kairos-Signature": `sha256=${signature}`,
        "User-Agent": "KAIROS-Webhook/1",
      },
      body: input.body,
      signal: controller.signal,
      // No redirect following: a 302 to a private address would walk straight
      // around `isAllowedWebhookUrl`, which only ever saw the original URL.
      redirect: "manual",
    });

    const text = await response.text().catch(() => "");

    return {
      ok: response.status >= 200 && response.status < 300,
      statusCode: response.status,
      detail: text.slice(0, DETAIL_LIMIT) || null,
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      detail:
        err instanceof Error ? err.message.slice(0, DETAIL_LIMIT) : "request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Whether a failure is worth trying again. */
function isRetryable(statusCode: number | null): boolean {
  // A network error or timeout has no status and is worth a retry.
  if (statusCode === null) return true;
  // 4xx means the receiver understood and refused — retrying will refuse again,
  // and hammering an endpoint that said "no" is how a webhook gets blocked.
  // 429 is the exception: it is an explicit "later".
  if (statusCode === 429) return true;
  return statusCode >= 500;
}

/**
 * Deliver one event to one webhook, with retries, and record what happened.
 *
 * Never throws. A dispatch failure must not propagate into whatever workspace
 * operation triggered it — a user creating a task should not see an error because
 * their own webhook endpoint is down.
 */
export async function deliverWebhook(input: {
  webhookId: number;
  url: string;
  secret: string;
  event: string;
  payload: unknown;
  failureCount: number;
}): Promise<DeliveryOutcome> {
  const body = JSON.stringify({
    event: input.event,
    createdAt: new Date().toISOString(),
    data: input.payload,
  });

  let attempts = 0;
  let last = { ok: false, statusCode: null as number | null, detail: null as string | null };

  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    attempts += 1;
    last = await attemptOnce({
      url: input.url,
      secret: input.secret,
      event: input.event,
      body,
    });

    if (last.ok) break;
    if (!isRetryable(last.statusCode)) break;

    const delay = RETRY_DELAYS_MS[i];
    if (delay === undefined) break;
    await new Promise((r) => setTimeout(r, delay));
  }

  await db.insert(webhookDeliveries).values({
    webhookId: input.webhookId,
    event: input.event,
    statusCode: last.statusCode,
    attempts,
    detail: last.detail,
    ok: last.ok,
  });

  if (last.ok) {
    // Only write on a change: a healthy webhook should not issue an update per
    // delivery to say its failure count is still zero.
    if (input.failureCount > 0) {
      await db
        .update(webhooks)
        .set({ failureCount: 0, updatedAt: new Date() })
        .where(eq(webhooks.id, input.webhookId));
    }
  } else {
    const failures = input.failureCount + 1;
    const disable = failures >= MAX_FAILURES;

    await db
      .update(webhooks)
      .set({
        failureCount: failures,
        ...(disable ? { enabled: false } : {}),
        updatedAt: new Date(),
      })
      .where(eq(webhooks.id, input.webhookId));

    if (disable) {
      log.warn("webhook disabled after repeated failures", {
        webhookId: input.webhookId,
        failures,
      });
    }
  }

  return { ...last, attempts };
}

/**
 * Fan an event out to a user's enabled webhooks.
 *
 * Fire-and-forget from the caller's point of view, and sequential rather than
 * parallel: a user with several webhooks is not worth several simultaneous
 * outbound connections from a request handler, and the ordering makes the
 * delivery log readable.
 */
export async function dispatchEvent(input: {
  userId: string;
  event: string;
  payload: unknown;
}): Promise<void> {
  const rows = await db
    .select({
      id: webhooks.id,
      url: webhooks.url,
      secret: webhooks.secret,
      events: webhooks.events,
      failureCount: webhooks.failureCount,
    })
    .from(webhooks)
    .where(eq(webhooks.userId, input.userId));

  for (const row of rows) {
    // An empty filter means everything — the useful default for someone wiring up
    // their first webhook, who does not yet know the event names.
    const wanted = row.events
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (wanted.length && !wanted.includes(input.event)) continue;

    try {
      await deliverWebhook({
        webhookId: row.id,
        url: row.url,
        secret: row.secret,
        event: input.event,
        payload: input.payload,
        failureCount: row.failureCount,
      });
    } catch (err) {
      // `deliverWebhook` does not throw, so this is belt and braces — but a
      // dispatch loop that can abort halfway would silently skip every webhook
      // after the one that failed.
      log.error("webhook dispatch threw", { webhookId: row.id, err });
    }
  }
}

/** Exposed for tests. */
export const WEBHOOK_LIMITS = {
  maxAttempts: MAX_ATTEMPTS,
  maxFailures: MAX_FAILURES,
  timeoutMs: TIMEOUT_MS,
} as const;
