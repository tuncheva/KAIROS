/**
 * `listConversations` — the SQL it actually sends.
 *
 * The conversation list failed with `operator does not exist: character varying
 * = integer` on every request, which took the chat's history sidebar with it.
 * The cause was a correlated subquery written with an unqualified reference:
 *
 *   SELECT count(*) FROM "ai_messages" AS m WHERE m.conversation_id = "id"
 *
 * Drizzle renders a bare column as `"id"`, and inside that subquery `"id"`
 * resolves against `ai_messages` — its own integer primary key — not against
 * the outer conversation. Postgres then compared a varchar to an integer.
 *
 * The query is exercised through the real function against a stub driver rather
 * than rebuilt here: a copy of the query would keep passing while the real one
 * regressed.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it } from "vitest";

import { listConversations } from "~/server/llm/conversations";
import type { TRPCContext } from "~/server/api/trpc";

/**
 * Captures the SQL drizzle hands to postgres.js, and returns no rows.
 *
 * postgres.js results are awaitable *and* carry `.values()`, which is the shape
 * drizzle reaches for when it wants positional rows — so the stub has to be
 * both.
 */
function captureQuery() {
  const sent: Array<{ sql: string; params: unknown[] }> = [];
  const emptyResult = () => {
    const rows: unknown[] = [];
    return Object.assign(Promise.resolve(rows), {
      values: () => Promise.resolve(rows),
      execute: () => Promise.resolve(rows),
    });
  };
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe: (sql: string, params: unknown[]) => {
      sent.push({ sql, params });
      return emptyResult();
    },
  };
  return { sent, db: drizzle({ client: client as never }) };
}

describe("listConversations", () => {
  it("correlates the message count to the outer conversation, table-qualified", async () => {
    const { sent, db } = captureQuery();

    await listConversations({ db } as unknown as TRPCContext, "user-1", 30);

    const sql = sent[0]?.sql ?? "";
    expect(sql).toContain('m.conversation_id = "ai_conversations"."id"');
    // The unqualified form is the bug: it binds to `ai_messages.id`.
    expect(sql).not.toMatch(/m\.conversation_id\s*=\s*"id"/);
  });

  it("scopes the query to the caller and honours the limit", async () => {
    const { sent, db } = captureQuery();

    await listConversations({ db } as unknown as TRPCContext, "user-1", 7);

    expect(sent[0]?.sql).toContain('"ai_conversations"."user_id" = ');
    expect(sent[0]?.params).toEqual(["user-1", 7]);
  });
});
