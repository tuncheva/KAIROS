/**
 * Where an event is, as something a map can draw.
 *
 * Shared by the server (which geocodes a venue once, on write) and the event
 * page (which draws it). Every region is one of ten Bulgarian towns, so a town
 * centre is always available without a network call; a geocoded venue only
 * sharpens it.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Town centres, for events that name no venue or whose venue did not geocode. */
export const REGION_CENTERS: Record<string, GeoPoint> = {
  sofia: { lat: 42.6977, lng: 23.3219 },
  plovdiv: { lat: 42.1354, lng: 24.7453 },
  varna: { lat: 43.2141, lng: 27.9147 },
  burgas: { lat: 42.5048, lng: 27.4626 },
  ruse: { lat: 43.8356, lng: 25.9657 },
  stara_zagora: { lat: 42.4258, lng: 25.6345 },
  pleven: { lat: 43.417, lng: 24.6067 },
  sliven: { lat: 42.6817, lng: 26.3229 },
  dobrich: { lat: 43.5726, lng: 27.8273 },
  shumen: { lat: 43.2712, lng: 26.9361 },
};

/** The only frame the CSP lets in for maps — keep the two in step. */
export const OSM_EMBED_URL = "https://www.openstreetmap.org/export/embed.html";

/**
 * Great-circle distance in kilometres. Used to reject a geocoder answer that
 * landed in the wrong town, which is the usual way a short venue name goes wrong.
 */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * An OpenStreetMap embed centred on `point`. `precise` is a street-level view
 * with a pin; otherwise the whole town, unpinned, because a pin on a town
 * centre would claim a place the host never gave.
 */
export function osmEmbedUrl(point: GeoPoint, precise: boolean): string {
  const dLat = precise ? 0.004 : 0.06;
  const dLng = precise ? 0.007 : 0.1;
  const bbox = [point.lng - dLng, point.lat - dLat, point.lng + dLng, point.lat + dLat]
    .map((n) => n.toFixed(5))
    .join(",");
  const params = new URLSearchParams({ bbox, layer: "mapnik" });
  if (precise) params.set("marker", `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`);
  return `${OSM_EMBED_URL}?${params.toString()}`;
}

/** A Google Maps search anyone can open — no key, no account. */
export function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
