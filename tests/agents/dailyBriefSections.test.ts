/**
 * Hemera's "What to include": the brief covers only the sections the user kept,
 * and a morning whose only news is in a dropped section stays quiet.
 */

import { describe, expect, it } from "vitest";

import {
  briefIsEmpty,
  fallbackBrief,
  narrowBriefToSections,
  type BriefFacts,
} from "~/server/llm/scheduled/dailyBrief";
import type { Finding } from "~/server/llm/scheduled/riskRadar";

const facts: BriefFacts = {
  dueToday: [{ id: 1, title: "Ship invoices", projectTitle: "Billing" }],
  overdue: 2,
  completedYesterday: 4,
  eventsToday: [{ id: 9, title: "Launch party" }],
  openFindings: 1,
};

const findings: Finding[] = [
  {
    kind: "stalled_project",
    severity: "warning",
    projectId: 3,
    title: "Alpha hasn't moved in 14 days",
    detail: "",
    fingerprint: "stalled:3",
    taskIds: [],
  },
];

describe("narrowBriefToSections", () => {
  it("keeps everything when every section is on", () => {
    expect(narrowBriefToSections(facts, findings, ["dueToday", "events", "risks"])).toEqual({
      facts,
      findings,
    });
  });

  it("drops due and overdue work together", () => {
    const { facts: out } = narrowBriefToSections(facts, findings, ["events", "risks"]);
    expect(out.dueToday).toEqual([]);
    expect(out.overdue).toBe(0);
    expect(out.eventsToday).toHaveLength(1);
  });

  it("keeps risks out of the message without touching the rest", () => {
    const out = narrowBriefToSections(facts, findings, ["dueToday", "events"]);
    expect(out.findings).toEqual([]);
    expect(out.facts.openFindings).toBe(0);
    expect(fallbackBrief(out.facts, out.findings)).not.toContain("Alpha");
    expect(fallbackBrief(out.facts, out.findings)).toContain("Ship invoices");
  });

  it("stays quiet when the only news is in a section that is off", () => {
    const eventsOnly: BriefFacts = { ...facts, dueToday: [], overdue: 0, openFindings: 0 };
    const out = narrowBriefToSections(eventsOnly, [], ["dueToday", "risks"]);
    expect(briefIsEmpty(out.facts, out.findings)).toBe(true);
  });
});
