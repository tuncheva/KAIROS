import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import NotFound from "~/app/not-found";

describe("NotFound (404) Page", () => {
  it("renders without crashing", () => {
    render(<NotFound />);
  });

  it("carries the status as a mono eyebrow", () => {
    // Was "404" set in bold sans at text-4xl inside a tinted tile — the one
    // place in the product where a number did a stamp's job.
    const { container } = render(<NotFound />);
    const eyebrow = container.querySelector(".font-mono");
    expect(eyebrow?.textContent).toContain("404");
  });

  it("shows Page Not Found heading", () => {
    const { getByText } = render(<NotFound />);
    expect(getByText("Page not found")).toBeInTheDocument();
  });

  it("shows helpful description text", () => {
    const { getByText } = render(<NotFound />);
    expect(
      getByText("Sorry, the page you are looking for does not exist."),
    ).toBeInTheDocument();
  });

  it("has Go Home link pointing to /", () => {
    const { getByText } = render(<NotFound />);
    const link = getByText("Go home");
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute("href", "/");
  });

  it("applies kairos-page-enter animation class", () => {
    const { container } = render(<NotFound />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("kairos-page-enter");
  });

  it("applies kairos-btn class to go home link", () => {
    const { getByText } = render(<NotFound />);
    const link = getByText("Go home").closest("a");
    expect(link?.className).toContain("kairos-btn");
  });

  it("renders centered layout", () => {
    const { container } = render(<NotFound />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("items-center");
    expect(wrapper.className).toContain("justify-center");
  });

  it("sets the heading in the display face, not bold sans", () => {
    const { container } = render(<NotFound />);
    const heading = container.querySelector("h1");
    expect(heading?.className).toContain("font-display");
    expect(heading?.className).not.toContain("font-bold");
  });

  it("has proper background color", () => {
    const { container } = render(<NotFound />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("bg-bg-primary");
  });
});
