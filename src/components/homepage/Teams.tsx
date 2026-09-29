"use client";

import { useTranslations } from "next-intl";
import { Eyebrow, SectionHeading } from "~/components/homepage/landingParts";

/** Demo roster. Names are sample people, so they stay as written in every locale. */
const MEMBERS = [
    { name: "Maria", role: "roleModerator", avatar: "k-avatar-1", accent: true },
    { name: "Ivan", role: "roleMember", avatar: "k-avatar-2" },
    { name: "Elena", role: "roleMember", avatar: "k-avatar-3" },
    { name: "Georgi", role: "roleIndividual", avatar: "k-avatar-4" },
] as const;

const PROGRESS = 68;

export function Teams() {
    const t = useTranslations("home");

    return (
        <section
            id="teams"
            className="mx-auto grid w-full max-w-[1440px] grid-cols-1 items-center gap-y-12 px-6 pt-32 lg:grid-cols-12 lg:gap-x-6 lg:px-20 lg:pt-[200px]"
        >
            <div data-reveal className="flex flex-col gap-7 lg:col-span-5">
                <Eyebrow>{t("teamsEyebrow")}</Eyebrow>
                <SectionHeading lead={t("teamsHeading")} accent={t("teamsHeadingAccent")} />
                <p className="m-0 text-[17px] leading-[1.75] font-light text-fg-tertiary">{t("teamsBody")}</p>
                <p className="m-0 text-[15px] leading-[1.7] text-fg-secondary">{t("teamsNote")}</p>
            </div>

            <div data-reveal className="k-sheet flex flex-col gap-7 p-6 sm:p-9 lg:col-span-6 lg:col-start-7">
                <div className="flex flex-wrap items-start justify-between gap-6">
                    <div className="flex flex-col gap-2">
                        <span className="font-mono text-[10px] tracking-[0.2em] text-fg-quaternary uppercase">
                            {t("teamsOrgLabel")}
                        </span>
                        <span className="font-display text-[34px] leading-none text-fg-primary">{t("teamsOrgName")}</span>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                        <span className="font-mono text-[10px] tracking-[0.2em] text-fg-quaternary uppercase">
                            {t("accessCode")}
                        </span>
                        <span className="rounded-sm border border-dashed border-fg-primary/25 px-3.5 py-2 font-mono text-base tracking-[0.2em] text-accent-primary">
                            K7M·42Q
                        </span>
                    </div>
                </div>

                <ul className="m-0 flex list-none flex-col border-t border-fg-primary/7 p-0">
                    {MEMBERS.map((member, i) => (
                        <li
                            key={member.name}
                            className={`k-item grid grid-cols-[36px_1fr_auto] items-center gap-3.5 px-1 py-4 ${
                                i < MEMBERS.length - 1 ? "border-b border-fg-primary/6" : ""
                            }`}
                        >
                            <span
                                className={`${member.avatar} flex h-9 w-9 items-center justify-center rounded-full font-display text-base text-fg-primary`}
                                aria-hidden="true"
                            >
                                {member.name[0]}
                            </span>
                            <span className="text-[15px] text-fg-primary">{member.name}</span>
                            <span className={`text-[13px] ${"accent" in member ? "text-accent-primary" : "text-fg-tertiary"}`}>
                                {t(member.role)}
                            </span>
                        </li>
                    ))}
                </ul>

                <div className="flex flex-col gap-2.5">
                    <div className="flex justify-between text-[13px] text-fg-quaternary">
                        <span>{t("teamsProject")}</span>
                        <span>{t("teamsProgress", { percent: PROGRESS })}</span>
                    </div>
                    <div className="h-[3px] overflow-hidden rounded-full bg-fg-primary/7">
                        <div data-reveal-rule className="h-[3px] bg-accent-primary" style={{ width: `${PROGRESS}%` }} />
                    </div>
                </div>
            </div>
        </section>
    );
}
