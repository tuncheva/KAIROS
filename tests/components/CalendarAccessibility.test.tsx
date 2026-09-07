import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The five findings that stopped a task outright, asserted as behaviour.
 *
 * These are deliberately not snapshot or style tests. Every one of them was a
 * defect you could not see in a screenshot — an item reachable by nothing, a
 * grid with no way in, a popover with no way out, a dialog that never handed
 * focus over, and a detail view with nothing to press. A picture of the
 * calendar looked fine throughout.
 */

/** Mutation calls, by tRPC path, so a test can assert what the panel sent. */
const calls: { path: string; vars: unknown }[] = [];
let calendarData: unknown = { tasks: [], events: [], notes: [] };

vi.mock("~/trpc/react", () => {
  const query = (data: unknown) => ({
    useQuery: () => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  });

  const mutation = (path: string) => ({
    useMutation: (opts?: { onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void }) => ({
      mutate: vi.fn((vars: unknown) => {
        calls.push({ path, vars });
        opts?.onSuccess?.({});
      }),
      mutateAsync: vi.fn(async () => ({})),
      isPending: false,
      isError: false,
      error: null,
    }),
  });

  const invalidateProxy = (): unknown =>
    new Proxy(() => Promise.resolve(), {
      get: () => invalidateProxy(),
      apply: () => Promise.resolve(),
    });

  return {
    api: new Proxy(
      {},
      {
        get: (_t, router: string) => {
          if (router === "useUtils") {
            return () => new Proxy({}, { get: () => invalidateProxy() });
          }
          return new Proxy(
            {},
            {
              get: (_t2, procedure: string) => {
                const path = `${router}.${procedure}`;
                if (path === "calendar.getForRange") return query(calendarData);
                if (path === "project.getMyProjects") return query([]);
                return { ...query(null), ...mutation(path) };
              },
            },
          );
        },
      },
    ),
  };
});

// Imported after the mock so the component picks it up.
const { CalendarClient } = await import("~/components/calendar/CalendarClient");

/* Fixtures hang off the real clock rather than a frozen one, so they always
   land inside whatever period the calendar opens on. */
const now = new Date();
const at = (hour: number, minute = 0) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);

function task(id: number, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    status: "pending",
    priority: "medium",
    dueDate: at(9 + id),
    projectId: 3,
    projectTitle: "Autumn Showcase",
    ...extra,
  };
}

const FIVE_ON_TODAY = {
  tasks: [
    task(1, "Sign the vendor contract"),
    task(2, "Update the run sheet"),
    task(3, "Brief the crew"),
    task(4, "Chase the invoice"),
  ],
  events: [
    {
      id: 9,
      title: "Vendor walkthrough",
      eventDate: at(8),
      endsAt: at(10),
      description: "Site visit",
    },
  ],
  notes: [],
};

const monthUrl = () => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `/calendar?view=month&date=${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

beforeEach(() => {
  calls.length = 0;
  calendarData = { tasks: [], events: [], notes: [] };
  window.history.replaceState(null, "", "/calendar");
});

describe("every item is reachable", () => {
  it("opens the items a month cell could not show, which used to be a dead end", async () => {
    const user = userEvent.setup();
    calendarData = FIVE_ON_TODAY;
    window.history.replaceState(null, "", monthUrl());

    render(<CalendarClient />);

    /* The overflow used to be a plain <span> reading "+2 more". Finding it by
       role is the assertion: if it is not a button, this fails. */
    const more = await screen.findByRole("button", { name: /\+2 more/i });
    await user.click(more);

    const peek = await screen.findByRole("dialog");
    // All five, including the two the cell had no room for.
    expect(within(peek).getByRole("button", { name: /Sign the vendor contract/i })).toBeTruthy();
    expect(within(peek).getByRole("button", { name: /Chase the invoice/i })).toBeTruthy();
    expect(within(peek).getByRole("button", { name: /Vendor walkthrough/i })).toBeTruthy();
  });

  it("opens an item from the peek into the detail panel", async () => {
    const user = userEvent.setup();
    calendarData = FIVE_ON_TODAY;
    window.history.replaceState(null, "", monthUrl());

    render(<CalendarClient />);
    await user.click(await screen.findByRole("button", { name: /\+2 more/i }));
    const peek = await screen.findByRole("dialog");
    await user.click(within(peek).getByRole("button", { name: /Chase the invoice/i }));

    // The panel is named by its heading, which is the item's kind.
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /task/i })).toBeTruthy();
    });
    expect(screen.getByText("Chase the invoice")).toBeTruthy();
  });
});

describe("the grid has a keyboard model", () => {
  it("is a grid with exactly one tab stop", async () => {
    calendarData = FIVE_ON_TODAY;
    window.history.replaceState(null, "", monthUrl());

    render(<CalendarClient />);

    const grid = await screen.findByRole("grid");
    const cells = within(grid).getAllByRole("gridcell");
    expect(cells).toHaveLength(42);

    /* One tab stop for the whole month. Every item chip and every per-cell
       add button used to be individually tabbable, so a busy month was
       eighty-plus stops in DOM order with no way past them. */
    const tabbable = cells.filter((cell) => cell.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
  });

  it("moves the focused day with the arrow keys", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", monthUrl());

    render(<CalendarClient />);
    const grid = await screen.findByRole("grid");

    const startIndex = within(grid)
      .getAllByRole("gridcell")
      .findIndex((cell) => cell.getAttribute("tabindex") === "0");
    expect(startIndex).toBeGreaterThanOrEqual(0);

    within(grid).getAllByRole("gridcell")[startIndex]!.focus();
    await user.keyboard("{ArrowRight}");

    await waitFor(() => {
      const next = within(grid)
        .getAllByRole("gridcell")
        .findIndex((cell) => cell.getAttribute("tabindex") === "0");
      expect(next).toBe(startIndex + 1);
    });

    // Down moves a week, not a day.
    await user.keyboard("{ArrowDown}");
    await waitFor(() => {
      const next = within(grid)
        .getAllByRole("gridcell")
        .findIndex((cell) => cell.getAttribute("tabindex") === "0");
      expect(next).toBe(startIndex + 8);
    });
  });

  it("names each day cell with its date and how much is on it", async () => {
    calendarData = FIVE_ON_TODAY;
    window.history.replaceState(null, "", monthUrl());

    render(<CalendarClient />);
    const grid = await screen.findByRole("grid");

    // An item read aloud used to carry no day at all.
    expect(within(grid).getAllByRole("gridcell", { name: /5 items/i }).length).toBe(1);
  });
});

describe("dismissible surfaces can be dismissed", () => {
  it("closes the filter popover with Escape and gives focus back to its trigger", async () => {
    const user = userEvent.setup();
    render(<CalendarClient />);

    const trigger = await screen.findByRole("button", { name: /^filters/i });
    await user.click(trigger);

    const popover = await screen.findByRole("dialog", { name: /filters/i });
    expect(popover).toBeTruthy();

    /* The popover only ever closed on an outside mousedown. A keyboard user
       who opened it could tab onward but never dismiss it. */
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /filters/i })).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it("does not make the drawer scrim a focusable button", async () => {
    const user = userEvent.setup();
    render(<CalendarClient />);

    await user.click(await screen.findByRole("button", { name: /^new$/i }));
    await screen.findByRole("dialog", { name: /new item/i });

    /* The scrim was a <button aria-label="Close">, so it became the panel's
       first tab stop and announced a second Close that duplicated the
       header's. Exactly one Close control should exist. */
    expect(screen.getAllByRole("button", { name: /^close$/i })).toHaveLength(1);
  });

  it("moves focus into the drawer when it opens", async () => {
    const user = userEvent.setup();
    render(<CalendarClient />);

    await user.click(await screen.findByRole("button", { name: /^new$/i }));
    const drawer = await screen.findByRole("dialog", { name: /new item/i });

    await waitFor(() => {
      expect(drawer.contains(document.activeElement)).toBe(true);
    });
  });
});

describe("the detail panel can act", () => {
  it("offers the actions the read-only panel never had", async () => {
    const user = userEvent.setup();
    calendarData = { tasks: [task(1, "Sign the vendor contract")], events: [], notes: [] };
    window.history.replaceState(null, "", monthUrl());

    render(<CalendarClient />);
    await user.click(await screen.findByRole("button", { name: /Sign the vendor contract/i }));

    const panel = await screen.findByRole("dialog", { name: /task/i });
    expect(within(panel).getByRole("button", { name: /^complete$/i })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /reschedule/i })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /^edit$/i })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /more actions/i })).toBeTruthy();
  });

  it("completes a task without leaving the calendar", async () => {
    const user = userEvent.setup();
    calendarData = { tasks: [task(1, "Sign the vendor contract")], events: [], notes: [] };
    window.history.replaceState(null, "", monthUrl());

    render(<CalendarClient />);
    await user.click(await screen.findByRole("button", { name: /Sign the vendor contract/i }));
    const panel = await screen.findByRole("dialog", { name: /task/i });
    await user.click(within(panel).getByRole("button", { name: /^complete$/i }));

    expect(calls).toEqual([
      { path: "task.updateStatus", vars: { taskId: 1, status: "completed" } },
    ]);
  });

  it("reschedules through the panel rather than another page", async () => {
    const user = userEvent.setup();
    calendarData = { tasks: [task(1, "Sign the vendor contract")], events: [], notes: [] };
    window.history.replaceState(null, "", monthUrl());

    render(<CalendarClient />);
    await user.click(await screen.findByRole("button", { name: /Sign the vendor contract/i }));
    const panel = await screen.findByRole("dialog", { name: /task/i });
    await user.click(within(panel).getByRole("button", { name: /reschedule/i }));

    const date = within(panel).getByLabelText(/^date$/i);
    await user.clear(date);
    await user.type(date, "2027-01-14");
    await user.click(within(panel).getByRole("button", { name: /save changes/i }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("task.update");
    const vars = calls[0]!.vars as { taskId: number; dueDate: Date };
    expect(vars.taskId).toBe(1);
    expect(vars.dueDate.getFullYear()).toBe(2027);
    expect(vars.dueDate.getMonth()).toBe(0);
    expect(vars.dueDate.getDate()).toBe(14);
  });
});

describe("the page says what it is showing", () => {
  it("reports the count in a live region", async () => {
    calendarData = FIVE_ON_TODAY;
    window.history.replaceState(null, "", monthUrl());

    render(<CalendarClient />);

    await waitFor(() => {
      const live = document.querySelector('[aria-live="polite"]');
      // Filtering used to rewrite the grid in total silence.
      expect(live?.textContent).toMatch(/5 items shown/i);
    });
  });

  it("names each hidden filter as something you can take off again", async () => {
    const user = userEvent.setup();
    calendarData = FIVE_ON_TODAY;
    window.history.replaceState(null, "", monthUrl());

    render(<CalendarClient />);

    await user.click(await screen.findByRole("button", { name: /^filters/i }));
    const popover = await screen.findByRole("dialog", { name: /filters/i });
    await user.click(within(popover).getByRole("checkbox", { name: /task/i }));
    await user.keyboard("{Escape}");

    const token = await screen.findByRole("button", { name: /task hidden/i });
    expect(token).toBeTruthy();

    // And the token undoes itself.
    await user.click(token);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /task hidden/i })).toBeNull();
    });
  });

  it("carries the filters in the URL, so a shared link keeps the lens", async () => {
    const user = userEvent.setup();
    calendarData = FIVE_ON_TODAY;
    window.history.replaceState(null, "", monthUrl());

    render(<CalendarClient />);

    await user.click(await screen.findByRole("button", { name: /^filters/i }));
    const popover = await screen.findByRole("dialog", { name: /filters/i });
    await user.click(within(popover).getByRole("checkbox", { name: /note/i }));

    await waitFor(() => {
      const kinds = new URLSearchParams(window.location.search).get("kinds");
      expect(kinds).toBeTruthy();
      expect(kinds).not.toContain("note");
    });
  });

  it("distinguishes the three kinds without relying on colour", async () => {
    calendarData = FIVE_ON_TODAY;
    window.history.replaceState(null, "", monthUrl());

    render(<CalendarClient />);

    /* Kind was carried by tint alone, which disappears in greyscale or when
       the user's accent collides with a priority hue. The accessible name
       spells it out, and a glyph carries it visually. */
    const event = await screen.findByRole("button", { name: /^event, Vendor walkthrough/i });
    expect(event).toBeTruthy();
    expect(event.textContent).toContain("●");
  });
});

describe("the time grid and the agenda", () => {
  it("draws an event to its real duration and offers empty hours as targets", async () => {
    calendarData = FIVE_ON_TODAY;
    window.history.replaceState(null, "", "/calendar?view=week");

    render(<CalendarClient />);

    const grid = await screen.findByRole("grid");

    /* Every timed item used to be laid out at a constant hour regardless of
       duration. This event runs 08:00–10:00, so its block is two rows tall. */
    const block = within(grid).getByRole("button", { name: /^event, Vendor walkthrough/i });
    expect(block.style.height).toBe("110px");

    // Clicking an hour used to do nothing at all.
    expect(within(grid).getAllByRole("button", { name: /^add at \d\d:00 on /i }).length)
      .toBeGreaterThan(0);
  });

  it("says when an event's end is not recorded instead of inventing one", async () => {
    calendarData = {
      tasks: [],
      events: [
        { id: 9, title: "Open day", eventDate: at(11), endsAt: null, description: "d" },
      ],
      notes: [],
    };
    window.history.replaceState(null, "", "/calendar?view=week");

    render(<CalendarClient />);
    const grid = await screen.findByRole("grid");
    const block = within(grid).getByRole("button", { name: /^event, Open day/i });

    // Drawn at an hour, but with an open lower edge rather than a solid one.
    expect(block.style.height).toBe("54px");
    expect(block.style.borderBottomStyle).toBe("dashed");
  });

  it("keeps the day headers and the hour columns in one scroll container", async () => {
    calendarData = FIVE_ON_TODAY;
    window.history.replaceState(null, "", "/calendar?view=week");

    render(<CalendarClient />);
    const grid = await screen.findByRole("grid");

    /* The alignment invariant, as DOM ancestry rather than pixels.

       The headers used to sit outside the scrolling hour area, so only the
       hour area carried the vertical scrollbar — ~15px taken out of its
       content box. Its seven flex-1 columns were each ~2px narrower than the
       seven header cells above them, and the gridlines drifted further left
       with every column: 13px out by Sunday, which read as the last day being
       wider than the rest. Sharing one scroller makes the widths equal by
       construction; if a refactor pulls them apart again, this fails. */
    const header = within(grid).getAllByRole("columnheader")[0]!;
    const column = within(grid).getAllByRole("gridcell")[0]!;

    const scrollerOf = (el: HTMLElement) => el.closest(".kairos-scroll-area");
    expect(scrollerOf(header)).not.toBeNull();
    expect(scrollerOf(header)).toBe(scrollerOf(column));
  });

  it("does not leak its own source comments into the page", async () => {
    calendarData = FIVE_ON_TODAY;
    window.history.replaceState(null, "", "/calendar?view=week");

    render(<CalendarClient />);
    const grid = await screen.findByRole("grid");

    // A bare /* */ inside JSX is valid TypeScript and renders as text.
    expect(grid.textContent).not.toMatch(/One scroller|all-day strip stuck/i);
  });

  it("lists the period as an agenda when asked, with no horizontal scroll", async () => {
    const user = userEvent.setup();
    calendarData = FIVE_ON_TODAY;
    window.history.replaceState(null, "", "/calendar?view=week");

    render(<CalendarClient />);
    await user.click(await screen.findByRole("button", { name: /grid and agenda/i }));

    const list = await screen.findByRole("list", { name: /agenda/i });
    expect(within(list).getByRole("button", { name: /^event, Vendor walkthrough/i })).toBeTruthy();
    expect(within(list).getByRole("button", { name: /Chase the invoice/i })).toBeTruthy();
    // A list, not a 760px-wide grid the phone has to pan.
    expect(screen.queryByRole("grid")).toBeNull();
  });
});

describe("empty and filtered-empty are different things", () => {
  it("says the period is empty when it is", async () => {
    window.history.replaceState(null, "", monthUrl());
    render(<CalendarClient />);
    expect(await screen.findByText(/this period is empty/i)).toBeTruthy();
  });

  it("says the filters are hiding things when they are, and offers the way out", async () => {
    const user = userEvent.setup();
    calendarData = FIVE_ON_TODAY;
    window.history.replaceState(null, "", monthUrl());

    render(<CalendarClient />);
    await user.click(await screen.findByRole("button", { name: /^filters/i }));
    const popover = await screen.findByRole("dialog", { name: /filters/i });
    await user.click(within(popover).getByRole("checkbox", { name: /task/i }));
    await user.click(within(popover).getByRole("checkbox", { name: /event/i }));
    await user.keyboard("{Escape}");

    /* These two cases used to render identically — an empty grid — which is
       the version people read as "the calendar is broken". */
    expect(await screen.findByText(/filters are hiding everything/i)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /clear all/i }).length).toBeGreaterThan(0);
  });
});

describe("keyboard shortcuts", () => {
  it("opens the shortcut sheet with ? and closes it with Escape", async () => {
    const user = userEvent.setup();
    render(<CalendarClient />);
    await screen.findByRole("grid").catch(() => null);

    await user.keyboard("?");
    const sheet = await screen.findByRole("dialog", { name: /keyboard shortcuts/i });
    expect(sheet).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /keyboard shortcuts/i })).toBeNull();
    });
  });

  it("does not fire a shortcut while you are typing in a field", async () => {
    const user = userEvent.setup();
    render(<CalendarClient />);

    const search = await screen.findByRole("textbox", { name: /search/i });
    await user.click(search);
    await user.type(search, "not?today");

    expect(screen.queryByRole("dialog", { name: /keyboard shortcuts/i })).toBeNull();
    expect((search as HTMLInputElement).value).toBe("not?today");
  });
});
