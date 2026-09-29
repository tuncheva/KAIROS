"use client";

/**
 * Where the event is, on a map.
 *
 * An OpenStreetMap embed: free, and needs no key and no account — the Google
 * Maps Embed API would have needed a billing account. The venue is geocoded
 * once when the event is written (`~/server/geo/geocode`); with no pin, the map
 * shows the whole town, which every event has.
 *
 * The frame is loaded on request, not on render. An event page is public, and
 * mounting the map would hand every visitor's IP to a third party just for
 * opening a link. Until the button is pressed, nothing is sent.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

import { MapPin } from "~/components/ui/icons";
import { REGION_CENTERS, osmEmbedUrl, type GeoPoint } from "~/lib/eventLocation";

interface EventMapProps {
  /** The geocoded venue, when there is one. */
  point: GeoPoint | null;
  region: string;
  /** What the frame is a map of, for screen readers. */
  label: string;
}

export function EventMap({ point, region, label }: EventMapProps) {
  const t = useTranslations("publish");
  const [shown, setShown] = useState(false);

  const center = point ?? REGION_CENTERS[region];
  if (!center) return null;

  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setShown(true)}
        className="mt-1 flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border-medium bg-bg-secondary text-fg-secondary transition-colors hover:border-accent-primary hover:text-fg-primary"
      >
        <MapPin className="h-5 w-5" aria-hidden />
        <span className="text-xs font-semibold">{t("showMap")}</span>
        <span className="px-4 text-center text-[11px] text-fg-tertiary">
          {t("showMapNotice")}
        </span>
      </button>
    );
  }

  return (
    <iframe
      title={t("mapTitle", { place: label })}
      src={osmEmbedUrl(center, point !== null)}
      className="mt-1 aspect-[4/3] w-full rounded-md border border-border-medium"
      loading="lazy"
    />
  );
}
