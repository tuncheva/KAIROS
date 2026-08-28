"use client";

import { api } from"~/trpc/react";
import { ChevronDown, LogIn, LogOut, Users } from"lucide-react";
import { signIn, signOut, useSession } from"next-auth/react";
import { useState, useRef, useEffect } from"react";
import Image from"next/image";
import { avatarGradientStyle } from"~/lib/avatarGradient";
import { useTranslations } from"next-intl";
import { onAvatarUpdate } from"~/lib/avatarEvents";

type Translator = (key: string, values?: Record<string, unknown>) => string;

type StoredAccount = {
 userId: string;
 email: string;
 name?: string | null;
 image?: string | null;
 lastUsed: number;
};

export function UserDisplay() {
 const useT = useTranslations as unknown as (namespace: string) => Translator;
 const tSettings = useT("settings");
 const tOrg = useT("org");
 const [isOpen, setIsOpen] = useState(false);
 const [storedAccounts, setStoredAccounts] = useState<StoredAccount[]>([]);
 // Switching accounts requires re-authentication, so picking an account opens a
 // password prompt rather than signing in directly.
 const [pendingAccount, setPendingAccount] = useState<StoredAccount | null>(null);
 const [switchPassword, setSwitchPassword] = useState("");
 const [switchError, setSwitchError] = useState<string | null>(null);
 const [isSwitching, setIsSwitching] = useState(false);
 // Set the moment a new avatar is uploaded elsewhere in the app, so the picture
 // here changes without waiting for the profile query to come back around.
 const [avatarOverride, setAvatarOverride] = useState<string | null>(null);
 const dropdownRef = useRef<HTMLDivElement>(null);

 const { status } = useSession();
 const enabled = status ==="authenticated";

 const utils = api.useUtils();

 const { data: user, isLoading } = api.user.getCurrentUser.useQuery(undefined, {
 enabled,
 staleTime: 1000 * 60 * 5,
 refetchOnWindowFocus: false,
 refetchOnMount: false,
 });

 const { data: profile } = api.user.getProfile.useQuery(undefined, {
 enabled,
 staleTime: 1000 * 60 * 5,
 refetchOnWindowFocus: false,
 refetchOnMount: false,
 });

 useEffect(() => {
 return onAvatarUpdate((imageUrl) => {
 setAvatarOverride(imageUrl);
 utils.user.getCurrentUser.setData(undefined, (old) =>
 old ? { ...old, image: imageUrl } : old,
 );
 });
 }, [utils]);

 // Once the query itself carries the new picture the override has nothing left
 // to do, and holding it would mask a later change from the server.
 useEffect(() => {
 if (avatarOverride && user?.image === avatarOverride) {
 setAvatarOverride(null);
 }
 }, [avatarOverride, user?.image]);

 useEffect(() => {
 if (!user?.email) return;

 const refreshAccounts = async () => {
 try {
 await fetch("/api/account-switch/register", { method:"POST" });
 const res = await fetch("/api/account-switch/list", { method:"GET" });
 const data = (await res.json()) as unknown;
 if (!data || typeof data !=="object") return;
 const accounts = (data as { accounts?: unknown }).accounts;
 if (!Array.isArray(accounts)) return;

 const normalized = accounts
 .filter((a): a is StoredAccount => {
 if (!a || typeof a !=="object") return false;
 const x = a as Partial<StoredAccount>;
 return (
 typeof x.userId ==="string" &&
 typeof x.email ==="string" &&
 typeof x.lastUsed ==="number"
 );
 })
 .sort((a, b) => b.lastUsed - a.lastUsed);

 setStoredAccounts(normalized);
 } catch {
 // ignore
 }
 };

 void refreshAccounts();
 }, [user?.email]);

 useEffect(() => {
 const handleClickOutside = (event: MouseEvent) => {
 if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
 setIsOpen(false);
 setPendingAccount(null);
 setSwitchPassword("");
 setSwitchError(null);
 }
 };

 document.addEventListener("mousedown", handleClickOutside);
 return () => document.removeEventListener("mousedown", handleClickOutside);
 }, []);

 const handleSignOut = async () => {
 await utils.settings.get.cancel();
 await utils.user.getCurrentUser.cancel();
 await utils.organization.getActive.cancel();
 await utils.organization.listMine.cancel();
 await signOut({ callbackUrl:"/" });
 };

 const handleSwitchAccount = async () => {
 await utils.settings.get.cancel();
 await utils.user.getCurrentUser.cancel();
 await utils.organization.getActive.cancel();
 await utils.organization.listMine.cancel();
 await signOut({ callbackUrl:"/?switchAccount=1" });
 };

 const beginSwitchToAccount = (account: StoredAccount) => {
 setPendingAccount(account);
 setSwitchPassword("");
 setSwitchError(null);
 };

 const cancelSwitch = () => {
 setPendingAccount(null);
 setSwitchPassword("");
 setSwitchError(null);
 };

 /**
  * Hand the switch off to a full sign-in.
  *
  * Used when the target account has no password (OAuth-only), where a fresh
  * provider round-trip is the re-authentication.
  */
 const switchViaFullSignIn = async (account: StoredAccount) => {
 const encoded = encodeURIComponent(account.email);
 await signOut({ callbackUrl: `/?switchAccount=1&email=${encoded}` });
 };

 const handleSwitchToAccount = async (account: StoredAccount, password: string) => {
 if (!password) {
 setSwitchError(tSettings("security.switchPasswordRequired"));
 return;
 }

 setIsSwitching(true);
 setSwitchError(null);

 const result = await signIn("account-switch", {
 userId: account.userId,
 password,
 redirect: false,
 });

 if (result?.error) {
 // The server cannot distinguish "wrong password" from "no password on this
 // account" without telling an attacker which accounts are OAuth-only, so the
 // message stays generic and offers the full sign-in route as the way out.
 setIsSwitching(false);
 setSwitchPassword("");
 setSwitchError(tSettings("security.switchFailed"));
 return;
 }

 await utils.settings.get.cancel();
 await utils.user.getCurrentUser.cancel();
 await utils.organization.getActive.cancel();
 await utils.organization.listMine.cancel();

 window.location.href ="/";
 };

 if (isLoading) {
 return (
 <div className="flex items-center gap-3 animate-pulse">
 <div className="hidden sm:flex flex-col items-end gap-1">
 <div className="h-4 bg-bg-tertiary/60 rounded w-24" />
 <div className="h-3 bg-bg-tertiary/60 rounded w-32" />
 </div>
 <div className="w-8 h-8 bg-bg-tertiary/60 rounded-full" />
 </div>
 );
 }

 if (!user) {
 return null;
 }

 const avatarSrc = avatarOverride ?? user.image ?? null;

 const otherAccounts = storedAccounts.filter((a) => 
 a.email && 
 a.email !== user.email && 
 a.userId && 
 a.lastUsed > 0
 );

 return (
 <div className="relative" ref={dropdownRef}>
 <button
 onClick={() => setIsOpen(!isOpen)}
 className="flex items-center gap-3 group rounded-xl focus-visible:outline-none"
 aria-haspopup="menu"
 aria-expanded={isOpen}
 >
 <div className="hidden sm:flex flex-col items-end">
 <div className="text-sm font-medium text-fg-primary group-hover:text-fg-primary transition-colors">
 {user.name ??"User"}
 </div>
 <div className="text-xs text-fg-secondary group-hover:text-fg-primary transition-colors">
 {user.email}
 </div>
 </div>
 
 {avatarSrc ? (
 <Image src={avatarSrc} alt={user.name ??"User"} width={32} height={32} unoptimized className="w-8 h-8 rounded-full object-cover ring-2 ring-border-light/20 group-hover:ring-accent-primary/50 transition-all" />
 ) : (
 <div style={avatarGradientStyle(user.id ?? user.email ?? user.name)} className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold">
 {user.name?.charAt(0).toUpperCase() ??"U"}
 </div>
 )}
 
 <ChevronDown 
 size={16} 
 className={`text-fg-secondary group-hover:text-fg-primary transition-transform ${isOpen ?"rotate-180" :""}`}
 />
 </button>

 {isOpen && (
 <div
 className="absolute right-0 mt-3 w-64 rounded-2xl dark:border-white/[0.06] border border-slate-200 shadow-2xl overflow-hidden z-50 dark:bg-[#16151A] bg-white"
 role="menu"
 aria-label={tSettings("title")}
 >
 <div className="p-4 border-b dark:border-white/10 border-slate-200 dark:bg-[#1A191E] bg-slate-50">
 <div className="flex items-center gap-3">
 {avatarSrc ? (
 <Image
 src={avatarSrc}
 alt={user.name ??"User"}
 width={48}
 height={48}
 unoptimized
 className="w-12 h-12 rounded-full object-cover ring-2 ring-border-light/20"
 />
 ) : (
 <div style={avatarGradientStyle(user.id ?? user.email ?? user.name)} className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold">
 {user.name?.charAt(0).toUpperCase() ??"U"}
 </div>
 )}
 <div className="flex-1 min-w-0">
 <div className="text-sm font-semibold text-fg-primary truncate">
 {user.name ??"User"}
 </div>
 <div className="text-xs text-fg-secondary truncate">
 {user.email}
 </div>
 {profile?.role && (
 <div className="text-[10px] text-accent-primary font-medium mt-0.5 capitalize">
 {profile.role}{profile.organization ? ` · ${profile.organization.name}` : ""}
 </div>
 )}
 </div>
 </div>
 {user.bio && (
 <p className="text-xs text-fg-secondary mt-2 line-clamp-2">
 {user.bio}
 </p>
 )}
 </div>

 <div className="p-2">
 <a
 href="/orgs"
 className="flex items-center gap-3 px-3 py-2.5 text-sm text-fg-primary hover:bg-bg-secondary/60 rounded-xl transition-colors"
 onClick={() => setIsOpen(false)}
 role="menuitem"
 >
 <Users size={16} />
 {tOrg("switchOrg")}
 </a>

 {otherAccounts.length === 0 ? (
 <button
 onClick={handleSwitchAccount}
 className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-fg-primary hover:bg-bg-secondary/60 rounded-xl transition-colors"
 role="menuitem"
 >
 <LogIn size={16} />
 {tSettings("security.addAccount")}
 </button>
 ) : (
 <div className="mt-1">
 <div className="px-3 pt-2 pb-1 text-xs font-medium text-fg-tertiary">
 {tSettings("security.changeAccount")}
 </div>
 {pendingAccount ? (
 <form
 className="px-3 py-2.5 space-y-2"
 onSubmit={(e) => {
 e.preventDefault();
 void handleSwitchToAccount(pendingAccount, switchPassword);
 }}
 >
 <div className="text-xs text-fg-secondary truncate">
 {tSettings("security.switchConfirmFor", { email: pendingAccount.email })}
 </div>
 <input
 type="password"
 autoFocus
 autoComplete="current-password"
 value={switchPassword}
 onChange={(e) => setSwitchPassword(e.target.value)}
 placeholder={tSettings("security.switchPasswordLabel")}
 className="w-full px-2.5 py-1.5 text-sm rounded-lg bg-bg-secondary/60 text-fg-primary border border-border-light/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
 />
 {switchError ? (
 <div className="text-xs text-red-500">{switchError}</div>
 ) : null}
 <div className="flex items-center gap-2">
 <button
 type="submit"
 disabled={isSwitching}
 className="flex-1 px-2.5 py-1.5 text-sm rounded-lg bg-accent-primary text-white disabled:opacity-60"
 >
 {isSwitching
 ? tSettings("security.switching")
 : tSettings("security.switchConfirm")}
 </button>
 <button
 type="button"
 onClick={cancelSwitch}
 className="px-2.5 py-1.5 text-sm rounded-lg text-fg-secondary hover:bg-bg-secondary/60"
 >
 {tSettings("security.switchCancel")}
 </button>
 </div>
 <button
 type="button"
 onClick={() => void switchViaFullSignIn(pendingAccount)}
 className="w-full text-left text-xs text-fg-secondary hover:text-fg-primary underline"
 >
 {tSettings("security.switchUseOtherMethod")}
 </button>
 </form>
 ) : (
 otherAccounts.map((acct) => (
 <button
 key={acct.email}
 onClick={() => beginSwitchToAccount(acct)}
 className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-fg-primary hover:bg-bg-secondary/60 rounded-xl transition-colors"
 role="menuitem"
 >
 {acct.image ? (
 <Image
 src={acct.image}
 alt={acct.name ?? acct.email}
 width={20}
 height={20}
 className="w-5 h-5 rounded-full object-cover"
 />
 ) : (
 <div className="w-5 h-5 rounded-full bg-bg-tertiary/60" />
 )}
 <span className="truncate">{acct.name?.trim() ? acct.name : tSettings("security.account")}</span>
 </button>
 ))
 )}

 <button
 onClick={handleSwitchAccount}
 className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-fg-primary hover:bg-bg-secondary/60 rounded-xl transition-colors"
 role="menuitem"
 >
 <LogIn size={16} />
 {tSettings("security.addAccount")}
 </button>
 </div>
 )}

 <a
 href="/settings"
 className="flex items-center gap-3 px-3 py-2.5 text-sm text-fg-primary hover:bg-bg-secondary/60 rounded-xl transition-colors"
 onClick={() => setIsOpen(false)}
 role="menuitem"
 >
 <svg 
 className="w-4 h-4" 
 fill="none" 
 stroke="currentColor" 
 viewBox="0 0 24 24"
 >
 <path 
 strokeLinecap="round" 
 strokeLinejoin="round" 
 strokeWidth={2} 
 d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" 
 />
 </svg>
 {tSettings("profile.title")}
 </a>
 
 <button
 onClick={handleSignOut}
 className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-accent-primary hover:bg-accent-primary/10 rounded-xl transition-colors"
 role="menuitem"
 >
 <LogOut size={16} />
 {tSettings("security.signOut")}
 </button>
 </div>
 </div>
 )}
 </div>
 );
}