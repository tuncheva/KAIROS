"use client";

/**
 * One icon per settings section, shared by the sidebar index and the section
 * headings so the two read as the same thing. Client-only because the icon set
 * is (see `~/components/ui/icons`), which is why it is not in `sections.ts`.
 */

import type { ComponentType } from "react";
import {
  Bell,
  Building2,
  Code,
  CreditCard,
  Eye,
  Languages,
  Palette,
  Shield,
  Sparkles,
  User,
} from "~/components/ui/icons";
import type { SettingsSectionId } from "./sections";

type IconType = ComponentType<{ size?: number; className?: string }>;

export const SECTION_ICON: Record<SettingsSectionId, IconType> = {
  profile: User,
  appearance: Palette,
  language: Languages,
  notifications: Bell,
  privacy: Eye,
  security: Shield,
  ai: Sparkles,
  workspace: Building2,
  billing: CreditCard,
  developer: Code,
};
