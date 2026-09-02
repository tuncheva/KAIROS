import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

/* ────────────── Global mocks ────────────── */

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
}));

// Mock next/image
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // Strip next/image-only props that a plain <img> doesn't understand.
    const rest = { ...props };
    delete rest.fill;
    delete rest.priority;
    // `alt` first so a caller-supplied alt in `rest` still wins. Giving the mock
    // a default alt is better than suppressing the lint rule — and the previous
    // `jsx-a11y/alt-text` disable named a plugin this project doesn't install,
    // which made ESLint hard-error on the unknown rule.
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />;
  },
}));

// Mock next-intl
//
// This resolves keys against the real en.json rather than echoing the key back.
// Echoing meant components rendered "signIn.noAccount" while tests queried the
// English copy they were originally written against, so every text-based query
// failed. Resolving for real also means a test breaks if a translation key is
// deleted or renamed, which is the behaviour you want.
//
// Async factory so the JSON import happens inside it — vi.mock is hoisted, so a
// top-level import couldn't be referenced here.
vi.mock("next-intl", async () => {
  const messages = (
    (await import("../src/i18n/messages/en.json")) as {
      default: Record<string, unknown>;
    }
  ).default;

  /** Walk a dotted key path; returns undefined unless it lands on a string. */
  const resolve = (path: string): string | undefined => {
    let current: unknown = messages;
    for (const part of path.split(".")) {
      if (typeof current !== "object" || current === null) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return typeof current === "string" ? current : undefined;
  };

  /**
   * ICU plural and select blocks, chosen the way next-intl would.
   *
   * Substituting `{name}` alone was not enough: a message written
   * `{count, plural, one {# finding} other {# findings}}` came through with its
   * ICU source intact, so a test could only assert on that source — which meant
   * the copy a user reads was never actually checked. Braces nest, so the
   * argument is scanned rather than matched with a regex.
   */
  const selectBranch = (
    body: string,
    values: Record<string, unknown>,
    name: string,
    kind: string,
  ): string | undefined => {
    const branches = new Map<string, string>();
    let cursor = 0;
    while (cursor < body.length) {
      const open = body.indexOf("{", cursor);
      if (open === -1) break;
      const label = body.slice(cursor, open).trim();
      let depth = 0;
      let close = open;
      for (; close < body.length; close += 1) {
        if (body[close] === "{") depth += 1;
        else if (body[close] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      branches.set(label, body.slice(open + 1, close));
      cursor = close + 1;
    }

    const value = values[name];
    if (kind === "select") {
      return branches.get(String(value)) ?? branches.get("other");
    }

    const count = Number(value);
    const category = Number.isFinite(count)
      ? new Intl.PluralRules("en").select(count)
      : "other";
    const chosen =
      branches.get(`=${count}`) ?? branches.get(category) ?? branches.get("other");
    return chosen?.replaceAll("#", String(value));
  };

  const format = (message: string, values: Record<string, unknown>): string => {
    let out = "";
    let cursor = 0;

    while (cursor < message.length) {
      const open = message.indexOf("{", cursor);
      if (open === -1) {
        out += message.slice(cursor);
        break;
      }
      out += message.slice(cursor, open);

      let depth = 0;
      let close = open;
      for (; close < message.length; close += 1) {
        if (message[close] === "{") depth += 1;
        else if (message[close] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }

      const inner = message.slice(open + 1, close);
      const [name, kind, ...rest] = inner.split(",");
      const argument = (name ?? "").trim();

      if (kind && (kind.trim() === "plural" || kind.trim() === "select")) {
        const branch = selectBranch(rest.join(","), values, argument, kind.trim());
        out += branch === undefined ? `{${inner}}` : format(branch, values);
      } else if (argument in values) {
        out += String(values[argument]);
      } else {
        out += `{${inner}}`;
      }

      cursor = close + 1;
    }

    return out;
  };

  const useTranslations = (namespace?: string) => {
    const t = (key: string, values?: Record<string, unknown>) => {
      const namespaced = namespace ? `${namespace}.${key}` : key;
      // Fall back to the bare key, then to the literal string, so a missing
      // translation degrades to the old behaviour instead of throwing.
      const message = resolve(namespaced) ?? resolve(key) ?? namespaced;
      return format(message, values ?? {});
    };
    return t;
  };

  return {
    useTranslations,
    useLocale: () => "en",
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  signIn: vi.fn().mockResolvedValue({ ok: true }),
  signOut: vi.fn(),
  useSession: () => ({
    data: null,
    status: "unauthenticated",
  }),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock next-themes
vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    resolvedTheme: "dark",
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock tRPC
vi.mock("~/trpc/react", () => {
  const createMockQuery = (data: unknown = null) => ({
    useQuery: () => ({
      data,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
    useMutation: (opts?: {
      onMutate?: (vars: unknown) => void;
      onSuccess?: (data: unknown) => void;
      onError?: (error: unknown) => void;
    }) => ({
      mutate: vi.fn((vars: unknown) => {
        opts?.onMutate?.(vars);
      }),
      mutateAsync: vi.fn(async (vars: unknown) => {
        opts?.onMutate?.(vars);
        return {};
      }),
      isPending: false,
      isError: false,
      error: null,
    }),
  });

  const createInvalidateProxy = (): unknown =>
    new Proxy(() => Promise.resolve(), {
      get: () => createInvalidateProxy(),
      apply: () => Promise.resolve(),
    });

  return {
    api: new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === "useUtils") {
            return () =>
              new Proxy(
                {},
                { get: () => createInvalidateProxy() },
              );
          }
          return new Proxy(
            {},
            {
              get: () => createMockQuery(),
            },
          );
        },
      },
    ),
  };
});

// Mock uploadthing
vi.mock("~/lib/uploadthing", () => ({
  useUploadThing: () => ({
    startUpload: vi.fn(),
    isUploading: false,
  }),
}));

// Mock ToastProvider
vi.mock("~/components/providers/ToastProvider", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// Mock GSAP
const gsapMock = {
  registerPlugin: vi.fn(),
  fromTo: vi.fn().mockReturnValue({}),
  to: vi.fn().mockReturnValue({}),
  from: vi.fn().mockReturnValue({}),
  set: vi.fn().mockReturnValue({}),
  timeline: () => ({
    fromTo: vi.fn().mockReturnThis(),
    to: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    kill: vi.fn(),
  }),
  context: (fn: () => void) => {
    try { fn(); } catch { /* ignore errors in gsap context */ }
    return { revert: vi.fn(), add: vi.fn() };
  },
  matchMedia: () => ({
    add: vi.fn(),
    revert: vi.fn(),
  }),
};
vi.mock("gsap", () => ({
  default: gsapMock,
  gsap: gsapMock,
}));

vi.mock("gsap/ScrollTrigger", () => ({
  ScrollTrigger: {
    create: vi.fn(),
    refresh: vi.fn(),
    getAll: () => [],
    kill: vi.fn(),
  },
  default: {
    create: vi.fn(),
    refresh: vi.fn(),
    getAll: () => [],
    kill: vi.fn(),
  },
}));

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  value: MockIntersectionObserver,
});

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: MockResizeObserver,
});

// Polyfill setPointerCapture / releasePointerCapture for jsdom
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = vi.fn();
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = vi.fn();
}

// CSS variables used by design tokens
document.documentElement.style.setProperty("--accent-primary", "139 92 246");
document.documentElement.style.setProperty("--bg-primary", "10 10 12");
document.documentElement.style.setProperty("--fg-primary", "255 255 255");
