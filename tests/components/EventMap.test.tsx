import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { EventMap } from "~/components/events/EventMap";
import { OSM_EMBED_URL, REGION_CENTERS, googleMapsSearchUrl } from "~/lib/eventLocation";

/**
 * The event map sends nothing to a third party until it is asked for.
 *
 * An event page is public, so what matters is what a stranger's browser does on
 * arrival: with the map collapsed there must be no iframe at all, and the frame
 * that appears after the click must point at the one page the CSP allows.
 */

const LABEL = "Betahaus Sofia, ul. Krum Popov 56-58, Sofia, Bulgaria";

function openMap(container: HTMLElement): URL {
  expect(container.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /show map/i }));
  const frame = container.querySelector("iframe");
  expect(frame).not.toBeNull();
  return new URL(frame!.getAttribute("src")!);
}

describe("EventMap", () => {
  it("pins a geocoded venue, and only after the visitor asks", () => {
    const { container } = render(
      <EventMap point={{ lat: 42.6853, lng: 23.3191 }} region="sofia" label={LABEL} />,
    );

    const src = openMap(container);
    expect(`${src.origin}${src.pathname}`).toBe(OSM_EMBED_URL);
    expect(src.searchParams.get("marker")).toBe("42.68530,23.31910");
    expect(screen.getByTitle(`Map of ${LABEL}`)).toBeInTheDocument();
  });

  it("falls back to the whole town, unpinned, when the venue did not geocode", () => {
    const { container } = render(<EventMap point={null} region="varna" label="Varna" />);

    const src = openMap(container);
    expect(src.searchParams.get("marker")).toBeNull();
    const [minLng, minLat, maxLng, maxLat] = src.searchParams.get("bbox")!.split(",").map(Number);
    const { lat, lng } = REGION_CENTERS.varna!;
    expect(lat).toBeGreaterThan(minLat!);
    expect(lat).toBeLessThan(maxLat!);
    expect(lng).toBeGreaterThan(minLng!);
    expect(lng).toBeLessThan(maxLng!);
  });

  it("renders nothing for a region it has no centre for", () => {
    const { container } = render(<EventMap point={null} region="atlantis" label="?" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links to a Google Maps search that needs no key", () => {
    const url = new URL(googleMapsSearchUrl(LABEL));
    expect(`${url.origin}${url.pathname}`).toBe("https://www.google.com/maps/search/");
    expect(url.searchParams.get("query")).toBe(LABEL);
  });
});
