"use client";

import { useTranslations } from "next-intl";
import { FolderKanban, Users, Shield } from "lucide-react";
import ScrollReveal from "~/components/homepage/ScrollReveal";

const PANELS = [
    { icon: FolderKanban, tag: "ORG", titleKey: "wsOrgTitle", bodyKey: "wsOrgBody" },
    { icon: Users, tag: "TEAM", titleKey: "wsTeamTitle", bodyKey: "wsTeamBody" },
    { icon: Shield, tag: "PERSONAL", titleKey: "wsPersonalTitle", bodyKey: "wsPersonalBody" },
] as const;

/**
 * The left column is sticky while the ~1300px stack of panels passes it — the
 * label and heading hold for the whole section. Below `lg` the two columns
 * stack and the sticky behaviour is dropped.
 */
export function WorkspacesPinned() {
    const t = useTranslations("home");

    return (
        <section
            id="workspaces"
            className="relative mx-auto w-full max-w-[1280px] scroll-mt-24 px-6 pt-24 pb-10 lg:px-12"
        >
            <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[340px_1fr] lg:gap-16">
                <div className="lg:sticky lg:top-[120px]">
                    <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-primary">
                        {t("wsLabel")}
                    </div>
                    <ScrollReveal
                        as="h2"
                        variant="inherit"
                        baseOpacity={0.12}
                        wordAnimationEnd="center 60%"
                        containerClassName="mt-[18px] font-display text-[clamp(2.25rem,4vw,3.25rem)] leading-[1.05] font-normal tracking-[-0.01em] text-fg-primary"
                    >
                        {t("wsHeading")}
                    </ScrollReveal>
                    <div data-reveal-rule className="my-7 h-px bg-white/[0.12]" />
                    <p data-reveal className="text-base leading-[1.7] text-[rgb(160,160,172)]">
                        {t("wsBody")}
                    </p>
                </div>

                <div className="flex flex-col gap-7">
                    {PANELS.map(({ icon: Icon, tag, titleKey, bodyKey }) => (
                        <article
                            key={tag}
                            data-reveal
                            className="k-panel flex min-h-[400px] flex-col justify-between rounded-[20px] border border-white/[0.09] bg-[#0c0c12] p-8 lg:p-11"
                        >
                            <div className="flex items-start justify-between">
                                <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px] border border-accent-primary/[0.28] bg-accent-primary/[0.14] text-accent-secondary">
                                    <Icon size={24} strokeWidth={1.8} />
                                </span>
                                <span className="font-mono text-[11px] tracking-[0.18em] text-[rgb(110,110,124)]">
                                    {tag}
                                </span>
                            </div>
                            <div>
                                <h3 className="font-display text-[clamp(2rem,3.4vw,2.75rem)] leading-[1.1] font-normal text-fg-primary">
                                    {t(titleKey)}
                                </h3>
                                <p className="mt-3.5 max-w-[520px] text-[17px] leading-[1.7] text-[rgb(178,178,190)]">
                                    {t(bodyKey)}
                                </p>
                            </div>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
}
