import { SettingsSkeleton } from "~/components/settings/SettingsSkeleton";

/**
 * Stands in for the settings space, in its shape: it covers the app the same
 * way the real one does, so the rail does not flash through between the click
 * and the first paint. The index, title and labels are real; only the
 * account's own data hatches.
 */
export default function SettingsLoading() {
  return <SettingsSkeleton />;
}
