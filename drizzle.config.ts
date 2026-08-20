import { type Config } from "drizzle-kit";

export default {
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Use the direct (non-pooler) connection for migrations/introspection.
    // The Supabase pooler (PgBouncer transaction mode) does not support
    // DDL introspection queries that drizzle-kit needs.
    url: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL!,
  },
} satisfies Config;
