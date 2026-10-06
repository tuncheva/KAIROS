import { sql } from "drizzle-orm";

/**
 * A timestamp, bound as one, for use inside a raw `sql` template.
 *
 * Inside a raw template a `Date` never reaches drizzle's column mapper — it goes
 * straight to postgres-js, which cannot infer a type for it and throws
 * ("Received an instance of Date") the moment the statement is bound. An ISO
 * string with an explicit cast is unambiguous to both.
 *
 * Typed comparisons (`gte(tasks.dueDate, now)`) do not need this: drizzle maps
 * the value through the column there. Only `${date}` inside `sql\`...\`` does.
 */
export function ts(value: Date) {
  return sql`${value.toISOString()}::timestamptz`;
}
