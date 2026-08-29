"use client";

import { type ReactNode, useMemo, useState } from "react";
import { GoogleMap, LoadScript, MarkerF } from "@react-google-maps/api";
import { MapPin, Search } from "~/components/ui/icons";
import { useTranslations } from "next-intl";

export type RegionOption = {
  value: string;
  label: string;
  lat: number;
  lng: number;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  regions: RegionOption[];
  allowAll?: boolean;
  allLabel?: string;
  className?: string;
  fallback?: ReactNode;
  searchPlaceholder?: string;
};

const DEFAULT_CENTER_BG = { lat: 42.7339, lng: 25.4858 }; // Bulgaria
const DEFAULT_ZOOM = 6;

export function RegionMapPicker({
  value,
  onChange,
  regions,
  allowAll = false,
  allLabel,
  className,
  fallback,
  searchPlaceholder,
}: Props) {
  const t = useTranslations("publish");
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const [query, setQuery] = useState("");
  const [mapsLoadFailed, setMapsLoadFailed] = useState(false);

  const selected = useMemo(
    () => regions.find((r) => r.value === value) ?? null,
    [regions, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return regions;
    return regions.filter((r) => r.label.toLowerCase().includes(q));
  }, [query, regions]);

  // If no API key is configured or Maps fails to load, render fallback UI.
  if (!apiKey || mapsLoadFailed) return fallback ?? null;

  return (
    <div className={className ?? ""}>
      <div className="bg-bg-secondary border border-white/[0.06] rounded-xl p-3 sm:p-4">
        <div className="flex items-center gap-2 sm:gap-3 mb-3">
          <MapPin className="text-accent-primary" size={18} />
          <div className="flex-1 flex items-center gap-2 bg-bg-secondary shadow-sm rounded-lg px-3 py-2">
            <Search size={16} className="text-fg-tertiary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder ?? t("searchCity")}
              className="w-full bg-transparent outline-none text-sm sm:text-base text-fg-primary placeholder:text-fg-tertiary"
            />
          </div>
          {allowAll && (
            <button
              type="button"
              onClick={() => onChange("")}
              className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors shadow-sm ${
                value === ""
                  ? "bg-accent-primary/20 text-accent-primary"
                  : "bg-bg-secondary text-fg-secondary hover:bg-bg-tertiary"
              }`}
            >
              {allLabel ?? t("allRegions")}
            </button>
          )}
        </div>

        <div className="rounded-xl overflow-hidden border border-white/[0.06]">
          <LoadScript googleMapsApiKey={apiKey} onError={() => setMapsLoadFailed(true)}>
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: "220px" }}
              center={selected ? { lat: selected.lat, lng: selected.lng } : DEFAULT_CENTER_BG}
              zoom={selected ? 9 : DEFAULT_ZOOM}
              options={{
                disableDefaultUI: true,
                clickableIcons: false,
                gestureHandling: "greedy",
              }}
            >
              {regions.map((r) => (
                <MarkerF
                  key={r.value}
                  position={{ lat: r.lat, lng: r.lng }}
                  onClick={() => onChange(r.value)}
                />
              ))}
            </GoogleMap>
          </LoadScript>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {filtered.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => onChange(r.value)}
              className={`px-3 py-1.5 rounded-full text-xs sm:text-sm transition-colors shadow-sm ${
                value === r.value
                  ? "bg-accent-primary/20 text-accent-primary"
                  : "bg-bg-secondary text-fg-secondary hover:bg-bg-tertiary"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
