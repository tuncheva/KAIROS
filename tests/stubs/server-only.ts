// Stub for the `server-only` package under Vitest.
//
// Vitest resolves bare imports with the node/default export conditions, where
// `server-only` exports its throwing build (the one that guards against client
// imports at `next build` time). In tests it should be a no-op, so this empty
// module is aliased in vitest.config.ts / vitest.integration.config.ts.
export {};
