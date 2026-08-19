/**
 * ESLint Configuration Wrapper
 * Imports are done here (at project root) for proper node_modules resolution.
 * Actual config logic lives in config/eslint.config.js
 */
import tseslint from "typescript-eslint";
// @ts-ignore -- no types for this plugin
import drizzle from "eslint-plugin-drizzle";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import { createEslintConfig } from "./config/eslint.config.js";

export default createEslintConfig({ tseslint, drizzle, nextPlugin, reactHooks });
