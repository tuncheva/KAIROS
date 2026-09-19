/**
 * The design-system guardrail.
 *
 * The audit that produced `docs/theme.md` found ~205 hand-painted slate/gray
 * classes, nine hardcoded surface hexes and ~100 Tailwind status colours that
 * had walked around the tokens they were given. Fixing them once is worth
 * nothing if the next feature branch adds ten more, so the three prohibitions
 * are checked here and this file runs in `pnpm check` and in the test suite.
 *
 * Run directly:  pnpm exec tsx scripts/check-theme.ts
 */

import fs from "node:fs";
import path from "node:path";

export interface ThemeViolation {
  file: string;
  line: number;
  rule: string;
  text: string;
  hint: string;
}

const ROOT = path.resolve(import.meta.dirname, "..");
const SCAN_ROOTS = ["src"];
const EXTENSIONS = new Set([".ts", ".tsx"]);

/**
 * Files allowed to carry a raw hex, with the reason.
 *
 * Each of these is somewhere a CSS custom property cannot reach: a `<meta>`
 * value the browser reads before any stylesheet, a third-party brand mark, an
 * HTML email, a QR bitmap, or the pre-paint theme script itself.
 */
const HEX_ALLOWED: Record<string, string> = {
  "src/app/layout.tsx":
    "themeColor meta values — browser chrome, read before any CSS",
  "src/components/auth/SignInModal.tsx":
    "the four Google brand colours inside the provider SVG",
  "src/server/http/themeInitScript.ts": "runs before the stylesheet exists",
  "src/lib/avatarGradient.ts":
    "deterministic avatar gradients, not a UI surface",
  "src/server/email/email.ts":
    "HTML email — no custom properties in mail clients",
  "src/server/orgs/joinCodes.ts":
    "QR bitmap foreground/background for the qrcode encoder",
};

/** Tailwind's own status families. The four semantic tokens replace them. */
const TAILWIND_STATUS =
  "red|amber|emerald|green|sky|cyan|orange|yellow|rose|teal|lime|blue|indigo|violet|fuchsia";
const UTILITY_PREFIX =
  "text|bg|border|ring|from|to|via|fill|stroke|shadow|outline|decoration|accent|caret|divide|placeholder";

const RULES: {
  name: string;
  pattern: RegExp;
  hint: string;
  scope?: (relative: string) => boolean;
}[] = [
  {
    name: "no-raw-hex-surface",
    pattern: /#[0-9a-fA-F]{3,8}\b/g,
    hint: "use a surface, ink, hairline, accent or status token — see docs/theme.md",
    scope: (relative) => HEX_ALLOWED[relative] === undefined,
  },
  {
    name: "no-slate-or-gray",
    pattern: new RegExp(
      `\\b(?:${UTILITY_PREFIX})-(?:slate|gray)-[0-9]+\\b`,
      "g",
    ),
    hint: "the tokens carry both modes: bg-bg-*, text-fg-*, border-border-*",
  },
  {
    name: "no-tailwind-status",
    pattern: new RegExp(
      `\\b(?:${UTILITY_PREFIX})-(?:${TAILWIND_STATUS})-[0-9]+\\b`,
      "g",
    ),
    hint: "use bg/border/text-status-{success,warning,danger,info}-{surface,border,ink}",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

export function findThemeViolations(): ThemeViolation[] {
  const violations: ThemeViolation[] = [];

  for (const scanRoot of SCAN_ROOTS) {
    const absolute = path.join(ROOT, scanRoot);
    if (!fs.existsSync(absolute)) continue;

    for (const file of walk(absolute)) {
      const relative = path.relative(ROOT, file).split(path.sep).join("/");
      const lines = fs.readFileSync(file, "utf-8").split("\n");

      for (const rule of RULES) {
        if (rule.scope && !rule.scope(relative)) continue;

        lines.forEach((line, index) => {
          /* A line-comment or a JSDoc line is prose about the rule, not a
             violation of it — this file and docs/theme.md both name the
             classes they forbid. */
          const trimmed = line.trimStart();
          if (
            trimmed.startsWith("//") ||
            trimmed.startsWith("*") ||
            trimmed.startsWith("/*")
          ) {
            return;
          }
          for (const match of line.matchAll(rule.pattern)) {
            violations.push({
              file: relative,
              line: index + 1,
              rule: rule.name,
              text: match[0],
              hint: rule.hint,
            });
          }
        });
      }
    }
  }

  return violations;
}

function main(): void {
  const violations = findThemeViolations();

  if (violations.length === 0) {
    console.log(
      "check-theme: clean — no raw hex, no slate/gray, no Tailwind status families.",
    );
    return;
  }

  console.error(`check-theme: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.text}`);
    console.error(`      ${v.hint}`);
  }
  console.error(
    "\nSee docs/theme.md for the token layer these rules point at.",
  );
  process.exit(1);
}

/* Only when run as a script — the test suite imports `findThemeViolations`. */
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) ===
    path.resolve(import.meta.dirname, "check-theme.ts");
if (invokedDirectly) main();
