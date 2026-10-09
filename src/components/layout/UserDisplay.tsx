"use client";

import { api } from"~/trpc/react";
import { LogIn, LogOut, Users } from "~/components/ui/icons";
import { signIn, signOut, useSession } from"next-auth/react";
import { useState, useRef, useEffect } from"react";
import Image from"next/image";
import { useSocketConnected } from "~/components/providers/SocketProvider";
import { useTranslations } from"next-intl";
import { onAvatarUpdate } from"~/lib/avatarEvents";
import { Skeleton } from "~/components/ui/Skeleton";
import { useSkeletonHold } from "~/hooks/useSkeletonHold";
import { useReleasePush } from "~/hooks/useReleasePush";
import { useMenuExit } from "~/components/ui/menuExit";

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
 const menu = useMenuExit(isOpen);
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
 // The dot on the avatar is the live connection, not a status you set: green
 // while the realtime socket is up, gone while it is not — so a quiet chat or
 // a bell that stopped ringing has an explanation one glance away.
 const isLive = useSocketConnected();

 const { status } = useSession();
 const enabled = status ==="authenticated";

 const utils = api.useUtils();
 const releasePush = useReleasePush();

 const { data: user, isLoading } = api.user.getCurrentUser.useQuery(undefined, {
 enabled,
 staleTime: 1000 * 60 * 5,
 refetchOnWindowFocus: false,
 refetchOnMount: false,
 });
 const showSkeleton = useSkeletonHold(isLoading);

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
 await releasePush();
 await signOut({ callbackUrl:"/" });
 };

 const handleSwitchAccount = async () => {
 await utils.settings.get.cancel();
 await utils.user.getCurrentUser.cancel();
 await utils.organization.getActive.cancel();
 await utils.organization.listMine.cancel();
 await releasePush();
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
 await releasePush();
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

 // The password was right, but the account has two-step sign-in on, and the
 // switcher is a password-only door. The full sign-in asks for the code.
 if (result?.code === "FULL_SIGN_IN_REQUIRED") {
 await switchViaFullSignIn(account);
 return;
 }

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

 if (showSkeleton) {
 return (
 <div className="flex items-center p-0.5" aria-hidden="true">
 {/* Same box as the loaded button: the avatar alone. */}
 <Skeleton shape="circle" className="w-[34px] h-[34px]" />
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
 {/* Avatar only. The name + email stack was the widest thing in the bar
     and said what the avatar already says; it now heads the menu. */}
 <button
 onClick={() => setIsOpen(!isOpen)}
 className={`relative flex items-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tui-accent ${
 isOpen ? "bg-tui-ink/[0.05]" : "hover:bg-tui-ink/[0.05]"
 }`}
 aria-haspopup="menu"
 aria-expanded={isOpen}
 aria-label={user.name ?? user.email ?? tSettings("title")}
 title={user.email ?? undefined}
 >
 <Avatar src={avatarSrc} name={user.name} size={34} />
 {isLive ? (
 <span
 aria-hidden="true"
 className="absolute right-0.5 bottom-0.5 h-[9px] w-[9px] rounded-full bg-tui-ok ring-2 ring-tui-pane"
 />
 ) : null}
 </button>

 {menu.mounted && (
 <div
 aria-hidden={menu.closing || undefined}
 className={`${menu.closing ? "topbar-menu--out" : "topbar-menu"} origin-top-right absolute right-0 mt-2 w-[268px] rounded-xl border border-tui-ink/12 shadow-[var(--tui-lift)] overflow-hidden z-50 bg-tui-pane`}
 role="menu"
 aria-label={tSettings("title")}
 >
 <div className="px-4 pt-4 pb-3.5 border-b border-tui-ink/8">
 <div className="flex items-center gap-3">
 <Avatar src={avatarSrc} name={user.name} size={42} />
 <div className="flex-1 min-w-0">
 <div className="font-display text-[20px] leading-tight text-tui-ink truncate">
 {user.name ??"User"}
 </div>
 <div className="text-xs text-tui-ink3 truncate">
 {user.email}
 </div>
 {profile?.role && (
 <div className="text-[11px] text-tui-accent font-medium mt-0.5 capitalize">
 {profile.role}{profile.organization ? ` · ${profile.organization.name}` : ""}
 </div>
 )}
 </div>
 </div>
 {user.bio && (
 <p className="text-xs text-tui-ink2 mt-2 line-clamp-2">
 {user.bio}
 </p>
 )}
 </div>

 <div className="p-1.5">
 <a
 href="/orgs"
 className="flex items-center gap-3 px-2.5 py-2 text-[13.5px] text-tui-ink hover:bg-tui-ink/[0.045] rounded-lg transition-colors"
 onClick={() => setIsOpen(false)}
 role="menuitem"
 >
 <Users size={16} />
 {tOrg("switchOrg")}
 </a>

 {otherAccounts.length === 0 ? (
 <button
 onClick={handleSwitchAccount}
 className="w-full flex items-center gap-3 px-2.5 py-2 text-[13.5px] text-tui-ink hover:bg-tui-ink/[0.045] rounded-lg transition-colors"
 role="menuitem"
 >
 <LogIn size={16} />
 {tSettings("security.addAccount")}
 </button>
 ) : (
 <div className="mt-1">
 <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-tui-ink3">
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
 <div className="text-xs text-tui-ink3 truncate">
 {tSettings("security.switchConfirmFor", { email: pendingAccount.email })}
 </div>
 <input
 type="password"
 autoFocus
 autoComplete="current-password"
 value={switchPassword}
 onChange={(e) => setSwitchPassword(e.target.value)}
 placeholder={tSettings("security.switchPasswordLabel")}
 className="w-full px-2.5 py-1.5 text-sm rounded-lg bg-tui-ink/[0.035] text-tui-ink border border-tui-ink/12 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-tui-accent"
 />
 {switchError ? (
 <div className="text-xs text-status-danger-ink">{switchError}</div>
 ) : null}
 <div className="flex items-center gap-2">
 <button
 type="submit"
 disabled={isSwitching}
 className="flex-1 px-2.5 py-1.5 text-sm rounded-full bg-tui-accent text-tui-on-accent disabled:opacity-60"
 >
 {isSwitching
 ? tSettings("security.switching")
 : tSettings("security.switchConfirm")}
 </button>
 <button
 type="button"
 onClick={cancelSwitch}
 className="px-2.5 py-1.5 text-sm rounded-full text-tui-ink2 hover:bg-tui-ink/[0.045]"
 >
 {tSettings("security.switchCancel")}
 </button>
 </div>
 <button
 type="button"
 onClick={() => void switchViaFullSignIn(pendingAccount)}
 className="w-full text-left text-xs text-tui-ink3 hover:text-tui-ink underline"
 >
 {tSettings("security.switchUseOtherMethod")}
 </button>
 </form>
 ) : (
 otherAccounts.map((acct) => (
 <button
 key={acct.email}
 onClick={() => beginSwitchToAccount(acct)}
 className="w-full flex items-center gap-3 px-2.5 py-2 text-[13.5px] text-tui-ink hover:bg-tui-ink/[0.045] rounded-lg transition-colors"
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
 <div className="w-5 h-5 rounded-full bg-tui-ink/10" />
 )}
 <span className="truncate">{acct.name?.trim() ? acct.name : tSettings("security.account")}</span>
 </button>
 ))
 )}

 <button
 onClick={handleSwitchAccount}
 className="w-full flex items-center gap-3 px-2.5 py-2 text-[13.5px] text-tui-ink hover:bg-tui-ink/[0.045] rounded-lg transition-colors"
 role="menuitem"
 >
 <LogIn size={16} />
 {tSettings("security.addAccount")}
 </button>
 </div>
 )}

 <a
 href="/settings"
 className="flex items-center gap-3 px-2.5 py-2 text-[13.5px] text-tui-ink hover:bg-tui-ink/[0.045] rounded-lg transition-colors"
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
 
 <div aria-hidden="true" className="mx-2.5 my-1 border-t border-tui-ink/8" />
 <button
 onClick={handleSignOut}
 className="w-full flex items-center gap-3 px-2.5 py-2 text-[13.5px] text-tui-danger hover:bg-tui-danger/10 rounded-lg transition-colors"
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

/**
 * The account's face: the uploaded picture, or a serif initial on a quiet ink
 * wash — the refined edition's avatar, in place of the gradient disc.
 */
function Avatar({
 src,
 name,
 size,
}: {
 src: string | null;
 name?: string | null;
 size: number;
}) {
 if (src) {
 return (
 <Image
 src={src}
 alt=""
 width={size}
 height={size}
 unoptimized
 className="rounded-full object-cover ring-1 ring-tui-ink/12"
 style={{ width: size, height: size }}
 />
 );
 }

 return (
 <span
 aria-hidden="true"
 className="flex items-center justify-center rounded-full border border-tui-ink/12 bg-tui-ink/[0.06] font-display leading-none text-tui-ink"
 style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
 >
 {name?.trim() ? name.trim().charAt(0).toUpperCase() : "U"}
 </span>
 );
}
