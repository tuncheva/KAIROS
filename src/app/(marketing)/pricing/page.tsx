import Link from "next/link";

import { PricingTable } from "~/components/marketing/PricingTable";
import { ArrowLeft } from "~/components/ui/icons.server";
import { auth } from "~/server/auth";

export const metadata = {
  title: "Pricing · KAIROS",
  description:
    "Free gives you the whole assistant when you ask. Pro makes it work while you do not.",
};

/**
 * The public pricing page.
 *
 * Not built on `StaticPage`, which is a shell for single-paragraph stubs. This
 * one has three columns and a live price toggle.
 *
 * The session is read here so the table can point its buttons somewhere that
 * works: a signed-out visitor needs sign-in, a signed-in one needs the billing
 * screen. That is the only reason this is a server component — the prices
 * themselves are static, and deliberately not personalised.
 */
export default async function PricingPage() {
  const session = await auth();

  return (
    <main
      id="main-content"
      className="min-h-dvh bg-bg-primary px-6 py-24 text-fg-primary lg:px-12"
    >
      <div className="mx-auto w-full max-w-[1120px]">
        <Link
          href="/"
          className="k-nav inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-tertiary"
        >
          <ArrowLeft size={14} />
          Back home
        </Link>

        <h1 className="mt-10 max-w-[18ch] font-display text-[clamp(2.5rem,6vw,4rem)] leading-[1.05] font-normal">
          Sell anticipation, not allowance
        </h1>

        <p className="mt-6 max-w-[62ch] text-[19px] leading-[1.7] text-fg-secondary">
          Five agents answer when you speak to them, and every plan includes all
          of them. Two more — the Daily Brief and the Risk Radar — run on a
          schedule with no one in the loop. That is the line: Free gives you the
          whole tool, paid plans give you the thing that works while you sleep.
        </p>

        <div className="my-12 h-px bg-border-light" />

        <PricingTable signedIn={Boolean(session?.user)} />
      </div>
    </main>
  );
}
