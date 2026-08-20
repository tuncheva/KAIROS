/**
 * The inline script that applies the saved theme before first paint.
 *
 * It has to be inline and synchronous: its whole purpose is to set the theme class
 * before the browser paints, which an external script cannot guarantee.
 *
 * ## Why it is a constant with a hash, not a nonce
 *
 * The first attempt gave this script the per-response CSP nonce, read from the
 * `x-nonce` header in the root layout. Running the app showed two problems:
 *
 *  1. The browser still reported a CSP violation — the nonce on the element did not
 *     match the one in the header for every render pass.
 *  2. React reported a hydration mismatch: server HTML had `nonce="…"` and the
 *     client tree had `nonce=""`. React deliberately does not carry the nonce into
 *     the client props, so any nonced inline script in the tree mismatches.
 *
 * The script is *static*, so it does not need a nonce at all — a hash is the right
 * primitive. `THEME_INIT_SCRIPT_SHA256` below is the base64 SHA-256 of exactly the
 * string in `THEME_INIT_SCRIPT`, and `tests/config/csp.test.ts` recomputes it and
 * fails with the correct value if the script is ever edited. That keeps the pair in
 * step without needing `crypto.subtle` on the Edge runtime, where the CSP is built.
 */

export const THEME_INIT_SCRIPT = `
(function() {
  try {
    // Prevent theme flash - sync with next-themes
    var theme = localStorage.getItem('theme') || 'dark';
    var classList = document.documentElement.classList;
    classList.remove('light', 'dark');
    classList.add(theme);

    // Prevent accent color flash
    var accent = sessionStorage.getItem('user-accent') || 'purple';
    document.documentElement.dataset.accent = accent;

    // Landing intro: decided here so the curtain is painted with the first
    // frame instead of flashing in after hydration. It plays on every load;
    // the only opt-out is a reduced-motion preference.
    var motionOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.dataset.kairosIntro = motionOk ? 'play' : 'seen';
  } catch (e) {}
})();
`;

/**
 * Base64 SHA-256 of `THEME_INIT_SCRIPT`.
 *
 * Regenerate by running the CSP test — it prints the expected value on failure.
 */
export const THEME_INIT_SCRIPT_HASH =
  "sha256-xhY9v3jFmOlgwvq4OZzg4awAiwAZ0PY0mJYqcfFxtLg=";

/**
 * The same hash as a `script-src` source expression.
 *
 * Hash sources must be single-quoted. Without the quotes Chrome reports
 * `invalid source: sha256-…. It will be ignored.` and silently falls back to
 * blocking the script — which is exactly what happened the first time.
 */
export const THEME_INIT_SCRIPT_SHA256 = `'${THEME_INIT_SCRIPT_HASH}'`;
