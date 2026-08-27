import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";

import { AiInsightsPanel } from "~/components/dashboard/AiInsightsPanel";
import { DashboardClient } from "~/components/dashboard/DashboardClient";
import { TopBar } from "~/components/layout/TopBar";
import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/api/auth/signin");
  }

  const tNav = await getTranslations("nav");

  /*
   * Warm the cache on the server, so the page arrives with its data instead of
   * fetching it after hydration.
   *
   * Without this the sequence on every visit was: HTML, hydrate, *then* fire
   * the queries and show skeletons while a round trip completes. The server is
   * already talking to the database to resolve the session, so it is the
   * cheapest possible place to also ask for what the page is about to want.
   *
   * Deliberately not awaited. `HydrateClient` streams each result down as it
   * resolves, so the three run concurrently and none of them holds up the
   * shell; the client queries below them adopt whatever has landed and only
   * fetch what has not.
   *
   * `getForCalendar` is missing from this list on purpose: its input is a date
   * range built from `new Date()` in the client component, so a range computed
   * here would produce a different query key and prefetch into a cache entry
   * nothing ever reads.
   */
  void api.project.getMyProjects.prefetch();
  void api.note.getAll.prefetch();
  void api.task.getOrgActivity.prefetch({ limit: 6, scope: "all" });

  return (
    <HydrateClient>
    <div className="min-h-dvh bg-bg-primary">
      <div className="rail-offset min-h-dvh flex flex-col kairos-topbar-gap kairos-page-enter">
        <TopBar
          actions={
            <Link
              href="/projects?new=1"
              className="flex items-center gap-2 rounded-lg bg-accent-primary px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">{tNav("newProject")}</span>
            </Link>
          }
        />

        <main id="main-content" className="flex-1 w-full overflow-auto kairos-bottomnav-gap">
          <DashboardClient userName={session.user.name ?? null} />

          {/*
            B-2/B-3. Below the dashboard rather than above it: what the radar
            found is worth seeing, but it is not more important than the work the
            user came here to look at, and an alarm panel above the fold is how a
            dashboard starts feeling like a complaint.
          */}
          <div className="px-4 pb-8 sm:px-6 lg:px-8">
            <AiInsightsPanel />
          </div>
        </main>
      </div>
    </div>
    </HydrateClient>
  );
}
