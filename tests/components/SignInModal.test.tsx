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

  /**
   * The dialog dismisses with the mono ESC affordance from `ui/Modal`, not a
   * glyph cross — a key name says how to close from the keyboard, which the
   * cross never did. See docs/theme.md §6.
   */
  it("closes with the mono ESC affordance, not a glyph cross", () => {
    render(<SignInModal {...defaultProps} />);
    const dismiss = screen.getByText("ESC");
    expect(dismiss.tagName).toBe("BUTTON");
    expect(dismiss.querySelector("svg")).toBeNull();
  });

  it("the ESC affordance calls onClose when clicked", () => {
    const onClose = vi.fn();
    render(<SignInModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText("ESC"));
    expect(onClose).toHaveBeenCalled();
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

    it("asks for the emailed code when two-step sign-in is on", async () => {
      await submit({ error: "CredentialsSignin", code: "TWO_FACTOR_REQUIRED:s3cret" });

      expect(await screen.findByText("Check your email")).toBeInTheDocument();
      expect(screen.getAllByLabelText(/Sign-in code digit/)).toHaveLength(8);
      expect(screen.getByText(/approve the link/i)).toBeInTheDocument();
    });

    it("finishes with the challenge secret and the typed code", async () => {
      await submit({ error: "CredentialsSignin", code: "TWO_FACTOR_REQUIRED:s3cret" });
      await screen.findByText("Check your email");

      vi.mocked(signIn).mockResolvedValue({ ok: true, error: undefined } as never);
      const user = userEvent.setup();
      await user.click(screen.getAllByLabelText(/Sign-in code digit/)[0]!);
      await user.paste("12345678");
      await user.click(screen.getByRole("button", { name: /verify/i }));

      expect(signIn).toHaveBeenLastCalledWith("two-factor", {
        challenge: "s3cret",
        code: "12345678",
        redirect: false,
      });
    });

    it("says so when the code is wrong, and stays on the code screen", async () => {
      await submit({ error: "CredentialsSignin", code: "TWO_FACTOR_REQUIRED:s3cret" });
      await screen.findByText("Check your email");

      vi.mocked(signIn).mockResolvedValue({
        error: "CredentialsSignin",
        code: "TWO_FACTOR_FAILED:invalid",
      } as never);
      const user = userEvent.setup();
      await user.click(screen.getAllByLabelText(/Sign-in code digit/)[0]!);
      await user.paste("00000000");
      await user.click(screen.getByRole("button", { name: /verify/i }));

      expect(await screen.findByText(/code is not valid/i)).toBeInTheDocument();
      expect(screen.getByText("Check your email")).toBeInTheDocument();
    });
  });

  it("uses subtle backdrop-blur-sm (not aggressive xl)", () => {
    render(<SignInModal {...defaultProps} />);
    const backdrop = document.querySelector(".backdrop-blur-sm");
    expect(backdrop).toBeInTheDocument();
    expect(document.querySelector(".backdrop-blur-xl")).toBeNull();
  });
});
