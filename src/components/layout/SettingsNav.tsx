"use client";

import Link from "next/link";
import {
  Bell,
  Building2,
  Globe,
  Palette,
  Shield,
  Sparkles,
  Terminal,
  User,
} from "lucide-react";
import { useTranslations } from "next-intl";

type Translator = (key: string, values?: Record<string, unknown>) => string;

interface SettingsNavProps {
  activeSection: string;
  variant?: "card" | "embedded";
}

export function SettingsNav({ activeSection }: SettingsNavProps) {
  const useT = useTranslations as unknown as (namespace: string) => Translator;
  const t = useT("settings.nav");
  
  const sections = [
    { id: "profile", label: t("profile"), icon: User },
    { id: "workspace", label: t("workspace"), icon: Building2 },
    { id: "notifications", label: t("notifications"), icon: Bell },
    { id: "security", label: t("security"), icon: Shield },
    { id: "language", label: t("language"), icon: Globe },
    { id: "appearance", label: t("appearance"), icon: Palette },
    { id: "ai", label: t("ai"), icon: Sparkles },
    // Shown on every plan. The panels behind it refuse without `apiAccess`, so
    // the page explains the gate rather than erroring into it — a hidden tab
    // makes the capability undiscoverable.
    { id: "developer", label: t("developer"), icon: Terminal },
  ];

  return (
    <nav className="h-full bg-transparent" aria-label="Settings">
      <div className="flex flex-col h-full py-1">
        {sections.map((section, index) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;
          
          return (
            <div key={section.id}>
              <Link
                href={`/settings?section=${section.id}`}
                aria-current={isActive ? "page" : undefined}
                className={`group flex items-center gap-3 mx-3 px-3 py-3 rounded-xl transition-all duration-200 relative ${
                  isActive
                    ? "bg-bg-tertiary text-fg-primary"
                    : "text-fg-secondary hover:bg-bg-tertiary/50 hover:text-fg-primary"
                }`}
                data-active={isActive}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                  isActive 
                    ? "bg-accent-primary/15 text-accent-primary" 
                    : "bg-bg-secondary text-fg-tertiary group-hover:text-fg-secondary"
                }`}>
                  <Icon size={16} />
                </div>
                <span className="font-medium text-sm tracking-[-0.01em]">{section.label}</span>
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent-primary" />
                )}
              </Link>
              {index < sections.length - 1 && (
                <div className="mx-6 border-b border-slate-100 dark:border-white/[0.04]" />
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
