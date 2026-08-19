import { describe, expect, it } from "vitest";

/**
 * Shape of the calendar items this filter operates on. Previously typed `any[]`,
 * which produced 20 lint errors and gave the test no protection against the
 * production shape drifting away from it.
 */
interface CalendarItem {
  kind: string;
  id: number;
  title: string;
  status?: string;
  priority?: string;
  projectTitle?: string | null;
  description?: string | null;
}

function filterItems(items: CalendarItem[], filters: {
  q: string;
  types: Set<string>;
  taskStatuses: Set<string>;
  priorities: Set<string>;
}) {
  const q = filters.q.trim().toLowerCase();
  return items.filter((item) => {
    if (!filters.types.has(item.kind)) return false;
    if (item.kind === "task") {
      if (!filters.taskStatuses.has(item.status ?? "")) return false;
      if (!filters.priorities.has(item.priority ?? "")) return false;
    }
    if (q.length > 0) {
      const hay = (
        item.kind === "task"
          ? `${item.title} ${item.projectTitle ?? ""}`
          : item.kind === "event"
            ? `${item.title} ${item.description ?? ""}`
            : `${item.title}`
      ).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

describe("Calendar filtering", () => {
  function startOfDayLocal(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  }
  function endOfDayLocal(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  }
  function startOfWeekMondayLocal(d: Date) {
    const x = startOfDayLocal(d);
    const mondayIndex = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - mondayIndex);
    return x;
  }
  function endOfWeekMondayLocal(d: Date) {
    const x = startOfWeekMondayLocal(d);
    x.setDate(x.getDate() + 6);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  function getPresetRange(now: Date, preset: "today" | "yesterday" | "tomorrow" | "this_week" | "last_week") {
    switch (preset) {
      case "today":
        return { from: startOfDayLocal(now), to: endOfDayLocal(now) };
      case "yesterday": {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        return { from: startOfDayLocal(d), to: endOfDayLocal(d) };
      }
      case "tomorrow": {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        return { from: startOfDayLocal(d), to: endOfDayLocal(d) };
      }
      case "this_week":
        return { from: startOfWeekMondayLocal(now), to: endOfWeekMondayLocal(now) };
      case "last_week": {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        return { from: startOfWeekMondayLocal(d), to: endOfWeekMondayLocal(d) };
      }
    }
  }

  it("computes local date preset boundaries (week starts Monday)", () => {
    // Wed, 2026-04-08
    const now = new Date(2026, 3, 8, 12, 0, 0, 0);

    const today = getPresetRange(now, "today");
    expect(today.from.getHours()).toBe(0);
    expect(today.to.getHours()).toBe(23);
    expect(today.from.getDay()).toBe(3); // Wed

    const thisWeek = getPresetRange(now, "this_week");
    expect(thisWeek.from.getDay()).toBe(1); // Mon
    expect(thisWeek.to.getDay()).toBe(0); // Sun

    const lastWeek = getPresetRange(now, "last_week");
    const delta = thisWeek.from.getTime() - lastWeek.from.getTime();
    expect(delta).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("filters by type and status/priority", () => {
    const items = [
      { kind: "task", id: 1, title: "A", status: "pending", priority: "high", projectTitle: "P" },
      { kind: "task", id: 2, title: "B", status: "completed", priority: "low", projectTitle: null },
      { kind: "event", id: 3, title: "Launch", description: "" },
      { kind: "note", id: 4, title: "Idea" },
    ];

    const filtered = filterItems(items, {
      q: "",
      types: new Set(["task", "note"]),
      taskStatuses: new Set(["pending"]),
      priorities: new Set(["high"]),
    });

    expect(filtered.map((i) => i.id)).toEqual([1, 4]);
  });

  it("filters by search across kinds", () => {
    const items = [
      { kind: "task", id: 1, title: "Write docs", status: "pending", priority: "high", projectTitle: "Kairos" },
      { kind: "event", id: 2, title: "Demo", description: "Kairos showcase" },
      { kind: "note", id: 3, title: "Random" },
    ];

    const filtered = filterItems(items, {
      q: "kairos",
      types: new Set(["task", "event", "note"]),
      taskStatuses: new Set(["pending", "in_progress", "blocked", "completed"]),
      priorities: new Set(["urgent", "high", "medium", "low"]),
    });

    expect(filtered.map((i) => i.id)).toEqual([1, 2]);
  });
});
