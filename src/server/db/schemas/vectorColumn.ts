import { customType } from "drizzle-orm/pg-core";

/**
 * A pgvector `vector(N)` column for Drizzle ORM.
 *
 * Stored as a Postgres vector literal — `[0.1,0.2,…]` — which pgvector reads
 * natively. Serialisation/deserialisation is handled here so every table that
 * carries an embedding uses the same round-trip logic.
 */
export const vectorColumn = (name: string, dimensions = 1536) =>
  customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
    dataType(config) {
      return `vector(${config?.dimensions ?? dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: unknown): number[] {
      const s = String(value);
      return s
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .map(Number);
    },
  })({ name, dimensions });
