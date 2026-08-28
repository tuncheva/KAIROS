"use client";

import { useState, useRef, useEffect } from "react";
import { Globe, ChevronDown, Check } from "~/components/ui/icons";
import { useLocale } from "next-intl";
import { LOCALE_METADATA, locales, type Locale } from "~/i18n/locales";

type LanguageCode = Locale;

interface Language {
  code: LanguageCode;
  name: string;
  flag: string;
}

// Derived from `~/i18n/locales` rather than hardcoded. This list used to name all
// five locales, three of which were about half translated — so choosing one gave a
// screen partly in that language and partly in English.
const languages: Language[] = locales.map((code) => ({
  code,
  ...LOCALE_METADATA[code],
}));

interface LanguageSwitcherProps {
  variant?: "compact" | "full";
  className?: string;
}

export function LanguageSwitcher({ variant = "compact", className = "" }: LanguageSwitcherProps) {
  const currentLocale = useLocale() as LanguageCode;
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentLang = languages.find((l) => l.code === currentLocale) ?? languages[0]!;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const switchLocale = (code: LanguageCode) => {
    document.cookie = `NEXT_LOCALE=${code};path=/;max-age=${365 * 24 * 60 * 60}`;
    setIsOpen(false);
    window.location.reload();
  };

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium text-fg-secondary hover:text-fg-primary hover:bg-slate-100 dark:hover:bg-white/10 backdrop-blur-sm transition-all duration-200 border border-slate-200 dark:border-white/10"
        aria-label="Switch language"
      >
        <Globe size={15} className="opacity-70" />
        {variant === "full" ? (
          <>
            <span>{currentLang.flag}</span>
            <span className="hidden sm:inline">{currentLang.name}</span>
            <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
          </>
        ) : (
          <>
            <span className="text-xs">{currentLang.flag}</span>
            <ChevronDown size={12} className={`transition-transform duration-200 opacity-60 ${isOpen ? "rotate-180" : ""}`} />
          </>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-44 rounded-xl overflow-hidden border border-slate-200 dark:border-white/15 bg-bg-primary shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          {languages.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => switchLocale(lang.code)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors duration-150 ${
                lang.code === currentLocale
                  ? "bg-accent-primary/10 text-accent-primary font-medium"
                  : "text-fg-secondary hover:bg-slate-50 dark:hover:bg-white/5 hover:text-fg-primary"
              }`}
            >
              <span className="text-base">{lang.flag}</span>
              <span className="flex-1 text-left">{lang.name}</span>
              {lang.code === currentLocale && <Check size={14} className="text-accent-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
