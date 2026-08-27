import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

export type LegalSection = {
    /** Anchor target. Must be unique within the document — the ToC links to it. */
    id: string;
    heading: string;
    body: ReactNode;
};

/**
 * Shell for long-form legal documents (privacy policy, terms).
 *
 * Distinct from `StaticPage`, which renders a single paragraph and stays the right
 * shape for the small about/contact/careers stubs. The table of contents is derived
 * from `sections` rather than passed separately, so the nav and the body cannot
 * drift apart. No client JS: native anchors do the navigating, which keeps this a
 * server component.
 */
export async function LegalPage({
    title,
    lastUpdated,
    intro,
    sections,
}: {
    title: string;
    lastUpdated: string;
    intro?: ReactNode;
    sections: LegalSection[];
}) {
    const t = await getTranslations("staticPages");

    return (
        <main id="main-content" className="dark min-h-dvh bg-bg-primary px-6 py-24 text-fg-primary lg:px-12">
            <div className="mx-auto w-full max-w-[720px] lg:grid lg:max-w-[1000px] lg:grid-cols-[220px_minmax(0,720px)] lg:gap-16">
                <div className="lg:col-span-2">
                    <Link
                        href="/"
                        className="k-nav inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[rgb(150,150,162)]"
                    >
                        <ArrowLeft size={14} />
                        {t("backHome")}
                    </Link>
                    <h1 className="mt-10 font-display text-[clamp(2.5rem,6vw,4rem)] leading-[1.05] font-normal">
                        {title}
                    </h1>
                    <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.18em] text-[rgb(110,110,124)]">
                        Last updated {lastUpdated}
                    </p>
                    <div className="my-8 h-px bg-white/[0.12]" />
                </div>

                <nav
                    aria-label="Sections"
                    className="hidden lg:col-start-1 lg:block lg:self-start lg:sticky lg:top-24"
                >
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(110,110,124)]">
                        Contents
                    </div>
                    <ol className="mt-4 flex flex-col gap-2.5">
                        {sections.map((section, i) => (
                            <li key={section.id} className="flex gap-2 text-sm leading-[1.5]">
                                <span className="font-mono text-[11px] text-[rgb(105,105,118)] pt-[3px]">
                                    {i + 1}
                                </span>
                                <a href={`#${section.id}`} className="k-nav text-[rgb(190,190,202)]">
                                    {section.heading}
                                </a>
                            </li>
                        ))}
                    </ol>
                </nav>

                <div className="lg:col-start-2">
                    {intro ? (
                        <div className="flex flex-col gap-5 text-[19px] leading-[1.7] text-[rgb(178,178,190)]">
                            {intro}
                        </div>
                    ) : null}

                    {sections.map((section, i) => (
                        <section key={section.id} className="mt-14 scroll-mt-24" id={section.id}>
                            <h2 className="font-display text-[26px] leading-[1.25] font-normal text-fg-primary">
                                <span className="mr-3 font-mono text-[12px] align-middle text-[rgb(105,105,118)]">
                                    {String(i + 1).padStart(2, "0")}
                                </span>
                                {section.heading}
                            </h2>
                            <div className="mt-5 flex flex-col gap-5 text-[19px] leading-[1.7] text-[rgb(178,178,190)]">
                                {section.body}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
        </main>
    );
}
