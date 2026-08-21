import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

type MutationOptions = {
  onSuccess?: () => void;
  onError?: (error: { message: string }) => void;
};

const invalidateRoot = vi.fn(() => Promise.resolve());
const scopedInvalidate = vi.fn(() => Promise.resolve());
const captured = new Map<string, MutationOptions | undefined>();

const capture = (name: string) => (options?: MutationOptions) => {
  captured.set(name, options);
  return { mutate: vi.fn(), isPending: false };
};

// This file mocks `~/trpc/react` itself rather than leaning on the shared mock
// in tests/setup.tsx: the shared one never runs a mutation's callbacks, and the
// callbacks are the entire behaviour under test here.
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      // The root `invalidate()` — what the hooks must call. The per-procedure
      // helpers are here so a regression that goes back to invalidating only
      // the workspace-name queries shows up as `invalidateRoot` never firing.
      invalidate: invalidateRoot,
      organization: {
        getActive: { invalidate: scopedInvalidate },
        listMine: { invalidate: scopedInvalidate },
      },
      user: { getProfile: { invalidate: scopedInvalidate } },
    }),
    organization: {
      setActive: { useMutation: capture("setActive") },
    },
    user: {
      setPersonalMode: { useMutation: capture("setPersonalMode") },
    },
  },
}));

const { useSwitchOrganization, useSwitchToPersonal } = await import(
  "~/hooks/useSwitchOrganization"
);

/** Each hook, paired with the procedure it drives. */
const switchers = [
  { name: "useSwitchOrganization", hook: useSwitchOrganization, procedure: "setActive" },
  { name: "useSwitchToPersonal", hook: useSwitchToPersonal, procedure: "setPersonalMode" },
] as const;

describe.each(switchers)("$name", ({ hook, procedure }) => {
  beforeEach(() => {
    invalidateRoot.mockClear();
    scopedInvalidate.mockClear();
    captured.clear();
  });

  it("invalidates the whole tRPC cache once the switch commits", () => {
    renderHook(() => hook());

    captured.get(procedure)?.onSuccess?.();

    // Workspace-scoped queries carry no workspace in their key — the server
    // reads the active workspace off the user row — so anything short of a full
    // invalidate leaves projects, tasks and members rendering the previous one.
    expect(invalidateRoot).toHaveBeenCalledTimes(1);
    expect(invalidateRoot).toHaveBeenCalledWith();
  });

  it("reports the switch before the refetches land", () => {
    const onSwitched = vi.fn();
    renderHook(() => hook({ onSwitched }));

    captured.get(procedure)?.onSuccess?.();

    expect(onSwitched).toHaveBeenCalledTimes(1);
  });

  it("surfaces a rejected switch instead of failing silently", () => {
    const onError = vi.fn();
    renderHook(() => hook({ onError }));

    captured.get(procedure)?.onError?.({ message: "nope" });

    expect(onError).toHaveBeenCalledWith("nope");
    expect(invalidateRoot).not.toHaveBeenCalled();
  });
});
