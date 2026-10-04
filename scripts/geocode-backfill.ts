/**
 * Geocode every event that has a venue or address but no coordinates yet.
 *
 * Usage:
 *   pnpm db:geocode
 *
 * New and edited events are geocoded as they are saved; this is for the ones
 * written before `0050_event_coordinates`, and for any whose geocode failed.
 * One Nominatim request a second (their usage policy), so it is slow on purpose.
 *
 * Safe to interrupt and re-run: it only fills rows whose coordinates are NULL.
 * An event that genuinely does not geocode stays NULL and is tried again on the
 * next run — cheap at this table's size.
 *
 * Runs with the `react-server` export condition so the app's `server-only`
 * modules resolve to their no-op build outside Next.js.
 */

import { and, eq, isNull, or, isNotNull } from "drizzle-orm";

import { db } from "../src/server/db";
import { events } from "../src/server/db/schema";
import { geocodePlace } from "../src/server/geo/geocode";

async function main(): Promise<void> {
  const pending = await db
    .select({
      id: events.id,
      venue: events.venue,
      address: events.address,
      region: events.region,
    })
    .from(events)
    .where(and(isNull(events.latitude), or(isNotNull(events.venue), isNotNull(events.address))));

  let found = 0;
  for (const row of pending) {
    const point = await geocodePlace(row);
    if (point) {
      await db
        .update(events)
        .set({ latitude: point.lat, longitude: point.lng })
        .where(eq(events.id, row.id));
      found++;
    }
    console.log(`event ${row.id}  ${point ? `${point.lat}, ${point.lng}` : "not found"}`);
  }

  console.log(`done: ${found} of ${pending.length} geocoded`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
