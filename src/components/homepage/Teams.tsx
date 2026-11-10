"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SectionHead } from "~/components/homepage/landingParts";
import { useInView, useOnScreen, useReducedMotion } from "~/components/homepage/landingMotion";

/** Demo roster. Names are sample people, so they stay as written in every locale. */
const MEMBERS = [
    { name: "Maria", role: "roleModerator", avatar: "k-avatar-1", accent: true },
    { name: "Ivan", role: "roleMember", avatar: "k-avatar-2" },
    { name: "Elena", role: "roleMember", avatar: "k-avatar-3" },
    { name: "Georgi", role: "roleIndividual", avatar: "k-avatar-4" },
] as const;

const PROGRESS = 68;
const CODE = "K7M·42Q";
const POOL = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Filler letters each code column rolls past. Deterministic, so the server
 * and the client draw the same column.
 */
function filler(column: number): string[] {
    return Array.from({ length: 4 }, (_, k) => POOL[(column * 7 + k * 11 + 3) % POOL.length]!);
}

/** A tile's shell: the raised sheet, a neutral spotlight, and `.is-in` once seen. */
function Tile({
    className = "",
    label,
    title,
    body,
    onSeen,
    children,
}: {
    className?: string;
    label: string;
    title: string;
    body?: string;
    /** Called once, the first time the tile is seen. */
    onSeen?: () => void;
    children: ReactNode;
}) {
    const ref = useRef<HTMLElement>(null);
    const seen = useInView(ref);
    const onSeenRef = useRef(onSeen);
    onSeenRef.current = onSeen;

    useEffect(() => {
        if (seen) onSeenRef.current?.();
    }, [seen]);

    return (
        <article
            ref={ref}
            data-reveal
            data-spotlight
            className={`k-sheet k-spot k-play hover:border-fg-primary/16 relative flex flex-col gap-5 p-[26px] transition-colors duration-400 ${seen ? "is-in" : ""} ${className}`}
        >
            <div className="flex flex-col gap-2">
                <span className="text-fg-tertiary font-mono text-[10px] tracking-[0.18em] uppercase">{label}</span>
                <h3 className="font-display text-fg-primary m-0 text-2xl leading-[1.15] font-normal tracking-[-0.015em]">
                    {title}
                </h3>
                {body && <p className="text-fg-tertiary m-0 max-w-[460px] text-[14.5px] leading-[1.65]">{body}</p>}
            </div>
            <div className="mt-auto">{children}</div>
        </article>
    );
}

function TeamTile() {
    const t = useTranslations("home");
    const tl = useTranslations("landing.teams");
    let column = 0;

    return (
        <Tile
            className="md:col-span-6 xl:col-span-4 xl:row-span-2"
            label={tl("label")}
            title={tl("title")}
            body={t("teamsBody")}
        >
            <div className="flex flex-col gap-[22px]">
                <div className="flex flex-wrap items-start justify-between gap-5">
                    <div className="flex flex-col gap-2">
                        <span className="text-fg-tertiary font-mono text-[10px] tracking-[0.2em] uppercase">
                            {t("teamsOrgLabel")}
                        </span>
                        <span className="font-display text-fg-primary text-[clamp(28px,3vw,34px)] leading-none">
                            {t("teamsOrgName")}
                        </span>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                        <span className="text-fg-tertiary font-mono text-[10px] tracking-[0.2em] uppercase">
                            {t("accessCode")}
                        </span>
                        <span
                            aria-label={CODE}
                            className="border-fg-primary/25 text-accent-primary inline-flex rounded-sm border border-dashed px-3.5 py-2 font-mono text-base tracking-[0.2em]"
                        >
                            {Array.from(CODE).map((ch, i) => {
                                if (ch === "·")
                                    return (
                                        <span key={i} aria-hidden="true">
                                            ·
                                        </span>
                                    );
                                const col = column++;
                                return (
                                    <span key={i} className="k-roll" aria-hidden="true">
                                        <span style={{ "--i": col } as CSSProperties}>
                                            {filler(col).map((f, k) => (
                                                <span key={k}>{f}</span>
                                            ))}
                                            <span>{ch}</span>
                                        </span>
                                    </span>
                                );
                            })}
                        </span>
                    </div>
                </div>

                <ul className="border-fg-primary/7 m-0 flex list-none flex-col border-t p-0">
                    {MEMBERS.map((member, i) => (
                        <li
                            key={member.name}
                            style={{ "--i": i } as CSSProperties}
                            className={`k-item k-member grid grid-cols-[36px_1fr_auto] items-center gap-3.5 px-1 py-3.5 ${
                                i < MEMBERS.length - 1 ? "border-fg-primary/6 border-b" : ""
                            }`}
                        >
                            <span
                                className={`${member.avatar} font-display text-fg-primary flex h-9 w-9 items-center justify-center rounded-full text-base`}
                                aria-hidden="true"
                            >
                                {member.name[0]}
                            </span>
                            <span className="text-fg-primary text-[15px]">{member.name}</span>
                            <span
                                className={`text-[13px] ${"accent" in member ? "text-accent-primary" : "text-fg-tertiary"}`}
                            >
                                {t(member.role)}
                            </span>
                        </li>
                    ))}
                </ul>

                <div className="flex flex-col gap-2.5">
                    <div className="text-fg-tertiary flex justify-between text-[13px]">
                        <span>{t("teamsProject")}</span>
                        <span className="tabular-nums">{t("teamsProgress", { percent: PROGRESS })}</span>
                    </div>
                    <div className="bg-fg-primary/7 h-[3px] overflow-hidden rounded-full">
                        <div data-reveal-rule className="bg-accent-primary h-[3px]" style={{ width: `${PROGRESS}%` }} />
                    </div>
                </div>

                <div className="k-late border-fg-primary/8 bg-bg-surface text-fg-secondary flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]">
                    <span
                        className="k-avatar-3 text-fg-primary flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full text-xs"
                        aria-hidden="true"
                    >
                        N
                    </span>
                    <span>
                        {tl.rich("joined", {
                            code: CODE,
                            mono: (chunks) => <span className="text-accent-primary font-mono">{chunks}</span>,
                        })}
                    </span>
                    <span className="text-fg-tertiary ml-auto font-mono text-[10px] tracking-[0.18em] uppercase">
                        {tl("justNow")}
                    </span>
                </div>
            </div>
        </Tile>
    );
}

const PERMISSIONS = [
    { key: "permInvite", on: true },
    { key: "permRoles", on: true },
    { key: "permPublish", on: true },
    { key: "permDelete", on: false },
] as const;

/** Moderator permissions; the switches work, and switch on in turn when seen. */
function OrgTile() {
    const t = useTranslations("home");
    const tl = useTranslations("landing.teams");
    const reduced = useReducedMotion();
    const [checked, setChecked] = useState<boolean[]>(() => PERMISSIONS.map(() => false));
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    useEffect(() => () => timers.current.forEach(clearTimeout), []);

    const switchOn = () => {
        PERMISSIONS.forEach((p, i) => {
            if (!p.on) return;
            const flip = () => setChecked((c) => c.map((v, k) => (k === i ? true : v)));
            if (reduced) flip();
            else timers.current.push(setTimeout(flip, 500 + i * 220));
        });
    };

    return (
        <Tile className="md:col-span-3 xl:col-span-2" label={tl("orgLabel")} title={tl("orgTitle")} onSeen={switchOn}>
            <>
                <div className="mb-3 flex flex-wrap gap-2">
                    {(["roleModerator", "roleMember", "roleIndividual"] as const).map((role, i) => (
                        <span
                            key={role}
                            className={`inline-flex h-[26px] items-center rounded-sm border px-2.5 text-xs ${
                                i === 0
                                    ? "border-accent-primary/45 text-accent-primary"
                                    : "border-fg-primary/12 text-fg-secondary"
                            }`}
                        >
                            {t(role)}
                        </span>
                    ))}
                </div>
                <ul className="m-0 list-none p-0">
                    {PERMISSIONS.map((p, i) => (
                        <li
                            key={p.key}
                            className={`text-fg-secondary flex items-center justify-between gap-3 py-2.5 text-sm ${
                                i > 0 ? "border-fg-primary/6 border-t" : ""
                            }`}
                        >
                            <span id={`perm-${p.key}`}>{tl(p.key)}</span>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={checked[i]}
                                aria-labelledby={`perm-${p.key}`}
                                onClick={() => setChecked((c) => c.map((v, k) => (k === i ? !v : v)))}
                                className="k-switch bg-fg-primary/12 relative h-5 w-[34px] flex-none rounded-full transition-colors duration-300"
                            />
                        </li>
                    ))}
                </ul>
            </>
        </Tile>
    );
}

const CIPHER_POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SCRAMBLE_POOL = "ABCDEFabcdef0123456789+/=";

function cipherOf(plain: string): string {
    return Array.from(plain, (ch, i) =>
        ch === " " && i % 3 ? " " : CIPHER_POOL[(i * 37 + 11) % CIPHER_POOL.length],
    ).join("");
}

/**
 * A private note that locks: its text scrambles left to right into cipher, and
 * back when unlocked. Locks itself once when seen (with motion); the button is
 * real either way.
 */
function LockTile() {
    const tl = useTranslations("landing.teams");
    const reduced = useReducedMotion();
    const plain = tl("lockNoteBody");
    const cipher = cipherOf(plain);
    const [locked, setLocked] = useState(false);
    const [text, setText] = useState(plain);
    const frame = useRef(0);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => {
        setText(locked ? cipher : plain);
    }, [plain, cipher, locked]);

    const toggle = (next: boolean) => {
        setLocked(next);
        if (reduced) return;
        cancelAnimationFrame(frame.current);
        const from = next ? plain : cipher;
        const to = next ? cipher : plain;
        const start = performance.now();
        const step = (now: number) => {
            const p = Math.min(1, (now - start) / 900);
            const cut = Math.floor(p * to.length);
            let s = to.slice(0, cut);
            for (let i = cut; i < to.length; i++) {
                s += i < cut + 6 ? SCRAMBLE_POOL[Math.floor(Math.random() * SCRAMBLE_POOL.length)] : from[i];
            }
            setText(s);
            if (p < 1) frame.current = requestAnimationFrame(step);
        };
        frame.current = requestAnimationFrame(step);
    };

    useEffect(
        () => () => {
            cancelAnimationFrame(frame.current);
            clearTimeout(timer.current);
        },
        [],
    );

    /* Locks itself once when first seen, to show what locking does. */
    const autoLock = () => {
        if (!reduced) timer.current = setTimeout(() => toggle(true), 1400);
    };

    return (
        <Tile className="md:col-span-3 xl:col-span-2" label={tl("lockLabel")} title={tl("lockTitle")} onSeen={autoLock}>
            <>
                <div
                    data-locked={locked}
                    className={`bg-bg-surface flex flex-col gap-2.5 rounded-lg border p-4 transition-colors duration-500 ${
                        locked ? "border-accent-primary/40" : "border-fg-primary/8"
                    }`}
                >
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-fg-primary text-sm font-medium">{tl("lockNoteTitle")}</span>
                        <button
                            type="button"
                            aria-pressed={locked}
                            onClick={() => toggle(!locked)}
                            className="border-fg-primary/14 text-fg-primary hover:border-accent-primary/60 hover:text-accent-primary inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12.5px] transition-colors"
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 32 32"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <rect x="7" y="14" width="18" height="14" rx="3" />
                                <path className="k-shackle" d="M11 14V10a5 5 0 0 1 10 0v4" />
                            </svg>
                            {locked ? tl("unlock") : tl("lock")}
                        </button>
                    </div>
                    <p
                        className={`m-0 min-h-[4.8em] break-all ${
                            locked
                                ? "text-fg-tertiary font-mono text-[12.5px] tracking-[0.02em]"
                                : "text-fg-secondary text-[13.5px] leading-[1.6]"
                        }`}
                    >
                        {locked && <span className="sr-only">{tl("lockedNotice")}</span>}
                        <span aria-hidden={locked || undefined}>{text}</span>
                    </p>
                </div>
                <p className="text-fg-tertiary m-0 mt-3 font-mono text-[10px] leading-[1.7] tracking-[0.18em] uppercase">
                    {tl("lockFoot")}
                </p>
            </>
        </Tile>
    );
}

const CHAT = [
    { name: "Ivan", avatar: "k-avatar-2", key: "chat1" },
    { name: "Elena", avatar: "k-avatar-3", key: "chat2" },
    { name: "Maria", avatar: "k-avatar-1", key: "chat3", me: true },
    { name: "Georgi", avatar: "k-avatar-4", key: "chat4" },
] as const;

/** Project chat: messages arrive one by one, with a typing line, while seen. */
function ChatTile() {
    const tl = useTranslations("landing.teams");
    const reduced = useReducedMotion();
    const boxRef = useRef<HTMLDivElement>(null);
    const onScreen = useOnScreen(boxRef, 0.3);
    const onScreenRef = useRef(onScreen);
    onScreenRef.current = onScreen;
    const [count, setCount] = useState<number>(CHAT.length);
    const [typing, setTyping] = useState<string | null>(null);

    useEffect(() => {
        if (reduced) return;
        let alive = true;
        const pause = (ms: number) =>
            new Promise<void>((resolve, reject) =>
                setTimeout(() => (alive ? resolve() : reject(new Error("stopped"))), ms),
            );
        const loop = async () => {
            for (;;) {
                while (!onScreenRef.current || document.hidden) await pause(400);
                setCount(0);
                for (let i = 0; i < CHAT.length; i++) {
                    setTyping(CHAT[i]!.name);
                    await pause(750);
                    setTyping(null);
                    setCount(i + 1);
                    await pause(600);
                }
                await pause(2600);
            }
        };
        loop().catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [reduced]);

    return (
        <Tile className="md:col-span-3" label={tl("chatLabel")} title={tl("chatTitle")}>
            <div ref={boxRef} aria-hidden="true">
                <div className="flex h-[214px] flex-col justify-end gap-2.5 overflow-hidden">
                    {CHAT.slice(0, count).map((m) => (
                        <div
                            key={m.key}
                            className={`k-chat-msg flex items-end gap-2.5 ${"me" in m ? "flex-row-reverse" : ""}`}
                        >
                            <span
                                className={`${m.avatar} text-fg-primary flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs`}
                            >
                                {m.name[0]}
                            </span>
                            <div
                                className={`text-fg-primary max-w-[280px] rounded-lg px-3 py-2 text-[13.5px] leading-[1.5] ${
                                    "me" in m ? "bg-accent-primary/16 rounded-br-xs" : "bg-fg-primary/6 rounded-bl-xs"
                                }`}
                            >
                                <small className="text-fg-tertiary mb-0.5 block text-[11px]">{m.name}</small>
                                {tl(m.key)}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="k-chat-typing text-fg-tertiary mt-2.5 flex min-h-[18px] items-center gap-2 text-xs">
                    {typing && (
                        <>
                            <span className="inline-flex gap-1">
                                {[0, 0.15, 0.3].map((d) => (
                                    <span
                                        key={d}
                                        className="bg-fg-quaternary h-1 w-1 rounded-full"
                                        style={{ animationDelay: `${d}s` }}
                                    />
                                ))}
                            </span>
                            {tl("chatTyping", { name: typing })}
                        </>
                    )}
                </div>
            </div>
        </Tile>
    );
}

const WEEK = [
    { day: 19, items: [{ key: "calVenue", kind: "task" }] },
    {
        day: 20,
        items: [
            { key: "calPage", kind: "task" },
            { key: "calMenu", kind: "note" },
        ],
    },
    { day: 21, today: true, items: [{ key: "calRsvp", kind: "task" }] },
    { day: 22, items: [{ key: "calLaunch", kind: "event" }] },
    { day: 23, items: [{ key: "calRetro", kind: "note" }] },
    { day: 24, items: [] },
    { day: 25, items: [] },
] as const;

const EV_STYLE = {
    task: "border-l-2 border-accent-primary bg-accent-primary/10 text-fg-primary",
    event: "bg-fg-primary font-semibold text-bg-primary",
    note: "border border-dashed border-fg-primary/25 text-fg-secondary",
} as const;

/** One week with tasks, an event and dated notes, filling in when seen. */
function CalendarTile() {
    const tl = useTranslations("landing.teams");
    const locale = useLocale();
    // Monday 19 October 2026; weekday names follow the page's locale.
    const weekday = new Intl.DateTimeFormat(locale, {
        weekday: "short",
        timeZone: "UTC",
    });
    const dayName = (d: number) => weekday.format(new Date(Date.UTC(2026, 9, d)));
    let n = 0;

    return (
        <Tile className="md:col-span-3" label={tl("calLabel")} title={tl("calTitle")}>
            <div className="flex flex-col gap-3.5">
                <div className="grid grid-cols-7 gap-1.5" aria-hidden="true">
                    {WEEK.map((d) => (
                        <div
                            key={d.day}
                            className={`flex min-h-[112px] flex-col gap-1.5 rounded-md border px-1.5 py-2 ${
                                "today" in d ? "border-accent-primary/40 bg-fg-primary/4" : "border-fg-primary/6"
                            }`}
                        >
                            <span className="text-fg-tertiary flex justify-between font-mono text-[10px]">
                                <span>{dayName(d.day)}</span>
                                <b className={`font-medium ${"today" in d ? "text-accent-primary" : ""}`}>{d.day}</b>
                            </span>
                            {d.items.map((item) => (
                                <span
                                    key={item.key}
                                    style={{ "--i": n++ } as CSSProperties}
                                    className={`k-cal-ev truncate rounded-xs px-[5px] py-1 text-[10.5px] leading-[1.3] ${EV_STYLE[item.kind]}`}
                                >
                                    {tl(item.key)}
                                </span>
                            ))}
                        </div>
                    ))}
                </div>
                <div className="text-fg-tertiary flex flex-wrap gap-4 text-xs">
                    <span className="inline-flex items-center gap-1.5">
                        <i className="border-accent-primary bg-accent-primary/35 h-2.5 w-2.5 rounded-xs border-l-2" />
                        {tl("legendTask")}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <i className="bg-fg-primary h-2.5 w-2.5 rounded-xs" />
                        {tl("legendEvent")}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <i className="border-fg-primary/40 h-2.5 w-2.5 rounded-xs border border-dashed" />
                        {tl("legendNote")}
                    </span>
                </div>
            </div>
        </Tile>
    );
}

/**
 * Teams & organizations as a bento: the team with its code, members and
 * progress; organization roles and permissions; a private note that locks;
 * project chat; and the calendar. Each tile plays its illustration once when
 * it is seen, and is simply drawn at its end under reduced motion.
 */
export function Teams() {
    const t = useTranslations("home");

    return (
        <section
            id="teams"
            aria-labelledby="teams-h"
            className="mx-auto w-full max-w-[1440px] scroll-mt-10 px-6 pt-32 lg:px-20 lg:pt-[200px]"
        >
            <SectionHead
                id="teams-h"
                eyebrow={t("teamsEyebrow")}
                lead={t("teamsHeading")}
                accent={t("teamsHeadingAccent")}
                body={t("teamsNote")}
            />
            <div className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-6">
                <TeamTile />
                <OrgTile />
                <LockTile />
                <ChatTile />
                <CalendarTile />
            </div>
        </section>
    );
}
