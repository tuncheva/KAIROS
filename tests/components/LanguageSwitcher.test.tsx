import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageSwitcher } from "~/components/layout/LanguageSwitcher";
import { LOCALE_METADATA, locales } from "~/i18n/locales";

/**
 * The switcher offers exactly the locales in `~/i18n/locales`, which is now `en`
 * and `bg`. It used to hardcode all five, three of which were about half
 * translated — choosing one produced a screen partly in that language and partly
 * in English. These tests assert against the config rather than a literal list, so
 * promoting a finished translation does not require editing them.
 */
const offeredNames = locales.map((code) => LOCALE_METADATA[code].name);

describe("LanguageSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, "cookie", {
      writable: true,
      value: "",
    });
  });

  it("renders the globe icon and current language flag", () => {
    render(<LanguageSwitcher />);
    const btn = screen.getByLabelText("Switch language");
    expect(btn).toBeInTheDocument();
    // Should show English flag for default "en" locale
    expect(btn).toHaveTextContent("🇬🇧");
  });

  it("renders compact variant by default", () => {
    render(<LanguageSwitcher />);
    const btn = screen.getByLabelText("Switch language");
    // compact variant should NOT show the language name
    expect(btn).not.toHaveTextContent("English");
  });

  it("renders full variant with language name visible", () => {
    render(<LanguageSwitcher variant="full" />);
    const btn = screen.getByLabelText("Switch language");
    expect(btn).toHaveTextContent("🇬🇧");
  });

  it("opens dropdown when clicked", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    const btn = screen.getByLabelText("Switch language");

    await user.click(btn);

    for (const name of offeredNames) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("closes dropdown when clicking outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <LanguageSwitcher />
      </div>,
    );
    const btn = screen.getByLabelText("Switch language");

    await user.click(btn);
    expect(screen.getByText("English")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    await waitFor(() => {
      expect(screen.queryByText("English")).not.toBeInTheDocument();
    });
  });

  it("toggles chevron rotation when opened", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    const btn = screen.getByLabelText("Switch language");

    await user.click(btn);
    // Dropdown should be visible
    expect(screen.getByText("English")).toBeInTheDocument();

    await user.click(btn);
    await waitFor(() => {
      expect(screen.queryByText("English")).not.toBeInTheDocument();
    });
  });

  it("sets cookie and reloads on language selection", async () => {
    const user = userEvent.setup();
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, reload: reloadMock },
    });

    render(<LanguageSwitcher />);
    const btn = screen.getByLabelText("Switch language");

    // Pick an offered locale other than the current one.
    const target = locales.find((code) => code !== "en")!;

    await user.click(btn);
    await user.click(screen.getByText(LOCALE_METADATA[target].name));

    expect(document.cookie).toContain(`NEXT_LOCALE=${target}`);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("highlights the current locale in dropdown", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    const btn = screen.getByLabelText("Switch language");

    await user.click(btn);

    // The English option should have active styling (font-medium class)
    const englishBtn = screen.getByText("English").closest("button");
    expect(englishBtn?.className).toContain("font-medium");
  });

  it("applies custom className", () => {
    render(<LanguageSwitcher className="custom-test-class" />);
    const wrapper = screen.getByLabelText("Switch language").parentElement;
    expect(wrapper?.className).toContain("custom-test-class");
  });

  it("displays every offered language, and only those", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    const btn = screen.getByLabelText("Switch language");

    await user.click(btn);

    for (const name of offeredNames) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }

    // The half-translated locales must not be offered.
    for (const name of ["Español", "Français", "Deutsch"]) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
  });

  it("dropdown has solid background (no transparency)", async () => {
    const user = userEvent.setup();
    const { container } = render(<LanguageSwitcher />);
    const btn = screen.getByLabelText("Switch language");

    await user.click(btn);

    // The dropdown should not have transparency classes
    const dropdown = container.querySelector("[class*='bg-bg-primary']");
    expect(dropdown).not.toBeNull();
    expect(dropdown?.className).not.toContain("bg-bg-primary/95");
    expect(dropdown?.className).not.toContain("backdrop-blur");
  });
});
