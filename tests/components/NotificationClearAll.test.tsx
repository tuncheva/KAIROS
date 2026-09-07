import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Bringing `Clear all` back without bringing back the reason it was removed.
 *
 * `notification.deleteAll` had no caller. The panel's own comment records why:
 * emptying the list used to be the only bulk action, so destroying the history —
 * unread items included — was the quickest way to silence the badge. `Mark all
 * read` now owns that job.
 *
 * So these pin the guard rails, not just the wiring: the control only exists
 * when there is something to clear, it asks first, and it never becomes the
 * shortest path to a quiet bell.
 */

const clearAllMutate = vi.fn();

const ROWS = [
  {
    id: 1,
    type: "system",
    title: "Welcome aboard",
    message: "Your workspace is ready.",
    createdAt: new Date("2026-03-01T10:00:00Z"),
    read: false,
    link: null,
  },
];

let rows: unknown[] = ROWS;

vi.mock("~/trpc/react", () => {
  const invalidate = (): unknown =>
    new Proxy(() => Promise.resolve(), {
      get: () => invalidate(),
      apply: () => Promise.resolve(),
    });

  // A catch-all, like the global mock in tests/setup: the bell reaches for more
  // of the API than this file cares about, and an incomplete literal makes the
  // component fail to render rather than fail the assertion under test.
  const anyQuery = (data: unknown = null) => ({
    useQuery: () => ({ data, isLoading: false, error: null, refetch: vi.fn() }),
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  });

  const notification: Record<string, unknown> = {
    getAll: { useQuery: () => ({ data: rows, isLoading: false, error: null, refetch: vi.fn() }) },
    getUnreadCount: anyQuery(1),
    deleteAll: { useMutation: () => ({ mutate: clearAllMutate, isPending: false }) },
  };

  return {
    api: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "useUtils") {
            return () => new Proxy({}, { get: () => invalidate() });
          }
          if (prop === "notification") {
            return new Proxy(notification, {
              get: (target, key) =>
                key in target
                  ? (target as Record<string | symbol, unknown>)[key]
                  : anyQuery(),
            });
          }
          return new Proxy({}, { get: () => anyQuery() });
        },
      },
    ),
  };
});

const { NotificationSystem } = await import(
  "~/components/notifications/NotificationSystem"
);

async function openPanel() {
  const user = userEvent.setup();
  render(<NotificationSystem />);
  await user.click(screen.getByRole("button", { name: /^Notifications/ }));
  return user;
}

describe("clearing every notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows = ROWS;
  });

  it("offers no bulk delete when there is nothing to clear", async () => {
    rows = [];
    await openPanel();

    expect(
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();
  });

  it("keeps mark-all-read available beside it, so silencing the badge never requires deleting", async () => {
    await openPanel();

    expect(
      screen.getByRole("button", { name: "Mark all read" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear all" }),
    ).toBeInTheDocument();
  });

  it("asks before destroying anything", async () => {
    const user = await openPanel();

    await user.click(screen.getByRole("button", { name: "Clear all" }));

    // The dialog stands between the button and the delete.
    expect(clearAllMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Clear all notifications")).toBeInTheDocument();
    // And it says what is actually at stake.
    expect(
      screen.getByText(/including any you have not read/i),
    ).toBeInTheDocument();
  });

  it("clears only once the confirmation is taken", async () => {
    const user = await openPanel();

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    const dialogConfirm = screen
      .getAllByRole("button", { name: "Clear all" })
      .at(-1)!;
    await user.click(dialogConfirm);

    expect(clearAllMutate).toHaveBeenCalledTimes(1);
  });

  it("abandons the clear when the confirmation is declined", async () => {
    const user = await openPanel();

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // Dismissal is animated: `ConfirmDialog` plays its exit before calling back.
    await waitFor(() =>
      expect(
        screen.queryByText("Clear all notifications"),
      ).not.toBeInTheDocument(),
    );
    expect(clearAllMutate).not.toHaveBeenCalled();
  });
});
