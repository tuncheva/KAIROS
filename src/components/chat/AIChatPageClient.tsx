"use client";

import { useSearchParams } from "next/navigation";

import { ProjectIntelligenceChat } from "~/components/projects/ProjectIntelligenceChat";

/**
 * The full-page assistant.
 *
 * Reads `?prefill=` so the command palette (D-2) and the "fix this" buttons on
 * risk findings (B-3) can hand a message straight to the chat. Acting on a nudge
 * should cost one click, not a retype of the problem the assistant just
 * reported — but it still arrives as a normal turn, so a write still goes
 * through draft → confirm → apply.
 */
export function AIChatPageClient() {
  const searchParams = useSearchParams();
  const prefill = searchParams.get("prefill") ?? undefined;

  return (
    <div className="h-full w-full">
      {/*
        A full page is where a thread accumulates, so it carries the
        delete-and-start-over control. The compact floating widget does not.
      */}
      <ProjectIntelligenceChat prefill={prefill} showNewChat />
    </div>
  );
}
