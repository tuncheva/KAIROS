/**
 * Three upcoming events, so the rebuilt feed has something to show.
 *
 * Every event in this database is in the past, and the feed now reads forward
 * through time — so `/publish` is correctly, uselessly empty. These three are
 * shaped to exercise the parts that are new: a nearly-full event with a
 * capacity, a multi-day one with an end date, one already edited, one hosted by
 * somebody else so Follow and the Following lane have something to do.
 *
 * Run with `npx tsx scripts/seed-test-events.mjs`. It prints the ids it created
 * so they can be deleted again in one statement, and it is safe to run twice:
 * an event whose title is already present is left alone rather than duplicated.
 */

import postgres from "postgres";
import fs from "fs";

const url = /DATABASE_URL\s*=\s*"?([^"\n\r]+)"?/.exec(
  fs.readFileSync(new URL("../.env", import.meta.url), "utf-8"),
)[1];
const sql = postgres(url, { max: 1, prepare: false });

/** tinatuncheva27@itpg-varna.bg — the account in the screenshot. */
const HOST = "3a485cf3-7d68-41f8-8137-a27aefd10108";
/** Pavel Rusev, so at least one event is somebody else's to follow. */
const OTHER = "c397a3ac-da0c-43b7-9c68-23ce6a7fa22c";

const day = (iso) => new Date(iso);

const events = [
  {
    title: "Component Systems Night",
    description:
      "Three short talks on design tokens and component APIs, then an open floor.\n\nDoors at 18:30. Drinks after at Kanaal. Bring a laptop if you want to pair on the exercises afterwards.",
    eventDate: day("2026-08-30T19:00:00Z"),
    endsAt: day("2026-08-30T22:00:00Z"),
    region: "sofia",
    venue: "Betahaus Sofia",
    address: "ul. Krum Popov 56-58",
    capacity: 45,
    topic: "tech",
    coverTheme: "ember",
    createdById: HOST,
    enableRsvp: true,
    // Already edited, so the "Edited" label is visible without touching anything.
    updatedAt: day("2026-08-26T09:12:00Z"),
  },
  {
    title: "Varna Design Weekend",
    description:
      "Two days of workshops, portfolio reviews and a small exhibition in the Sea Garden.\n\nSaturday is workshops, Sunday is the exhibition and the reviews. Drop in for either.",
    eventDate: day("2026-09-05T10:00:00Z"),
    endsAt: day("2026-09-06T18:00:00Z"),
    region: "varna",
    venue: "Sea Garden Pavilion",
    address: "Primorski Park",
    capacity: null,
    topic: "art",
    coverTheme: "meadow",
    createdById: OTHER,
    enableRsvp: true,
    updatedAt: null,
  },
  {
    title: "Открита сцена: Есен",
    description:
      "Открита сцена за всеки, който иска да пее, чете или свири. Записване на място от 19:30.",
    eventDate: day("2026-09-14T20:00:00Z"),
    endsAt: null,
    region: "plovdiv",
    venue: "Клуб Петното",
    address: null,
    capacity: 30,
    topic: "music",
    coverTheme: null, // left on Auto, so the derived wash is visible too
    createdById: OTHER,
    enableRsvp: true,
    updatedAt: null,
  },
];

const created = [];

for (const event of events) {
  /* Idempotent on the title. Running a seed twice and quietly getting two of
     everything is how a test database stops being useful. */
  const [existing] = await sql`
    SELECT id FROM event WHERE title = ${event.title} LIMIT 1`;
  if (existing) {
    created.push({ id: existing.id, title: event.title, existed: true });
    continue;
  }

  const [row] = await sql`
    INSERT INTO event (
      title, description, event_date, ends_at, region, venue, address,
      capacity, topic, cover_theme, image_url, "createdById", enable_rsvp,
      send_reminders, reminder_sent, "createdAt", updated_at
    ) VALUES (
      ${event.title}, ${event.description}, ${event.eventDate}, ${event.endsAt},
      ${event.region}, ${event.venue}, ${event.address}, ${event.capacity},
      ${event.topic}, ${event.coverTheme}, null, ${event.createdById}, ${event.enableRsvp},
      false, false, now(), ${event.updatedAt}
    ) RETURNING id`;
  created.push({ id: row.id, title: event.title });
}

const [systems, weekend, openMic] = created;

/* Guests, so the attendance line has faces and the capacity chip has something
   to count against. Everybody except the host of each event. */
const guests = (
  await sql`SELECT id FROM "user" WHERE id NOT IN (${HOST}, ${OTHER}) LIMIT 12`
).map((row) => row.id);

const rsvp = async (eventId, userIds, status) => {
  for (const userId of userIds) {
    await sql`
      INSERT INTO event_rsvp (event_id, user_id, status, "createdAt", "updatedAt")
      VALUES (${eventId}, ${userId}, ${status}, now(), now())
      ON CONFLICT (event_id, user_id) DO NOTHING`;
  }
};

// 37 of 45 would need 37 accounts; with 12 users the chip reads "N places left"
// honestly rather than theatrically.
await rsvp(systems.id, guests.slice(0, 9), "going");
await rsvp(systems.id, guests.slice(9, 11), "maybe");
await rsvp(weekend.id, guests.slice(0, 4), "going");
await rsvp(openMic.id, guests.slice(2, 5), "going");

/* A thread with a reply, so the discussion has both levels to show. */
const [parent] = await sql`
  INSERT INTO event_comment (text, event_id, "createdById", "createdAt")
  VALUES ('Is the third slot still open? I could do ten minutes on theming across six brand colours.', ${systems.id}, ${OTHER}, now() - interval '2 hours')
  RETURNING id`;

await sql`
  INSERT INTO event_comment (text, event_id, parent_id, "createdById", "createdAt")
  VALUES ('It is yours. Send me a title before Wednesday.', ${systems.id}, ${parent.id}, ${HOST}, now() - interval '1 hour')`;

await sql`
  INSERT INTO event_comment (text, event_id, "createdById", "createdAt")
  VALUES ('Is there parking nearby, or is it better to come by metro?', ${systems.id}, ${guests[0]}, now() - interval '20 minutes')`;

for (const userId of guests.slice(0, 6)) {
  await sql`
    INSERT INTO event_like (event_id, "createdById", "createdAt")
    VALUES (${systems.id}, ${userId}, now())
    ON CONFLICT DO NOTHING`;
}

console.log("Events:");
for (const row of created) {
  console.log(`  ${row.id}  ${row.title}${row.existed ? "  (already there)" : ""}`);
}
console.log(`\nTo undo:  DELETE FROM event WHERE id IN (${created.map((r) => r.id).join(", ")});`);

await sql.end();
