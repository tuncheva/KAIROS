"use client";

import { useState, useEffect } from "react";
import { signOut, useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";

type Translator = (key: string, values?: Record<string, unknown>) => string;

export function SecuritySettingsClient() {
 const useT = useTranslations as unknown as (namespace: string) => Translator;
 const t = useT("settings.security");
 const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

 // Reset PIN form state
 const [pin, setPin] = useState("");
 const [confirmPin, setConfirmPin] = useState("");
 const [hint, setHint] = useState("");
 const [pinError, setPinError] = useState<string | null>(null);

 const { status } = useSession();
 const enabled = status === "authenticated";

 const utils = api.useUtils();

 const { data, isLoading } = api.settings.get.useQuery(undefined, {
 enabled,
 retry: false,
 refetchOnWindowFocus: false,
 refetchOnReconnect: false,
 });

 // Load existing reset pin hint when data is available
 useEffect(() => {
 if (data?.resetPinHint) {
 setHint(data.resetPinHint);
 }
 }, [data?.resetPinHint]);

 const updateSecurity = api.settings.updateSecurity.useMutation({
 onSuccess: async () => {
 await utils.settings.get.invalidate();
 },
 });

 const updateResetPin = api.settings.updateResetPin.useMutation({
 onSuccess: async () => {
 await utils.settings.get.invalidate();
 setPin("");
 setConfirmPin("");
 setPinError(null);
 },
 onError: (e) => {
  const message = e instanceof Error ? e.message : t("errors.updateResetPin");
 setPinError(message);
 },
 });

 const deleteAllData = api.settings.deleteAllData.useMutation();

 const twoFactorEnabled = data?.twoFactorEnabled ?? false;
 const notesKeepUnlockedUntilClose = data?.notesKeepUnlockedUntilClose ?? false;
 const hasResetPin = !!data?.resetPinHint || (data?.resetPinFailedAttempts ?? 0) >= 0;

 const isBusy =
 isLoading || updateSecurity.isPending || updateResetPin.isPending || deleteAllData.isPending;

 const onToggle2fa = async () => {
 try {
 await updateSecurity.mutateAsync({ twoFactorEnabled: !twoFactorEnabled });
 } catch {
 // Error displayed via updateSecurity.error in the UI
 }
 };

 const onToggleKeepUnlocked = async () => {
 try {
 await updateSecurity.mutateAsync({
 notesKeepUnlockedUntilClose: !notesKeepUnlockedUntilClose,
 });
 } catch {
 // Error displayed via updateSecurity.error in the UI
 }
 };

 const onSignOut = async () => {
 await utils.settings.get.cancel();
 await signOut({ callbackUrl: "/" });
 };

 const onDeleteAccount = async () => {
 try {
 await deleteAllData.mutateAsync();
 await utils.settings.get.cancel();
 await signOut({ callbackUrl: "/" });
 } catch {
 // Error displayed via deleteAllData.error in the UI
 }
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
 {/* Two-Factor Authentication Card */}
 <div className="mb-8">
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 <div className="flex items-center justify-between pl-[16px] pr-[18px] py-[11px]">
 <div className="flex items-center gap-[13px]">
 <div className="w-[30px] h-[30px] rounded-full bg-bg-tertiary flex items-center justify-center">
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M12 1L3 5V11C3 16.55 6.84 21.74 12 23C17.16 21.74 21 16.55 21 11V5L12 1ZM12 7C13.1 7 14 7.9 14 9C14 10.1 13.1 11 12 11C10.9 11 10 10.1 10 9C10 7.9 10.9 7 12 7ZM18 11C18 11.55 17.55 12 17 12C16.45 12 16 11.55 16 11C16 10.45 16.45 10 17 10C17.55 10 18 10.45 18 11Z" 
 fill="currentColor" className="text-fg-secondary"/>
 </svg>
 </div>
 <div className="flex-1">
 <div className="text-[17px] leading-[1.235] tracking-[-0.016em] text-fg-primary font-[590] mb-[1px]">
  {t("twoFactor")}
 </div>
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-tertiary">
  {t("twoFactorDesc")}
 </div>
 </div>
 </div>
 <button
 type="button"
 role="switch"
 aria-checked={twoFactorEnabled}
 disabled={isBusy}
 onClick={() => onToggle2fa()}
 className={`relative inline-flex h-[31px] w-[51px] flex-shrink-0 rounded-full border transition-colors duration-200 focus:outline-none ${
 isBusy ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
 } ${
 twoFactorEnabled
 ? "border-transparent"
 : "border-gray-300/30 dark:border-gray-600/50"
 } ${
 !twoFactorEnabled ? "bg-bg-tertiary" : ""
 }`}
 style={twoFactorEnabled ? { backgroundColor: `rgb(var(--accent-primary))` } : undefined}
 >
 <span
 className={`pointer-events-none inline-block h-[27px] w-[27px] transform rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-transform duration-200 ease-in-out ${
 twoFactorEnabled ? "translate-x-[20px]" : "translate-x-[1px]"
 }`}
 />
 </button>
 </div>
 {updateSecurity.error && (
 <div className="pl-[16px] pr-[18px] pb-[11px]">
 <p className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-red-600 dark:text-red-400">
 {updateSecurity.error.message}
 </p>
 </div>
 )}
 </div>
 </div>

 {/* Notes Security Card */}
 <div className="mb-8">
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 <div className="flex items-center justify-between pl-[16px] pr-[18px] py-[11px]">
 <div className="flex items-center gap-[13px]">
 <div className="w-[30px] h-[30px] rounded-full bg-bg-tertiary flex items-center justify-center">
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M18 8H17V6C17 3.24 14.76 1 12 1C9.24 1 7 3.24 7 6V8H6C4.9 8 4 8.9 4 10V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V10C20 8.9 19.1 8 18 8ZM12 17C10.9 17 10 16.1 10 15C10 13.9 10.9 13 12 13C13.1 13 14 13.9 14 15C14 16.1 13.1 17 12 17ZM9 8V6C9 4.34 10.34 3 12 3C13.66 3 15 4.34 15 6V8H9Z" 
 fill="currentColor" className="text-fg-secondary"/>
 </svg>
 </div>
 <div className="flex-1">
 <div className="text-[17px] leading-[1.235] tracking-[-0.016em] text-fg-primary font-[590] mb-[1px]">
  {t("notesKeepUnlocked")}
 </div>
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-tertiary">
  {t("notesKeepUnlockedDesc")}
 </div>
 </div>
 </div>
 <button
 type="button"
 role="switch"
 aria-checked={notesKeepUnlockedUntilClose}
 disabled={isBusy}
 onClick={() => onToggleKeepUnlocked()}
 className={`relative inline-flex h-[31px] w-[51px] flex-shrink-0 rounded-full border transition-colors duration-200 focus:outline-none ${
 isBusy ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
 } ${
 notesKeepUnlockedUntilClose
 ? "border-transparent"
 : "border-gray-300/30 dark:border-gray-600/50"
 } ${
 !notesKeepUnlockedUntilClose ? "bg-bg-tertiary" : ""
 }`}
 style={notesKeepUnlockedUntilClose ? { backgroundColor: `rgb(var(--accent-primary))` } : undefined}
 >
 <span
 className={`pointer-events-none inline-block h-[27px] w-[27px] transform rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-transform duration-200 ease-in-out ${
 notesKeepUnlockedUntilClose ? "translate-x-[20px]" : "translate-x-[1px]"
 }`}
 />
 </button>
 </div>
 </div>
 </div>

 {/* Reset PIN Card */}
 <div className="mb-8">
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 <div className="pl-[16px] pr-[18px] py-[11px]">
 <div className="flex items-center gap-[13px] mb-4">
 <div className="w-[30px] h-[30px] rounded-full bg-bg-tertiary flex items-center justify-center">
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M12 17C14.76 17 17 14.76 17 12C17 9.24 14.76 7 12 7C9.24 7 7 9.24 7 12C7 14.76 9.24 17 12 17ZM12 1C5.93 1 1 5.93 1 12C1 18.07 5.93 23 12 23C18.07 23 23 18.07 23 12C23 5.93 18.07 1 12 1ZM12 21C7.04 21 3 16.96 3 12C3 7.04 7.04 3 12 3C16.96 3 21 7.04 21 12C21 16.96 16.96 21 12 21Z" 
 fill="currentColor" className="text-fg-secondary"/>
 </svg>
 </div>
 <div className="flex-1">
 <div className="text-[17px] leading-[1.235] tracking-[-0.016em] text-fg-primary font-[590] mb-[1px]">
  {t("resetPin")}
 </div>
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-tertiary">
  {t("resetPinDesc")}
 </div>
 <div className="text-[12px] leading-[1.3846] tracking-[-0.006em] text-fg-tertiary mt-1">
  {t("status")}: <span className={hasResetPin ? "text-green-600 dark:text-green-400" : "text-fg-tertiary"}>
  {hasResetPin ? t("pinConfigured") : t("noPinConfigured")}
 </span>
 </div>
 </div>
 </div>

 <div className="space-y-3 pl-[43px]">
 <div>
 <label className="block text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-tertiary mb-2">
  {t("newPin")}
 </label>
 <input
 type="password"
 inputMode="numeric"
 pattern="[0-9]*"
 value={pin}
 onChange={(e) => {
 setPin(e.target.value);
 setPinError(null);
 }}
 className="w-full bg-bg-tertiary text-[15px] leading-[1.4667] tracking-[-0.012em] text-fg-primary rounded-[8px] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-primary/30 border border-white/[0.06]"
 />
 </div>

 <div>
 <label className="block text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-tertiary mb-2">
  {t("confirmPin")}
 </label>
 <input
 type="password"
 inputMode="numeric"
 pattern="[0-9]*"
 value={confirmPin}
 onChange={(e) => {
 setConfirmPin(e.target.value);
 setPinError(null);
 }}
 className="w-full bg-bg-tertiary text-[15px] leading-[1.4667] tracking-[-0.012em] text-fg-primary rounded-[8px] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-primary/30 border border-white/[0.06]"
 />
 </div>

 <div>
 <label className="block text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-tertiary mb-2">
  {t("hint")}
 </label>
 <input
 type="text"
 maxLength={200}
 value={hint}
 onChange={(e) => setHint(e.target.value)}
 className="w-full bg-bg-tertiary text-[15px] leading-[1.4667] tracking-[-0.012em] text-fg-primary rounded-[8px] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-primary/30 border border-white/[0.06]"
  placeholder={t("hintPlaceholder")}
 />
 </div>

 {pinError && (
 <p className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-red-600 dark:text-red-400">
 {pinError}
 </p>
 )}

 <button
 type="button"
 onClick={() => {
 if (!pin || !confirmPin) {
  setPinError(t("errors.pinRequired"));
 return;
 }
 void updateResetPin.mutate({ pin, confirmPin, hint });
 }}
 disabled={isBusy || updateResetPin.isPending}
 className={`w-full py-2.5 rounded-[10px] text-center text-[17px] leading-[1.235] tracking-[-0.016em] font-[590] transition-all duration-200 ${
 isBusy || updateResetPin.isPending
 ? "bg-bg-tertiary text-fg-secondary cursor-not-allowed"
 : "text-white active:opacity-80"
 }`}
 style={!(isBusy || updateResetPin.isPending) ? { backgroundColor: `rgb(var(--accent-primary))` } : undefined}
 >
  {updateResetPin.isPending ? t("saving") : t("saveResetPin")}
 </button>
 </div>
 </div>
 </div>
 </div>

 {/* Sign Out Card */}
 <div className="mb-8">
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 <div className="pl-[16px] pr-[18px] py-[11px]">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-[13px]">
 <div className="w-[30px] h-[30px] rounded-full bg-bg-tertiary flex items-center justify-center">
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M17 7L15.59 8.41L18.17 11H8V13H18.17L15.59 15.58L17 17L22 12L17 7ZM4 5H12V3H4C2.9 3 2 3.9 2 5V19C2 20.1 2.9 21 4 21H12V19H4V5Z" 
 fill="currentColor" className="text-fg-secondary"/>
 </svg>
 </div>
 <div className="flex-1">
 <div className="text-[17px] leading-[1.235] tracking-[-0.016em] text-fg-primary font-[590] mb-[1px]">
  {t("signOut")}
 </div>
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-tertiary">
  {t("sessionDesc")}
 </div>
 </div>
 </div>
 <button
 type="button"
 onClick={onSignOut}
 disabled={isBusy}
 className={`px-4 py-2 rounded-[8px] text-[15px] leading-[1.4667] tracking-[-0.012em] font-[590] transition-all duration-200 ${
 isBusy
 ? "bg-bg-tertiary text-fg-secondary cursor-not-allowed"
 : "bg-bg-tertiary text-fg-primary hover:bg-bg-tertiary/80 active:opacity-90"
 }`}
 >
  {t("signOut")}
 </button>
 </div>
 </div>
 </div>
 </div>

 {/* Delete Account Card */}
 <div className="mb-6">
 <div className="bg-red-50 dark:bg-red-900/20 rounded-[10px] overflow-hidden border border-red-200 dark:border-red-800/40">
 <div className="pl-[16px] pr-[18px] py-[11px]">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-[13px]">
 <div className="w-[30px] h-[30px] rounded-full bg-red-100/60 dark:bg-red-900/40 flex items-center justify-center">
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M15.5 4L14.5 3H9.5L8.5 4H5V6H19V4H15.5ZM6 19C6 20.1 6.9 21 8 21H16C17.1 21 18 20.1 18 19V7H6V19ZM8 9H16V19H8V9Z" 
 fill="currentColor" className="text-red-600 dark:text-red-400"/>
 </svg>
 </div>
 <div className="flex-1">
 <div className="text-[17px] leading-[1.235] tracking-[-0.016em] text-red-700 dark:text-red-400 font-[590] mb-[1px]">
  {t("deleteAccount")}
 </div>
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-red-600/80 dark:text-red-400/80">
  {t("deleteAccountDesc")}
 </div>
 </div>
 </div>
 
 {!showDeleteConfirm ? (
 <button
 type="button"
 onClick={() => setShowDeleteConfirm(true)}
 disabled={isBusy}
 className={`w-full sm:w-auto px-4 py-2 rounded-[8px] text-[15px] leading-[1.4667] tracking-[-0.012em] font-[590] transition-all duration-200 ${
 isBusy
 ? "bg-red-400 text-red-100 cursor-not-allowed"
 : "bg-red-500 dark:bg-red-600 text-white dark:text-white hover:bg-red-600 dark:hover:bg-red-700 active:opacity-90"
 }`}
 >
  {t("deleteAccount")}
 </button>
 ) : (
 <div className="flex w-full flex-col sm:w-auto sm:flex-row items-stretch sm:items-center gap-2">
 <button
 type="button"
 onClick={onDeleteAccount}
 disabled={isBusy}
 className={`w-full sm:w-auto px-4 py-2 rounded-[8px] text-[15px] leading-[1.4667] tracking-[-0.012em] font-[590] transition-all duration-200 ${
 isBusy
 ? "bg-red-400 text-red-100 cursor-not-allowed"
 : "bg-red-500 dark:bg-red-600 text-white dark:text-white hover:bg-red-600 dark:hover:bg-red-700 active:opacity-90"
 }`}
 >
  {t("confirm")}
 </button>
 <button
 type="button"
 onClick={() => setShowDeleteConfirm(false)}
 disabled={isBusy}
 className={`w-full sm:w-auto px-4 py-2 rounded-[8px] text-[15px] leading-[1.4667] tracking-[-0.012em] font-[590] transition-all duration-200 ${
 isBusy
 ? "bg-bg-tertiary text-fg-secondary cursor-not-allowed"
 : "bg-bg-tertiary text-fg-primary hover:bg-bg-tertiary/80 active:opacity-90"
 }`}
 >
  {t("cancel")}
 </button>
 </div>
 )}
 </div>
 
 {deleteAllData.error && (
 <div className="mt-3 pl-[43px]">
 <p className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-red-600 dark:text-red-400">
 {deleteAllData.error.message}
 </p>
 </div>
 )}
 </div>
 </div>
 </div>

 {/* Bottom Spacing */}
 <div className="h-8"></div>
 </div>
 </div>
 </div>
 );
}
