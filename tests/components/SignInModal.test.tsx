import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signIn } from "next-auth/react";
import { SignInModal } from "~/components/auth/SignInModal";

describe("SignInModal", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(<SignInModal isOpen={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders when isOpen is true", () => {
    render(<SignInModal {...defaultProps} />);
    expect(screen.getByPlaceholderText("name@company.com")).toBeInTheDocument();
  });

  it("renders email input", () => {
    render(<SignInModal {...defaultProps} />);
    const emailInput = screen.getByPlaceholderText("name@company.com");
    expect(emailInput).toBeInTheDocument();
    expect(emailInput).toHaveAttribute("type", "email");
  });

  it("renders password input", () => {
    render(<SignInModal {...defaultProps} />);
    const passInput = screen.getByPlaceholderText("Password");
    expect(passInput).toBeInTheDocument();
    expect(passInput).toHaveAttribute("type", "password");
  });

  it("calls onClose when backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(<SignInModal isOpen={true} onClose={onClose} />);
    // The backdrop is the element with bg-black/60 class
    const backdrop = document.querySelector(".backdrop-blur-sm");
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("allows typing in email field", async () => {
    const user = userEvent.setup();
    render(<SignInModal {...defaultProps} />);

    const emailInput = screen.getByPlaceholderText("name@company.com");
    await user.type(emailInput, "test@example.com");
    expect(emailInput).toHaveValue("test@example.com");
  });

  it("allows typing in password field", async () => {
    const user = userEvent.setup();
    render(<SignInModal {...defaultProps} />);

    const passInput = screen.getByPlaceholderText("Password");
    await user.type(passInput, "secret123");
    expect(passInput).toHaveValue("secret123");
  });

  it("has tabs for sign in and sign up", () => {
    render(<SignInModal {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign up" })).toBeInTheDocument();
  });

  it("shows name field in sign up mode", async () => {
    const user = userEvent.setup();
    render(<SignInModal {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(screen.getByPlaceholderText("Enter your full name")).toBeInTheDocument();
  });

  it("shows sign up heading in sign up mode", async () => {
    const user = userEvent.setup();
    render(<SignInModal {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(screen.getByText("Create your account")).toBeInTheDocument();
  });

  it("pre-fills email when initialEmail is provided", () => {
    render(<SignInModal isOpen={true} onClose={vi.fn()} initialEmail="pre@fill.com" />);
    const emailInput = screen.getByPlaceholderText("name@company.com");
    expect(emailInput).toHaveValue("pre@fill.com");
  });

  it("applies subtle backdrop blur styling", () => {
    render(<SignInModal {...defaultProps} />);
    const backdrop = document.querySelector(".backdrop-blur-sm");
    expect(backdrop).toBeInTheDocument();
  });

  it("renders Google sign-in button", () => {
    render(<SignInModal {...defaultProps} />);
    expect(screen.getByText("Google")).toBeInTheDocument();
  });

  it("renders with kairos design system classes", () => {
    render(<SignInModal {...defaultProps} />);
    const modal = document.querySelector(".k-auth-shell");
    expect(modal).toBeInTheDocument();
  });

  it("has submit button for sign in", () => {
    render(<SignInModal {...defaultProps} />);
    const submitBtn = screen.getByRole("button", { name: "Sign In" });
    expect(submitBtn).toBeInTheDocument();
  });

  it("shows Welcome back heading in sign in mode", () => {
    render(<SignInModal {...defaultProps} />);
    expect(screen.getByText("Welcome Back")).toBeInTheDocument();
  });

  it("tabs back to sign in from sign up", async () => {
    const user = userEvent.setup();
    render(<SignInModal {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(screen.getByText("Create your account")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Welcome Back")).toBeInTheDocument();
  });

  it("renders terms and privacy notice", async () => {
    const user = userEvent.setup();
    render(<SignInModal {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(screen.getByText(/Terms of Service/i)).toBeInTheDocument();
  });

  it("has an X close button", () => {
    render(<SignInModal {...defaultProps} />);
    // The X button is rendered as a button with an SVG X icon
    const closeButtons = document.querySelectorAll("button");
    const xButton = Array.from(closeButtons).find(
      (btn) => btn.querySelector("svg") && btn.className.includes("absolute"),
    );
    expect(xButton).toBeTruthy();
  });

  it("X close button calls onClose when clicked", async () => {
    const onClose = vi.fn();
    render(<SignInModal isOpen={true} onClose={onClose} />);
    const closeButtons = document.querySelectorAll("button");
    const xButton = Array.from(closeButtons).find(
      (btn) => btn.querySelector("svg") && btn.className.includes("absolute"),
    );
    if (xButton) {
      fireEvent.click(xButton);
      expect(onClose).toHaveBeenCalled();
    }
  });

  /**
   * Sign-in is refused for four different reasons and used to report one.
   * An unverified account was the worst of them: the password was right, the
   * message said it was wrong, and the only "resend confirmation" button in
   * the app lived on a view reachable for a few seconds after signing up.
   */
  describe("refusals it can tell apart", () => {
    const submit = async (result: Record<string, unknown>) => {
      vi.mocked(signIn).mockResolvedValue(result as never);
      const user = userEvent.setup();
      const { container } = render(<SignInModal {...defaultProps} />);
      await user.type(screen.getByPlaceholderText("name@company.com"), "a@b.co");
      await user.type(
        container.querySelector<HTMLInputElement>('input[type="password"]')!,
        "hunter2hunter2",
      );
      await user.click(container.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    };

    it("offers to resend the confirmation when the email is unverified", async () => {
      await submit({ error: "CredentialsSignin", code: "EMAIL_UNVERIFIED" });

      expect(await screen.findByText(/confirm your email/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /resend the email/i }),
      ).toBeInTheDocument();
    });

    it("says how long a lockout has left", async () => {
      await submit({ error: "CredentialsSignin", code: "ACCOUNT_LOCKED:7" });

      expect(await screen.findByText(/7 minutes/)).toBeInTheDocument();
    });

    it("keeps a wrong password indistinguishable from an unknown address", async () => {
      await submit({ error: "CredentialsSignin", code: undefined });

      expect(await screen.findByText(/invalid|incorrect/i)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /resend the email/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("uses subtle backdrop-blur-sm (not aggressive xl)", () => {
    render(<SignInModal {...defaultProps} />);
    const backdrop = document.querySelector(".backdrop-blur-sm");
    expect(backdrop).toBeInTheDocument();
    expect(document.querySelector(".backdrop-blur-xl")).toBeNull();
  });
});
