import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import NotFound from "~/app/not-found";

describe("NotFound (404) Page", () => {
  it("renders without crashing", () => {
    render(<NotFound />);
  });

  it("displays 404 badge", () => {
    const { container } = render(<NotFound />);
    const badge = container.querySelector("span");
    expect(badge?.textContent).toBe("404");
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

  it("uses accent-primary color for 404 badge", () => {
    const { container } = render(<NotFound />);
    const badge = container.querySelector(".text-accent-primary");
    expect(badge).toBeInTheDocument();
  });

  it("has proper background color", () => {
    const { container } = render(<NotFound />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("bg-bg-primary");
  });
});
