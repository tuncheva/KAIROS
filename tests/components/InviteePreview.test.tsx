import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("~/trpc/react", () => ({ api: {} }));

import { InviteePreview } from "~/components/orgs/InviteePreview";

const EMAIL = "ana@example.com";

describe("InviteePreview", () => {
  it("shows a person the inviter may see", () => {
    render(
      <InviteePreview
        email={EMAIL}
        loading={false}
        lookup={{ status: "person", person: { name: "Ana Petrova", image: null } }}
      />,
    );
    expect(screen.getByText("Ana Petrova")).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByText(/Has a KAIROS account/)).toBeInTheDocument();
  });

  /* `new` covers "no account" and "an account you may not see" alike; the row
     tells the inviter a sign-up email is on its way. */
  it("says an unknown address will get an email to sign up", () => {
    render(
      <InviteePreview email={EMAIL} loading={false} lookup={{ status: "new", person: null }} />,
    );
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByText(/Not registered in KAIROS yet/)).toBeInTheDocument();
    expect(screen.getByText(/email inviting them to sign up/)).toBeInTheDocument();
  });

  it("says when the person is already in the workspace or already invited", () => {
    const { rerender } = render(
      <InviteePreview
        email={EMAIL}
        loading={false}
        lookup={{ status: "member", person: { name: "Ana Petrova", image: null } }}
      />,
    );
    expect(screen.getByText("Already in this workspace.")).toBeInTheDocument();

    rerender(
      <InviteePreview email={EMAIL} loading={false} lookup={{ status: "pending", person: null }} />,
    );
    expect(screen.getByText(/Already invited/)).toBeInTheDocument();
  });

  it("renders nothing before there is anything to say", () => {
    const { container } = render(
      <InviteePreview email="ana@" loading={false} lookup={undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
