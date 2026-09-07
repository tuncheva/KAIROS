import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MAX_PDF_SIZE } from "~/lib/pdf";

/**
 * The PDF route into task drafts.
 *
 * `agent.extractTasksFromPdf` was fully implemented server-side — orchestrator,
 * schema, router procedure, `pdfjs-dist` in the dependency list — and had no UI
 * at all, so no user could reach it. These cover the ingestion half: the size
 * guard, the base64 the procedure actually expects, and the fact that drafts
 * from a PDF land in the same review list as generated ones rather than in a
 * parallel flow of their own.
 */

const extractMutate = vi.fn();
const generateMutate = vi.fn();
const errorToast = vi.fn();

/** Captured so a test can drive the success path itself. */
let extractOnSuccess: ((data: unknown) => void) | undefined;

vi.mock("~/trpc/react", () => {
  const invalidate = (): unknown =>
    new Proxy(() => Promise.resolve(), {
      get: () => invalidate(),
      apply: () => Promise.resolve(),
    });

  return {
    api: {
      useUtils: () => new Proxy({}, { get: () => invalidate() }),
      task: {
        create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        update: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        updateStatus: {
          useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
        },
      },
      agent: {
        generateTaskDrafts: {
          useMutation: () => ({ mutate: generateMutate, isPending: false }),
        },
        extractTasksFromPdf: {
          useMutation: (opts?: { onSuccess?: (d: unknown) => void }) => {
            extractOnSuccess = opts?.onSuccess;
            return { mutate: extractMutate, isPending: false };
          },
        },
      },
    },
  };
});

vi.mock("~/components/providers/ToastProvider", () => ({
  useToast: () => ({ success: vi.fn(), error: errorToast, info: vi.fn() }),
}));

const { TaskDrawer } = await import("~/components/projects/TaskDrawer");

/**
 * A File whose `size` is forced.
 *
 * jsdom computes size from the blob parts, and allocating an 11 MB string to
 * test a limit is a slow way to say "too big".
 */
function pdfFile(name: string, size: number): File {
  const file = new File(["%PDF-1.4 fake"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function setup() {
  return render(
    <TaskDrawer open projectId={7} task={null} onClose={vi.fn()} members={[]} />,
  );
}

describe("TaskDrawer — extract tasks from a PDF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extractOnSuccess = undefined;
  });

  it("offers a PDF route beside the generator", () => {
    setup();
    expect(screen.getByText("Extract from PDF")).toBeInTheDocument();
    expect(screen.getByText("Suggest tasks")).toBeInTheDocument();
  });

  it("sends the file as base64 without the data-URL prefix", async () => {
    const user = userEvent.setup();
    setup();

    // The drawer renders through a portal, so the input is in document.body
    // rather than under the render container.
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept="application/pdf"]',
    )!;
    await user.upload(input, pdfFile("brief.pdf", 1024));

    await waitFor(() => expect(extractMutate).toHaveBeenCalledTimes(1));

    const arg = extractMutate.mock.calls[0]![0] as {
      projectId: number;
      pdfBase64: string;
      fileName: string;
    };
    expect(arg.projectId).toBe(7);
    expect(arg.fileName).toBe("brief.pdf");
    // The procedure wants the payload alone — a data: prefix is not valid base64
    // and the server would fail to decode it.
    expect(arg.pdfBase64).not.toContain("data:");
    expect(arg.pdfBase64).not.toContain(",");
    expect(arg.pdfBase64.length).toBeGreaterThan(0);
  });

  it("refuses an oversized PDF before spending the upload", async () => {
    const user = userEvent.setup();
    setup();

    // The drawer renders through a portal, so the input is in document.body
    // rather than under the render container.
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept="application/pdf"]',
    )!;
    await user.upload(input, pdfFile("huge.pdf", MAX_PDF_SIZE + 1));

    await waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1));
    expect(extractMutate).not.toHaveBeenCalled();
  });

  it("puts PDF drafts in the same review list as generated ones", async () => {
    setup();

    // Whatever the source, drafts are reviewed and accepted in one place.
    act(() => {
      extractOnSuccess?.({
        draftId: "d1",
        reasoning: "",
        projectTitle: "T",
        projectDescription: "",
        tasks: [
          {
            title: "Book the venue",
            description: "From page 2 of the brief",
            priority: "high",
            orderIndex: 0,
            estimatedDueDays: 3,
          },
        ],
      });
    });

    expect(await screen.findByText("Book the venue")).toBeInTheDocument();
    expect(screen.getByText("From page 2 of the brief")).toBeInTheDocument();
    expect(screen.getByText("Add all 1 tasks")).toBeInTheDocument();
  });
});
