/**
 * The settings sections, in rail order.
 *
 * A plain module, deliberately: the server page reads `?section=` and has to
 * validate it before handing it to the client workspace, and a `"use client"`
 * module can only be rendered from the server, never called into.
 */
export const SETTINGS_SECTIONS = [
  "profile",
  "workspace",
  "notifications",
  "privacy",
  "security",
  "language",
  "appearance",
  "ai",
  "developer",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

export function isSettingsSection(value: string): value is SettingsSectionId {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}
