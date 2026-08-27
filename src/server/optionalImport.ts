import "server-only";

/**
 * Loads a package that may not be installed, without the bundler trying to
 * resolve it.
 *
 * Redis (and the socket.io adapter that pairs with it) are optional: absent
 * them the app runs single-instance with in-process fallbacks, which is the
 * default. A plain `await import("redis")` makes Turbopack and webpack attempt
 * resolution at build time and emit `Module not found: Can't resolve 'redis'` on
 * every build — noise that `serverExternalPackages` does not suppress, because
 * the package genuinely is not on disk.
 *
 * Going through `createRequire` keeps the specifier away from static analysis,
 * so resolution happens at runtime where a missing package is just a throw the
 * caller already handles. Callers must keep their try/catch.
 *
 * The require is anchored to the project root rather than `import.meta.url`:
 * that is where an installed optional dependency lives, and it resolves whether
 * the server bundle ends up ESM or CJS — `import.meta.url` is undefined in the
 * latter, which would quietly disable Redis for someone who had installed it.
 */
export async function optionalImport(specifier: string): Promise<unknown> {
  const [{ createRequire }, nodePath] = await Promise.all([
    import("node:module"),
    import("node:path"),
  ]);
  const requireFrom = createRequire(nodePath.join(process.cwd(), "index.js"));
  return requireFrom(specifier) as unknown;
}
