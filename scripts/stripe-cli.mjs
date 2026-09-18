/**
 * Run any Stripe CLI command against the account `.env` is configured for.
 *
 * `pnpm stripe:cli events list --limit 5`
 *
 * No `--` before the arguments: pnpm 10 forwards them as-is, and inserting one
 * swallows them — the CLI then prints its own help and looks broken.
 *
 * The CLI's own logged-in context is independent of `.env` and, on this account,
 * defaults to live — so a bare `stripe events list` answers about the wrong
 * account entirely. This injects `STRIPE_API_KEY` from `.env`, the same trick
 * `stripe:listen` uses, so every command lands where the app is pointed.
 *
 * Read-only commands are the point (`events list`, `events resend`,
 * `subscriptions list`), but nothing is restricted — the live-key guard is the
 * only thing standing between this and a real account.
 */

import { spawn } from "node:child_process";

const key = process.env.STRIPE_SECRET_KEY;

if (!key) {
  console.error("STRIPE_SECRET_KEY is not set in .env.");
  process.exit(1);
}

if (key.startsWith("sk_live_")) {
  console.error(
    "Refusing to run against a LIVE key. Put a sandbox key (sk_test_…) in .env first.",
  );
  process.exit(1);
}

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Nothing to run. Example: pnpm stripe:cli events list --limit 5");
  process.exit(1);
}

const child = spawn("stripe", args, {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, STRIPE_API_KEY: key },
});

child.on("exit", (code) => process.exit(code ?? 0));
