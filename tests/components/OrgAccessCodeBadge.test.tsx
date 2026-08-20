import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { OrgAccessCodeBadge } from "~/components/orgs/OrgAccessCodeBadge";

describe("OrgAccessCodeBadge", () => {
  it("renders null when no active org (mocked tRPC returns null)", () => {
    const { container } = render(<OrgAccessCodeBadge />);
    // With null data from mocked tRPC, it should render nothing
    expect(container.innerHTML).toBe("");
  });
});
