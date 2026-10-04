/**
 * The settings sections, in document order.
 *
 * A plain module, deliberately: the server page reads `?section=` and has to
 * validate it before handing it to the client workspace, and a `"use client"`
 * module can only be rendered from the server, never called into.
 *
 * /settings is one scrolling document, so the order is also the reading order,
 * and each group below has to be contiguous in it — the index in the sidebar
 * prints one heading per group and the section eyebrows count straight through.
 */
export const SETTINGS_SECTIONS = [
  "profile",
  "appearance",
  "language",
  "notifications",
  "privacy",
  "security",
  "ai",
  "workspace",
  // Near the end on purpose. It is the only section that is not a setting —
  // nothing on it changes how the app behaves for you — so putting it above
  // the rest would push things people actually adjust below the thing they
  // adjust once.
  "billing",
  "developer",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

export function isSettingsSection(value: string): value is SettingsSectionId {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export const SETTINGS_GROUPS = ["account", "assistant", "workspace"] as const;

export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number];

/** Which sidebar group, and which eyebrow, each section sits under. */
export const SECTION_GROUP: Record<SettingsSectionId, SettingsGroupId> = {
  profile: "account",
  appearance: "account",
  language: "account",
  notifications: "account",
  privacy: "account",
  security: "account",
  ai: "assistant",
  workspace: "workspace",
  billing: "workspace",
  developer: "workspace",
};

/** "01", "02", … — the section's place in the document. */
export function sectionNumber(id: SettingsSectionId): string {
  return String(SETTINGS_SECTIONS.indexOf(id) + 1).padStart(2, "0");
}
