/**
 * ESLint Configuration
 * This file contains the actual ESLint rules and settings.
 * Dependencies are injected from the root wrapper to avoid module resolution issues.
 */

/**
 * @param {Object} deps - Dependencies injected from root
 * @param {import('typescript-eslint')} deps.tseslint
 * @param {Object} deps.drizzle
 * @param {Object} deps.nextPlugin
 * @param {Object} deps.reactHooks
 */
export function createEslintConfig({ tseslint, drizzle, nextPlugin, reactHooks }) {
  return tseslint.config(
    {
      ignores: [".next", "config"],
    },
    nextPlugin.configs.recommended,
    nextPlugin.configs["core-web-vitals"],
    {
      files: ["**/*.ts", "**/*.tsx"],
      plugins: {
        drizzle,
        // React Hooks rules were referenced by `eslint-disable` comments in three
        // components but the plugin was never installed, so ESLint hard-errored on
        // the unknown rule and no hook rule had ever actually run.
        //
        // Registered explicitly rather than via `reactHooks.configs.*`: as of v7
        // the `recommended` presets are still eslintrc-shaped (`plugins` as an
        // array), which flat config rejects.
        "react-hooks": reactHooks,
      },
      extends: [
        ...tseslint.configs.recommended,
        ...tseslint.configs.recommendedTypeChecked,
        ...tseslint.configs.stylisticTypeChecked,
      ],
      rules: {
        "@typescript-eslint/array-type": "off",
        "@typescript-eslint/consistent-type-definitions": "off",
        "@typescript-eslint/consistent-type-imports": [
          "warn",
          { prefer: "type-imports", fixStyle: "inline-type-imports" },
        ],
        "@typescript-eslint/no-unused-vars": [
          "warn",
          { argsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/require-await": "off",
        // rules-of-hooks is an error: it catches genuinely broken hook usage
        // (conditional/early-return hook calls), which is a crash-class bug.
        // exhaustive-deps is a warning so pre-existing violations don't block CI.
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
        "@typescript-eslint/no-misused-promises": [
          "error",
          { checksVoidReturn: { attributes: false } },
        ],
        "drizzle/enforce-delete-with-where": [
          "error",
          { drizzleObjectName: ["db", "ctx.db"] },
        ],
        "drizzle/enforce-update-with-where": [
          "error",
          { drizzleObjectName: ["db", "ctx.db"] },
        ],
      },
    },
    {
      // Server code logs through `~/server/logger` (and `ws-server/logger` in the
      // socket process), which applies levels and redaction. A bare console.* call
      // bypasses both — that is how user ids, emails and raw errors ended up on
      // stdout with no way to turn them off. The two logger modules are the
      // console boundary and are exempt.
      files: ["src/server/**/*.ts", "ws-server/**/*.ts"],
      ignores: ["src/server/logger.ts", "ws-server/logger.ts"],
      rules: {
        "no-console": "error",
      },
    },
    {
      linterOptions: {
        reportUnusedDisableDirectives: true,
      },
      languageOptions: {
        parserOptions: {
          projectService: true,
        },
      },
    }
  );
}
