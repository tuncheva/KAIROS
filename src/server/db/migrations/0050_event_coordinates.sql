-- Coordinates for an event's venue, so the event page can draw a map.
--
-- Filled once when an event is created or its venue, address or town changes,
-- by geocoding through OpenStreetMap Nominatim (`~/server/geo/geocode`). Stored
-- rather than looked up per view because Nominatim's usage policy asks for
-- results to be cached, and because a page view should not wait on a third party.
--
-- Additive only, and nullable: every existing event keeps working, and a null
-- pair means the page centres on the town instead. `pnpm db:geocode` fills in
-- the back catalogue.

ALTER TABLE "event" ADD COLUMN IF NOT EXISTS "latitude" double precision;
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN IF NOT EXISTS "longitude" double precision;
