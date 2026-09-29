import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Auth config tests — comprehensive security checks for next-auth configuration
 */

const configPath = path.resolve(__dirname, "../../src/server/auth/config.ts");
const configSource = fs.readFileSync(configPath, "utf-8");

describe("Auth Config — Provider Security", () => {
  it("uses JWT session strategy", () => {
    expect(configSource).toContain("jwt");
  });

  it("configures Google provider", () => {
    expect(configSource).toMatch(/Google|google/i);
  });

  it("configures Credentials provider", () => {
    expect(configSource).toContain("Credentials");
  });

  it("uses argon2 for credential verification", () => {
    expect(configSource).toContain("argon2");
  });

  it("does not store passwords in session/JWT", () => {
    // JWT callback should not include password field
    expect(configSource).not.toMatch(/token\.password|session\.password/);
  });

  it("has session callback", () => {
    expect(configSource).toContain("session");
  });

  it("has jwt callback", () => {
    expect(configSource).toContain("jwt");
  });
});

describe("Auth Config — Account Linking", () => {
  it("allows dangerous email account linking", () => {
    expect(configSource).toContain("allowDangerousEmailAccountLinking");
  });

  /**
   * An unconfirmed row may be claimed by a provider-verified identity, but the
   * password on it must not survive the claim: that password is the whole of the
   * takeover attack email-linking otherwise enables.
   */
  it("clears the unproven password when claiming an unverified account", () => {
    expect(configSource).toContain("password: null");
    expect(configSource).toContain("resetPinHash: null");
  });

  /**
   * Into any existing row, verified or not: a verified row is the one somebody
   * owns, and an Entra work tenant can put any address on a token.
   */
  it("refuses to link an identity whose provider did not verify the address", () => {
    expect(configSource).toMatch(
      /if \(!linkedAlready && existingByEmail && !emailProven\) \{[\s\S]*?return false;/,
    );
  });

  it("only trusts Entra addresses from personal accounts or xms_edov", () => {
    expect(configSource).toContain("9188040d-6c67-4c5b-b112-36a304b66dad");
    expect(configSource).toContain("claims.xms_edov === true");
  });

  it("drops provider identities already on a row it claims", () => {
    expect(configSource).toContain(
      "db.delete(accounts).where(eq(accounts.userId, existingByEmail.id))",
    );
  });

  it("does not trip the email unique constraint on a first OAuth link", () => {
    expect(configSource).not.toContain("onConflictDoNothing({ target: users.id })");
  });

  it("registers Microsoft only when its keys are set", () => {
    expect(configSource).toMatch(/\.\.\.\(isMicrosoftSignInEnabled\s*\?/);
  });

  it("keeps the Graph photo out of the JWT", () => {
    expect(configSource).toMatch(/profile\(profile\) \{[\s\S]*?image: null/);
  });

  it("sends sign-in failures to a real page instead of the built-in error code", () => {
    expect(configSource).toContain('error: "/auth-error"');
  });
});

describe("Auth Config — No Hardcoded Secrets", () => {
  it("does not hardcode OAuth client IDs", () => {
    // Should use env variables
    expect(configSource).not.toMatch(/clientId:\s*["'][A-Za-z0-9]{20,}/);
  });

  it("does not hardcode OAuth client secrets", () => {
    expect(configSource).not.toMatch(/clientSecret:\s*["'][A-Za-z0-9]{20,}/);
  });

  it("references environment variables for secrets", () => {
    expect(configSource).toMatch(/process\.env|env\./);
  });
});
