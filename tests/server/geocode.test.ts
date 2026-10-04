import { describe, it, expect, vi } from "vitest";

import { geocodePlace, normalizeAddress, placeQueries } from "~/server/geo/geocode";

/**
 * The geocoder is allowed to fail, but never to throw, and never to pin an
 * event in the wrong town. Nominatim is stubbed: what is under test is what
 * we ask it and what we do with the answer.
 */

function nominatim(...answers: unknown[]) {
  const fetchImpl = vi.fn();
  for (const answer of answers) {
    fetchImpl.mockResolvedValueOnce(
      answer instanceof Response ? answer : Response.json(answer),
    );
  }
  return fetchImpl;
}

const opts = (fetchImpl: ReturnType<typeof vi.fn>) => ({
  fetchImpl: fetchImpl as unknown as typeof fetch,
  throttle: false,
});

describe("placeQueries", () => {
  it("asks nothing when the host gave only a town", () => {
    expect(placeQueries({ venue: null, address: "  ", region: "sofia" })).toEqual([]);
  });

  it("asks by address first, then by venue", () => {
    expect(
      placeQueries({ venue: "Betahaus", address: "ul. Krum Popov 56", region: "sofia" }),
    ).toEqual(["Krum Popov 56, Sofia", "Betahaus, Sofia"]);
  });
});

describe("normalizeAddress", () => {
  it("drops the street-type words Nominatim does not match on, in both scripts", () => {
    expect(normalizeAddress("ul. Krum Popov 56-58")).toBe("Krum Popov 56-58");
    expect(normalizeAddress("бул. Витоша 1")).toBe("Витоша 1");
    expect(normalizeAddress("Lozenets, ul Krum Popov 56")).toBe("Lozenets, Krum Popov 56");
    // Only as a leading word: a street that merely contains the letters is left alone.
    expect(normalizeAddress("Ulpia 3")).toBe("Ulpia 3");
  });
});

describe("geocodePlace", () => {
  const place = { venue: "Betahaus", address: "ul. Krum Popov 56", region: "sofia" };

  it("returns the first hit, asked of Bulgaria with an identifying agent", async () => {
    const fetchImpl = nominatim([{ lat: "42.6853", lon: "23.3191" }]);

    await expect(geocodePlace(place, opts(fetchImpl))).resolves.toEqual({
      lat: 42.6853,
      lng: 23.3191,
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const params = new URL(url).searchParams;
    expect(params.get("countrycodes")).toBe("bg");
    expect(params.get("q")).toBe("Krum Popov 56, Sofia");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^KAIROS\//);
  });

  it("falls through to the venue when the address is not in OSM", async () => {
    const fetchImpl = nominatim([], [{ lat: "42.686", lon: "23.320" }]);
    await expect(geocodePlace(place, opts(fetchImpl))).resolves.toEqual({
      lat: 42.686,
      lng: 23.32,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a match in some other town", async () => {
    // Varna, for an event in Sofia.
    const fetchImpl = nominatim([{ lat: "43.2141", lon: "27.9147" }], []);
    await expect(geocodePlace(place, opts(fetchImpl))).resolves.toBeNull();
  });

  it("returns null rather than throwing when Nominatim is down", async () => {
    const down = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(geocodePlace(place, opts(down))).resolves.toBeNull();

    const refused = nominatim(new Response("", { status: 429 }));
    await expect(geocodePlace(place, opts(refused))).resolves.toBeNull();
  });
});
