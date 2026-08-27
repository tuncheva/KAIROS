import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

/**
 * Shell for the small pre-auth pages the footer links to. Deliberately plain —
 * these are honest stubs saying the real content is coming, not filler text
 * dressed up as a policy.
 */
export async function StaticPage({
    titleKey,
    bodyKey,
}: {
    titleKey: string;
    bodyKey: string;
}) {
    const t = await getTranslations("staticPages");

    return (
        <main id="main-content" className="dark min-h-dvh bg-bg-primary px-6 py-24 text-fg-primary lg:px-12">
            <div className="mx-auto w-full max-w-[720px]">
                <Link
                    href="/"
                    className="k-nav inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[rgb(150,150,162)]"
                >
                    <ArrowLeft size={14} />
                    {t("backHome")}
                </Link>
                <h1 className="mt-10 font-display text-[clamp(2.5rem,6vw,4rem)] leading-[1.05] font-normal">
                    {t(titleKey)}
                </h1>
                <div className="my-8 h-px bg-white/[0.12]" />
                <p className="text-[19px] leading-[1.7] text-[rgb(178,178,190)]">{t(bodyKey)}</p>
            </div>
        </main>
    );
}
