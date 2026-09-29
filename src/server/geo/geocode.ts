/**
 * Venue → coordinates, via OpenStreetMap's Nominatim.
 *
 * Free, keyless and accountless, which is the whole reason it is here: the
 * Google alternative needs a billing account. The price is Nominatim's usage
 * policy — at most one request a second, an identifying User-Agent, and results
 * cached rather than re-asked — so this runs once when an event is written and
 * the answer is stored on the row. Nothing on the read path calls it.
 *
 * Never throws. A slow, down or empty geocoder leaves the event without a pin,
 * and the page falls back to the town centre, which is always known.
 *
 * Only the venue and address the host published are sent; both are shown to
 * anyone who opens the event anyway.
 */
import "server-only";

import { env } from "~/env";
import { createLogger } from "~/server/logger";
import { REGION_CENTERS, distanceKm, type GeoPoint } from "~/lib/eventLocation";
import { regionLabel } from "~/components/publish/feedData";

const log = createLogger("geocode");

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/** Further than this from the town centre, and the match was some other town. */
const MAX_KM_FROM_REGION = 40;

/** Nominatim's ceiling is one a second; a little over keeps us clear of it. */
const MIN_INTERVAL_MS = 1100;

let nextSlot = 0;

async function waitForSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_INTERVAL_MS;
  if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
}

export interface PlaceInput {
  venue: string | null | undefined;
  address: string | null | undefined;
  region: string;
}

interface GeocodeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Tests turn the rate limiter off; nothing else should. */
  throttle?: boolean;
}

/**
 * Street-type words Nominatim does not match on: "ul. Krum Popov 56" finds
 * nothing while "Krum Popov 56" finds the building. Stripped at the start of
 * each comma-separated part, in both scripts.
 */
const STREET_PREFIX = /(^|,\s*)(?:ul|ulitsa|bul|blvd|ул|улица|бул|булевард)\.?\s+/giu;

export function normalizeAddress(address: string): string {
  return address.replace(STREET_PREFIX, "$1").trim();
}

/**
 * The searches to try, most specific first. Checked against Nominatim with this
 * repo's seed events: the address alone is what usually hits, and venue plus
 * town catches the rest — venue *and* address in one query almost never
 * matches, so it is not asked.
 */
export function placeQueries({ venue, address, region }: PlaceInput): string[] {
  const town = regionLabel(region);
  // Blank counts as absent: the form sends "" for a field the host cleared.
  const clean = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);
  const v = clean(venue);
  const a = clean(address);

  const queries: string[] = [];
  if (a) queries.push(`${normalizeAddress(a)}, ${town}`);
  if (v) queries.push(`${v}, ${town}`);
  return queries;
}

export async function geocodePlace(
  place: PlaceInput,
  { fetchImpl = fetch, timeoutMs = 4000, throttle = true }: GeocodeOptions = {},
): Promise<GeoPoint | null> {
  const center = REGION_CENTERS[place.region];

  for (const q of placeQueries(place)) {
    const params = new URLSearchParams({
      q,
      format: "jsonv2",
      limit: "1",
      countrycodes: "bg",
    });

    try {
      if (throttle) await waitForSlot();
      const res = await fetchImpl(`${NOMINATIM_URL}?${params.toString()}`, {
        headers: {
          "User-Agent": `KAIROS/1.0 (${env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"})`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        log.warn("nominatim refused", { status: res.status });
        return null;
      }

      const [hit] = (await res.json()) as { lat?: string; lon?: string }[];
      const point = hit && { lat: Number(hit.lat), lng: Number(hit.lon) };
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
      if (center && distanceKm(point, center) > MAX_KM_FROM_REGION) continue;

      return point;
    } catch (error) {
      log.warn("nominatim unreachable", { error: String(error) });
      return null;
    }
  }

  return null;
}
