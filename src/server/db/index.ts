import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "~/env";
import * as schema from "./schema";


const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};


// No fallback: DATABASE_URL is required in `~/env`. Silently defaulting to a
// hardcoded localhost connection string is how a misconfigured deploy ends up
// reading and writing the wrong database instead of refusing to start.
const conn = globalForDb.conn ?? postgres(env.DATABASE_URL, {
  max: 3,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  prepare: false,
});

globalForDb.conn = conn;

export const db = drizzle(conn, { schema });