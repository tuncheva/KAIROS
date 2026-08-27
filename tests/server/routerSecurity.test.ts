import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Server-side router security & correctness tests.
 * Reads every tRPC router source and verifies critical patterns:
 * - Protected procedures require auth
 * - No raw SQL injection vectors
 * - Proper Zod validation on all inputs
 * - Argon2id used for password hashing (not bcrypt, not plain)
 * - Crypto-safe random generation (not Math.random)
 */

const routerDir = path.resolve(__dirname, "../../src/server/api/routers");

const routerFiles = fs.readdirSync(routerDir).filter((f) => f.endsWith(".ts"));
const routers: Record<string, string> = {};
for (const file of routerFiles) {
  routers[file] = fs.readFileSync(path.join(routerDir, file), "utf-8");
}

describe("Router Security — All Routers", () => {
  for (const [file, source] of Object.entries(routers)) {
    describe(file, () => {
      it("imports from trpc module", () => {
        expect(source).toMatch(/from\s+["'].*trpc["']/);
      });

      it("uses createTRPCRouter", () => {
        expect(source).toContain("createTRPCRouter");
      });

      it("does not use raw SQL template literals without parameterisation", () => {
        // Check for dangerous patterns: db.execute(`...${var}...`)
        const dangerousPattern = /db\.execute\s*\(\s*`[^`]*\$\{/;
        expect(dangerousPattern.test(source)).toBe(false);
      });

      it("does not use eval or Function constructor", () => {
        expect(source).not.toMatch(/\beval\s*\(/);
        expect(source).not.toMatch(/new\s+Function\s*\(/);
      });
    });
  }
});

describe("Auth Router — Specific Security", () => {
  const authSource = routers["auth.ts"]!;
  // Code issuing, hashing and expiry moved out of the router into the shared
  // module that serves both password reset and address confirmation, so the
  // assertions about them follow it there.
  const codeSource = fs.readFileSync(
    path.resolve(__dirname, "../../src/server/email/verificationCodes.ts"),
    "utf-8",
  );

  it("uses argon2 for password hashing", () => {
    expect(authSource).toContain("argon2");
    expect(authSource).toContain("argon2id");
  });

  it("does not use bcrypt", () => {
    expect(authSource).not.toContain("bcrypt");
  });

  it("generates reset codes with node:crypto, not Math.random", () => {
    expect(codeSource).toContain('from "node:crypto"');
    expect(codeSource).toContain("randomInt(");
    expect(codeSource).not.toContain("Math.random");
    expect(authSource).not.toContain("Math.random");
  });

  it("stores only a hash of the code, never the code itself", () => {
    expect(codeSource).toContain("createHash(\"sha256\")");
    expect(codeSource).toContain("codeHash: hashVerificationCode(code)");
  });

  it("compares code hashes in constant time", () => {
    expect(codeSource).toContain("timingSafeEqual");
  });

  it("caps guesses per issued code", () => {
    expect(codeSource).toContain("MAX_CODE_ATTEMPTS");
    expect(codeSource).toContain("row.attempts >= MAX_CODE_ATTEMPTS");
  });

  it("validates email format on signup", () => {
    expect(authSource).toContain("z.string().email()");
  });

  it("enforces minimum password length of 8", () => {
    expect(authSource).toContain('.min(8');
  });

  it("checks for existing user before signup", () => {
    expect(authSource).toContain("existingUser");
    expect(authSource).toContain("CONFLICT");
  });

  it("reset code has expiry", () => {
    expect(codeSource).toContain("expiresAt");
    expect(codeSource).toContain("VERIFICATION_CODE_TTL_MS");
  });

  it("spends the code when the password is actually reset", () => {
    expect(authSource).toContain("consumeVerificationCode");
    expect(codeSource).toContain("consumedAt: new Date()");
  });

  it("all procedures use publicProcedure (auth is public)", () => {
    expect(authSource).toContain("publicProcedure");
    // Auth router should NOT use protectedProcedure
    expect(authSource).not.toContain("protectedProcedure");
  });
});

describe("Task Router — Permission Checks", () => {
  const taskSource = routers["task.ts"]!;

  it("uses protectedProcedure for all mutations", () => {
    expect(taskSource).toContain("protectedProcedure");
    expect(taskSource).not.toContain("publicProcedure");
  });

  it("checks project ownership before task creation", () => {
    expect(taskSource).toContain("createdById === ctx.session.user.id");
  });

  it("delegates authorization to the shared permission helper", () => {
    // The inline "owner → org member → write collaborator" block that used to be
    // copy-pasted into four mutations here now lives in `~/server/api/authz`,
    // where it is covered by real behavioural tests
    // (tests/server/permissions.test.ts). Asserting on this file's source text
    // could never have detected a missing check in the first place; what it can
    // still usefully catch is a mutation quietly stopping calling the helper.
    expect(taskSource).toContain('from "~/server/api/authz"');
    expect(taskSource).toContain("assertProjectPermission(ctx");
  });

  it("logs task activity on create", () => {
    expect(taskSource).toContain("taskActivityLog");
    expect(taskSource).toContain('action: "created"');
  });

  it("logs task activity on status change", () => {
    expect(taskSource).toContain('action: "status_changed"');
  });

  it("supports clientRequestId for deduplication", () => {
    expect(taskSource).toContain("clientRequestId");
  });

  it("validates task title max length", () => {
    expect(taskSource).toContain(".max(256)");
  });

  it("validates priority enum", () => {
    expect(taskSource).toContain('"low", "medium", "high", "urgent"');
  });

  it("validates status enum", () => {
    expect(taskSource).toContain('"pending", "in_progress", "completed", "blocked"');
  });
});

describe("Note Router — Encryption Security", () => {
  const noteSource = routers["note.ts"]!;

  it("uses protectedProcedure", () => {
    expect(noteSource).toContain("protectedProcedure");
  });

  it("encrypts note content", () => {
    expect(noteSource).toContain("encryptContent");
  });

  it("decrypts note content", () => {
    expect(noteSource).toContain("decryptContent");
  });

  it("hashes note passwords with argon2", () => {
    expect(noteSource).toContain("argon2.hash");
    expect(noteSource).toContain("argon2.verify");
  });

  it("verifies password before allowing update", () => {
    expect(noteSource).toContain("argon2.verify(note.passwordHash");
  });

  it("limits note content to reasonable size", () => {
    expect(noteSource).toContain("z.string()");
  });

  it("scope notes to current user", () => {
    expect(noteSource).toContain("ctx.session.user.id");
  });
});

describe("Settings Router — Delete Account Safety", () => {
  const settingsSource = routers["settings.ts"]!;

  it("uses protectedProcedure for all procedures", () => {
    expect(settingsSource).toContain("protectedProcedure");
    expect(settingsSource).not.toContain("publicProcedure");
  });

  it("deleteAllData deletes sessions before user", () => {
    expect(settingsSource).toContain("sessions");
    expect(settingsSource).toContain("accounts");
  });

  it("deleteAllData uses cascading delete path", () => {
    // Should delete sessions → accounts → user
    const deleteIdx = settingsSource.indexOf("deleteAllData");
    const afterDelete = settingsSource.slice(deleteIdx);
    const sessionsIdx = afterDelete.indexOf("sessions");
    const accountsIdx = afterDelete.indexOf("accounts");
    const usersIdx = afterDelete.indexOf("users");
    // Sessions should be deleted before accounts, accounts before users
    expect(sessionsIdx).toBeLessThan(accountsIdx);
    expect(accountsIdx).toBeLessThan(usersIdx);
  });
});

describe("Project Router — Authorization", () => {
  const projectSource = routers["project.ts"]!;

  it("uses protectedProcedure", () => {
    expect(projectSource).toContain("protectedProcedure");
  });

  it("checks project ownership on delete", () => {
    expect(projectSource).toContain("createdById");
  });

  it("supports collaborator permissions", () => {
    expect(projectSource).toContain("projectCollaborators");
  });

  it("supports organization-scoped projects", () => {
    expect(projectSource).toContain("organizationId");
  });

  it("uses batch query for tasks (no N+1)", () => {
    expect(projectSource).toContain("inArray");
    expect(projectSource).toContain("tasksByProjectId");
  });
});

describe("Organization Router — Access Control", () => {
  const orgSource = routers["organization.ts"]!;

  it("uses protectedProcedure", () => {
    expect(orgSource).toContain("protectedProcedure");
  });

  it("generates access codes securely (rejection sampling)", () => {
    expect(orgSource).toContain("maxValid");
  });

  it("checks admin role for member management", () => {
    expect(orgSource).toContain('role !== "admin"');
  });

  it("validates organization name", () => {
    expect(orgSource).toContain("z.string().min(");
  });
});

describe("Event Router — Input Validation", () => {
  const eventSource = routers["event.ts"]!;

  it("validates event title", () => {
    expect(eventSource).toContain("z.string()");
  });

  it("limits description length", () => {
    expect(eventSource).toContain(".max(5000)");
  });

  it("uses protectedProcedure for mutations", () => {
    expect(eventSource).toContain("protectedProcedure");
  });

  it("has public query for events", () => {
    expect(eventSource).toContain("publicProcedure");
  });

  it("creates notifications on interactions", () => {
    expect(eventSource).toContain("notifications");
  });
});

describe("Notification Router — Correct ID Parsing", () => {
  const notifSource = routers["notification.ts"]!;

  it("handles compound notification IDs", () => {
    expect(notifSource).toContain('split("-")');
    expect(notifSource).toContain("pop()");
  });

  it("uses parseInt with radix 10", () => {
    expect(notifSource).toContain("parseInt");
    expect(notifSource).toContain(", 10)");
  });
});
