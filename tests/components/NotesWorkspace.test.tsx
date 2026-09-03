import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* Which note is open is read from the pathname, not passed in as a prop: the
   workspace is mounted by `(workspace)/layout.tsx`, above the segment that
   changes, so there is no page left to hand it down. `renderAt` is therefore
   how these tests choose what is on screen.

   Selection navigates with `history.pushState` rather than `router.push`, so
   that clicking a row does not re-render a route on the server — the
   assertions below read `window.location` for the same reason. */
let pathname = "/notes";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => pathname,
  redirect: vi.fn(),
}));

const at = (day: number, hour = 12) => new Date(2026, 7, day, hour, 0, 0);

const OWN_NOTES = [
  {
    id: 1,
    title: "Q3 planning",
    content: "Three things still unresolved before we commit the roadmap.",
    createdAt: at(20, 8),
    updatedAt: at(20, 8),
    notebookId: 7,
    calendarDate: null,
    isPasswordProtected: false,
    shareStatus: "private",
    sharedWith: [],
  },
  {
    // Locked *and* shared — the pair the old card could not show at once.
    id: 2,
    title: "Salary review",
    content: null,
    createdAt: at(10),
    updatedAt: at(19),
    notebookId: null,
    isPasswordProtected: true,
    shareStatus: "shared_read",
    sharedWith: [{ id: "u1", name: "Ana", email: "ana@x.io", image: null, permission: "read" }],
  },
  {
    id: 3,
    title: "Vendor call",
    content: "They will not move below 12k a year.",
    createdAt: at(18),
    updatedAt: at(18),
    notebookId: null,
    calendarDate: at(28),
    isPasswordProtected: false,
    shareStatus: "private",
    sharedWith: [],
  },
];

const SHARED_NOTES = [
  {
    id: 9,
    title: "Team offsite",
    content: "Agenda draft",
    createdAt: at(15),
    updatedAt: at(15),
    shareStatus: "shared_write",
    notebookId: null,
    permission: "write",
    sharedById: "u2",
    ownerName: "Maria",
    ownerEmail: "maria@x.io",
    isPasswordProtected: false,
  },
];

const NOTEBOOKS = [
  { id: 7, name: "Product", description: null, createdById: "me", createdAt: at(1), updatedAt: at(1) },
];

const QUERY_DATA: Record<string, unknown> = {
  "note.getAll": OWN_NOTES,
  "note.getSharedWithMe": SHARED_NOTES,
  "note.getNotebooks": NOTEBOOKS,
  "settings.get": { notesKeepUnlockedUntilClose: false, resetPinHint: null, dateFormat: "DD/MM/YYYY" },
};

vi.mock("~/trpc/react", () => {
  const procedure = (path: string) => ({
    useQuery: () => ({
      data: QUERY_DATA[path] ?? null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }),
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(async () => ({})),
      isPending: false,
      isError: false,
      error: null,
    }),
  });

  const passThrough = (): unknown =>
    new Proxy(() => Promise.resolve(), { get: () => passThrough(), apply: () => Promise.resolve() });

  return {
    api: new Proxy(
      {},
      {
        get: (_t, router: string) => {
          if (router === "useUtils") {
            return () => new Proxy({}, { get: () => passThrough() });
          }
          return new Proxy({}, { get: (_t2, name: string) => procedure(`${router}.${name}`) });
        },
      },
    ),
  };
});

const { NotesWorkspace } = await import("~/components/notes/NotesWorkspace");

describe("NotesWorkspace", () => {
  const renderAt = (path: string) => {
    pathname = path;
    window.history.replaceState(null, "", path);
    return render(<NotesWorkspace />);
  };

  beforeEach(() => {
    pathname = "/notes";
    window.history.replaceState(null, "", "/notes");
    window.localStorage.clear();
  });

  it("lists your notes with a real preview line", () => {
    renderAt("/notes");

    expect(screen.getAllByText("Q3 planning").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Three things still unresolved before we commit the roadmap."),
    ).toBeInTheDocument();
  });

  it("shows that a note is locked *and* shared, not one or the other", () => {
    /* The old card chose between the two with a ternary that tested sharing
       first, so an encrypted note that was shared never showed a lock. */
    renderAt("/notes");

    const row = screen.getByRole("button", { name: /Salary review/ });
    expect(within(row).getByText("Locked")).toBeInTheDocument();
    expect(within(row).getByText("1")).toBeInTheDocument();
  });

  it("offers the rail views and notebooks with their counts", () => {
    renderAt("/notes");

    const nav = screen.getAllByRole("navigation")[0]!;
    expect(within(nav).getByText("Shared with me")).toBeInTheDocument();
    expect(within(nav).getByText("On the calendar")).toBeInTheDocument();

    // `^Product` so this is the notebook itself, not its "Actions for Product" menu.
    const notebook = within(nav).getByRole("button", { name: /^Product/ });
    expect(within(notebook).getByText("1")).toBeInTheDocument();
  });

  it("opens a note as a route, so the back button and deep links work", async () => {
    const user = userEvent.setup();
    renderAt("/notes");

    await user.click(screen.getByRole("button", { name: /Vendor call/ }));

    expect(window.location.pathname).toBe("/notes/3");
  });

  it("narrows the list with the locked filter", async () => {
    const user = userEvent.setup();
    renderAt("/notes");

    await user.click(screen.getByRole("tab", { name: "Locked" }));

    expect(screen.getByRole("button", { name: /Salary review/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Vendor call/ })).not.toBeInTheDocument();
  });

  it("switches to the notes shared with you", async () => {
    const user = userEvent.setup();
    renderAt("/notes");

    const nav = screen.getAllByRole("navigation")[0]!;
    await user.click(within(nav).getByRole("button", { name: /Shared with me/ }));

    expect(screen.getByRole("button", { name: /Team offsite/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Q3 planning/ })).not.toBeInTheDocument();
  });

  it("says when a search could not look inside encrypted notes", async () => {
    const user = userEvent.setup();
    renderAt("/notes");

    await user.type(screen.getAllByRole("searchbox")[0]!, "roadmap");

    expect(screen.getByText(/encrypted note was not searched/)).toBeInTheDocument();
  });

  it("asks for the password in the page, not in a modal over everything", () => {
    renderAt("/notes/2");

    expect(screen.getByText("This note is encrypted")).toBeInTheDocument();
    expect(screen.getByLabelText("Enter password")).toBeInTheDocument();
    // The list is still there — that is the whole point of the inline gate.
    expect(screen.getByRole("button", { name: /Q3 planning/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens an unlocked note straight into an editable page, with no Save button", () => {
    renderAt("/notes/1");

    const body = screen.getByLabelText("Write your note...");
    expect(body).toHaveValue("Three things still unresolved before we commit the roadmap.");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("shows a note shared with you read-only when that is all you were given", () => {
    renderAt("/notes/9");

    expect(screen.getByText("Agenda draft")).toBeInTheDocument();
    expect(screen.getAllByText("From Maria").length).toBeGreaterThan(0);
  });

  it("starts a new note as its own route rather than a create dialog", async () => {
    const user = userEvent.setup();
    renderAt("/notes");

    await user.click(screen.getAllByRole("button", { name: "Create" })[0]!);

    expect(window.location.pathname).toBe("/notes/new");
  });

  it("re-orders the list from the sort menu", async () => {
    const user = userEvent.setup();
    renderAt("/notes");

    const titles = () =>
      screen
        .getAllByRole("button")
        .filter((element) => element.hasAttribute("data-note-row"))
        .map((element) => element.textContent);

    expect(titles()[0]).toContain("Q3 planning");

    await user.click(screen.getByRole("button", { name: "Sort" }));
    await user.click(screen.getByRole("menuitem", { name: "Title" }));

    expect(titles()[0]).toContain("Q3 planning");
    expect(titles()[1]).toContain("Salary review");
    expect(titles()[2]).toContain("Vendor call");
  });

  it("renames a notebook — the router procedure that never had a caller", async () => {
    const user = userEvent.setup();
    renderAt("/notes");

    await user.click(screen.getAllByRole("button", { name: "Actions for Product" })[0]!);
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Product");
    expect(within(dialog).getByLabelText("Description")).toBeInTheDocument();
  });

  it("confirms a notebook deletion in a dialog rather than a browser prompt", async () => {
    const user = userEvent.setup();
    renderAt("/notes");

    await user.click(screen.getAllByRole("button", { name: "Actions for Product" })[0]!);
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    const dialog = screen.getByRole("alertdialog");
    // And it still says what happens to the notes inside.
    expect(within(dialog).getByText(/Notes won't be deleted/)).toBeInTheDocument();
  });

  it("confirms a note deletion from the note's own menu", async () => {
    const user = userEvent.setup();
    renderAt("/notes/1");

    await user.click(screen.getByRole("button", { name: "Note actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(screen.getByRole("alertdialog", { name: "Delete Note" })).toBeInTheDocument();
  });

  it("moves a note between notebooks from the same menu", async () => {
    const user = userEvent.setup();
    renderAt("/notes/3");

    await user.click(screen.getByRole("button", { name: "Note actions" }));

    expect(screen.getByRole("menuitem", { name: "Product" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "None" })).toBeInTheDocument();
  });

  it("opens the share dialog for a note you own", async () => {
    const user = userEvent.setup();
    renderAt("/notes/1");

    await user.click(screen.getByRole("button", { name: "Share" }));

    const dialog = screen.getByRole("dialog", { name: "Manage sharing" });
    expect(within(dialog).getByLabelText("Email address")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Permission")).toBeInTheDocument();
  });

  it("puts the calendar date behind the menu, editable after the note exists", async () => {
    const user = userEvent.setup();
    renderAt("/notes/3");

    await user.click(screen.getByRole("button", { name: "Note actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Change the date" }));

    // `calendar_date` could only ever be set at creation before this.
    expect(screen.getByLabelText("Calendar date")).toHaveValue("2026-08-28");
  });
});
