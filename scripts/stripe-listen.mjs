/**
 * Forward Stripe webhooks to the local dev server, against the same account the
 * app is configured for.
 *
 * Run with `pnpm stripe:listen`.
 *
 * The CLI keeps its own logged-in context, which is independent of the key in
 * `.env` — and that split is a trap. A CLI still pointed at the live account
 * forwards live events to a dev server holding a sandbox key: every delivery
 * then fails signature verification, or worse, succeeds against the wrong
 * account. Reading the key from `.env` and handing it to the CLI as
 * `STRIPE_API_KEY` makes the two agree by construction, whatever
 * `stripe switch context` was last set to.
 *
 * The key is passed through the environment rather than as `--api-key`, so it
 * stays out of the process list and out of shell history.
 */

import { spawn } from "node:child_process";

const key = process.env.STRIPE_SECRET_KEY;

if (!key) {
  console.error(
    "STRIPE_SECRET_KEY is not set in .env — nothing to forward events for.",
  );
  process.exit(1);
}

if (key.startsWith("sk_live_")) {
  console.error(
    "Refusing to forward LIVE webhooks to a development server.\n" +
      "Put a sandbox key (sk_test_…) in .env first.",
  );
  process.exit(1);
}

const forwardTo =
  process.argv[2] ?? "http://localhost:3000/api/stripe/webhook";

console.log(`Forwarding to ${forwardTo}`);
console.log("Copy the whsec_… below into .env as STRIPE_WEBHOOK_SECRET.\n");

const child = spawn(
  "stripe",
  ["listen", "--forward-to", forwardTo],
  {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, STRIPE_API_KEY: key },
  },
);

child.on("exit", (code) => process.exit(code ?? 0));
