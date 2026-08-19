"use client";

import { useEffect, useState, useTransition, useRef } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { LOCALE_METADATA, locales, type Locale } from "~/i18n/locales";

type Translator = (key: string, values?: Record<string, unknown>) => string;

type LanguageCode = Locale;
type DateFormatOption = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";

interface Language {
 code: LanguageCode;
 name: string;
 flag: string;
}

// Single source of truth in `~/i18n/locales`. Both this and `LanguageSwitcher` kept
// their own copy of the list, which is how three half-translated locales stayed on
// offer after the coverage gap was known.
const languages: Language[] = locales.map((code) => ({
 code,
 ...LOCALE_METADATA[code],
}));

const timezones = [
 { value: "UTC", label: "UTC" },
 { value: "Europe/Sofia", label: "Europe/Sofia (Bulgaria)" },
 { value: "Europe/Madrid", label: "Europe/Madrid (Spain)" },
 { value: "America/New_York", label: "America/New York" },
 { value: "Europe/London", label: "Europe/London" },
 { value: "Asia/Tokyo", label: "Asia/Tokyo" },
] as const;

const dateFormats: { value: DateFormatOption; label: string }[] = [
 { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
 { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
 { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
];

function isDateFormatOption(value: unknown): value is DateFormatOption {
 return value === "MM/DD/YYYY" || value === "DD/MM/YYYY" || value === "YYYY-MM-DD";
}

export function LanguageSettingsClient() {
 const useT = useTranslations as unknown as (namespace: string) => Translator;
 const t = useT("settings.language");
 const useL = useLocale as unknown as () => LanguageCode;
 const locale = useL();
 const [isPending, startTransition] = useTransition();
 const [isOpen, setIsOpen] = useState(false);
 const dropdownRef = useRef<HTMLDivElement>(null);
 const buttonRef = useRef<HTMLButtonElement>(null);

 const { status } = useSession();
 const enabled = status === "authenticated";

 const { data, isLoading } = api.settings.get.useQuery(undefined, {
 enabled,
 retry: false,
 refetchOnWindowFocus: false,
 refetchOnReconnect: false,
 });
 const utils = api.useUtils();

 const updateLanguageRegion = api.settings.updateLanguageRegion.useMutation({
 onSuccess: async () => {
 await utils.settings.get.invalidate();
 },
 });

 const initialTimezone = data?.timezone ?? "UTC";
 const initialDateFormat: DateFormatOption = isDateFormatOption(data?.dateFormat)
 ? data.dateFormat
 : "MM/DD/YYYY";

 const [timezone, setTimezone] = useState(initialTimezone);
 const [dateFormat, setDateFormat] = useState<DateFormatOption>(initialDateFormat);
 const [dirty, setDirty] = useState(false);

 useEffect(() => {
 setTimezone(initialTimezone);
 setDateFormat(initialDateFormat);
 setDirty(false);
 }, [initialTimezone, initialDateFormat]);

 const currentLanguage = (languages.find((lang) => lang.code === locale) ?? languages[0])!;

 useEffect(() => {
 function handleClickOutside(event: MouseEvent) {
 if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
 setIsOpen(false);
 }
 }
 document.addEventListener("mousedown", handleClickOutside);
 return () => document.removeEventListener("mousedown", handleClickOutside);
 }, []);

 const isBusy = isLoading || isPending || updateLanguageRegion.isPending;

 const handleLanguageChange = (newLocale: LanguageCode) => {
 setIsOpen(false);
 startTransition(async () => {
 try {
 await updateLanguageRegion.mutateAsync({ language: newLocale });
 } finally {
 document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000; SameSite=Lax`;
 window.location.reload();
 }
 });
 };

 const saveRegion = async () => {
 await updateLanguageRegion.mutateAsync({
 timezone,
 dateFormat,
 });
 setDirty(false);
 };

 return (
 <div className="w-full h-full overflow-y-auto bg-bg-primary">
 <div className="w-full px-4 sm:px-6">
 {/* Header */}
 <div className="pt-8 pb-6">
 <h1 className="text-[34px] font-[700] leading-[1.1] tracking-[-0.022em] text-fg-primary mb-2">
 {t("title")}
 </h1>
 <p className="text-[15px] leading-[1.4667] tracking-[-0.01em] text-fg-tertiary">
 {t("subtitle")}
 </p>
 </div>

 <div className="space-y-8">
 {/* Language Selector Card */}
 <div className="mb-8">
 <div className="bg-bg-secondary rounded-[10px] border border-white/[0.06]">
 <div className="pl-[16px] pr-[18px] py-[11px]">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-[13px]">
 <div className="w-[30px] h-[30px] rounded-full bg-bg-tertiary flex items-center justify-center">
 <Globe size={18} className="text-fg-secondary" strokeWidth={2.2} />
 </div>
 <div className="flex-1">
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-secondary mb-[1px]">
 {t("displayLanguage")}
 </div>
 <div ref={dropdownRef} className="relative">
 <button
 ref={buttonRef}
 type="button"
 onClick={() => setIsOpen((v) => !v)}
 disabled={isBusy}
 aria-expanded={isOpen}
 aria-haspopup="listbox"
 className="flex items-center gap-2 w-full text-left"
 >
 <span className="text-[17px]">{currentLanguage.flag}</span>
 <span className="text-[15px] leading-[1.4667] tracking-[-0.012em] text-fg-primary font-[590]">
 {currentLanguage.name}
 </span>
 <ChevronDown
 className={`ml-auto text-fg-secondary transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
 size={18}
 />
 </button>

 {isOpen && (
 <div
 role="listbox"
 className="absolute z-50 mt-2 min-w-[200px] w-max rounded-[10px] overflow-hidden shadow-xl"
 style={{
 backgroundColor: 'rgb(var(--bg-secondary))',
 border: '1px solid rgb(var(--border-medium))',
 }}
 >
 {languages.map((language, index) => (
 <div key={language.code} className="relative">
 <button
 type="button"
 role="option"
 aria-selected={locale === language.code}
 onClick={() => handleLanguageChange(language.code)}
 disabled={isBusy}
 className={`w-full flex items-center justify-between pl-[16px] pr-[18px] py-[11px] transition-colors duration-200 ${
 isBusy ? "opacity-50 cursor-not-allowed" : "active:bg-bg-tertiary"
 } ${
 locale === language.code
 ? "bg-accent-primary/10"
 : "hover:bg-bg-tertiary"
 }`}
 >
 <div className="flex items-center gap-[13px]">
 <span className="text-[17px]">{language.flag}</span>
 <span className={`text-[17px] leading-[1.235] tracking-[-0.016em] ${
 locale === language.code
 ? "text-accent-primary font-[590]"
 : "text-fg-primary font-[400]"
 } `}>
 {language.name}
 </span>
 </div>
 {locale === language.code && (
 <div className="text-accent-primary">
 <Check size={20} strokeWidth={3} />
 </div>
 )}
 </button>
 {index < languages.length - 1 && (
 <div className="absolute bottom-0 left-[59px] right-0 h-[0.33px] border-t border-white/[0.04]" />
 )}
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>

 {/* Timezone Selector Card */}
 <div className="mb-8">
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 <div className="pl-[16px] pr-[18px] py-[11px]">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-[13px]">
 <div className="w-[30px] h-[30px] rounded-full bg-bg-tertiary flex items-center justify-center">
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 20 12 20ZM12.5 7V12.25L17 14.92L16.25 16.15L11 13V7H12.5Z" 
 fill="currentColor" className="text-fg-secondary"/>
 </svg>
 </div>
 <div className="flex-1">
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-secondary mb-[1px]">
 {t("timezone")}
 </div>
 <select
 className="w-full bg-transparent text-[15px] leading-[1.4667] tracking-[-0.012em] text-fg-primary font-[590] focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed appearance-none"
 value={timezone}
 onChange={(e) => {
 setTimezone(e.target.value);
 setDirty(true);
 }}
 disabled={isBusy}
 >
 {timezones.map((tz) => (
 <option key={tz.value} value={tz.value} className="bg-bg-secondary text-fg-primary">
 {tz.label}
 </option>
 ))}
 </select>
 <div className="absolute right-[18px] top-1/2 transform -translate-y-1/2 pointer-events-none">
 <ChevronDown className="text-fg-secondary" size={18} />
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>

 {/* Date Format Selector Card */}
 <div className="mb-8">
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 <div className="pl-[16px] pr-[18px] py-[11px]">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-[13px]">
 <div className="w-[30px] h-[30px] rounded-full bg-bg-tertiary flex items-center justify-center">
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M19 4H18V3C18 2.45 17.55 2 17 2C16.45 2 16 2.45 16 3V4H8V3C8 2.45 7.55 2 7 2C6.45 2 6 2.45 6 3V4H5C3.89 4 3.01 4.9 3.01 6L3 20C3 21.1 3.89 22 5 22H19C20.1 22 21 21.1 21 20V6C21 4.9 20.1 4 19 4ZM19 19C19 19.55 18.55 20 18 20H6C5.45 20 5 19.55 5 19V9H19V19Z" 
 fill="currentColor" className="text-fg-secondary"/>
 </svg>
 </div>
 <div className="flex-1">
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-secondary mb-[1px]">
 {t("dateFormat")}
 </div>
 <select
 className="w-full bg-transparent text-[15px] leading-[1.4667] tracking-[-0.012em] text-fg-primary font-[590] focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed appearance-none"
 value={dateFormat}
 onChange={(e) => {
 setDateFormat(e.target.value as DateFormatOption);
 setDirty(true);
 }}
 disabled={isBusy}
 >
 {dateFormats.map((df) => (
 <option key={df.value} value={df.value} className="bg-bg-secondary text-fg-primary">
 {df.label}
 </option>
 ))}
 </select>
 <div className="absolute right-[18px] top-1/2 transform -translate-y-1/2 pointer-events-none">
 <ChevronDown className="text-fg-secondary" size={18} />
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>

 {/* Save Button Card */}
 <div className="mb-6">
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 <div className="px-4 py-4">
 <button
 type="button"
 onClick={() => void saveRegion()}
 disabled={isBusy || !dirty}
 className={`w-full py-3.5 rounded-[10px] text-center text-[17px] leading-[1.235] tracking-[-0.016em] font-[590] transition-all duration-200 ${
 isBusy || !dirty
 ? "bg-bg-tertiary text-fg-secondary cursor-not-allowed"
 : "text-accent-primary text-white active:opacity-80"
 }`}
 style={!isBusy && dirty ? { backgroundColor: `rgb(var(--accent-primary))` } : undefined}
 >
 {t("save")}
 </button>
 </div>
 </div>
 </div>

 {/* Loading Indicator */}
 {isPending && (
 <div className="mb-6">
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 <div className="px-4 py-3.5">
 <div className="flex items-center justify-center gap-3">
 <div className="w-4 h-4 border-2 border-transparent border-t-text-accent-primary rounded-full animate-spin" />
 <span className="text-[15px] leading-[1.4667] tracking-[-0.012em] text-fg-primary">
 {t("applying")}
 </span>
 </div>
 </div>
 </div>
 </div>
 )}

 {/* Error Message */}
 {updateLanguageRegion.error && (
 <div className="mb-6">
 <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-[10px] overflow-hidden">
 <div className="px-4 py-3.5">
 <p className="text-[15px] leading-[1.4667] tracking-[-0.012em] text-red-600 dark:text-red-400 text-center">
 {updateLanguageRegion.error.message}
 </p>
 </div>
 </div>
 </div>
 )}

 {/* Bottom Spacing */}
 <div className="h-8"></div>
 </div>
 </div>
 </div>
 );
}