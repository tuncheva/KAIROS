"use client";

import { useTranslations } from "next-intl";
import { CountUp } from "~/components/homepage/CountUp";

/** Facts about the product, stated as figures. Each one is true of the code. */
const FIGURES = [
    { value: 5, key: "agents" },
    { value: 2, key: "scheduled" },
    { value: 0, key: "approval" },
    { value: 256, key: "encryption" },
] as const;

export function Numbers() {
    const t = useTranslations("landing.numbers");

    return (
        <section className="mx-auto w-full max-w-[1440px] px-6 pt-32 lg:px-20 lg:pt-[200px]">
            <dl data-stagger className="border-fg-primary/8 m-0 grid grid-cols-2 border-t min-[900px]:grid-cols-4">
                {FIGURES.map((figure, i) => (
                    <div
                        key={figure.key}
                        className={`flex flex-col gap-2.5 pt-[34px] pr-5 pb-2 ${
                            i > 0 ? "min-[900px]:border-fg-primary/6 min-[900px]:border-l min-[900px]:pl-7" : ""
                        }`}
                    >
                        <dt className="font-display text-fg-primary text-[clamp(48px,6vw,84px)] leading-none tracking-[-0.035em]">
                            {figure.value === 0 ? (
                                <span className="tabular-nums">0</span>
                            ) : (
                                <CountUp to={figure.value} />
                            )}
                        </dt>
                        <dd className="text-fg-tertiary m-0 max-w-[220px] text-sm leading-[1.55]">{t(figure.key)}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}
