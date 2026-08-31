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
    // localStorage: the accent is a durable preference. It lived in
    // sessionStorage, which is per-tab, so every new tab painted the default
    // and corrected itself once the settings query resolved.
    var accent = localStorage.getItem('user-accent')
      || sessionStorage.getItem('user-accent')
      || 'purple';
    document.documentElement.dataset.accent = accent;

    // Landing intro: decided here so the curtain is painted with the first
    // frame instead of flashing in after hydration. Once per browser, not once
    // per load — it used to replay on every visit to '/', which includes the
    // landing you are dropped on immediately after signing out. A three-second
    // wordmark is a welcome; on the fourth viewing it is a wait.
    var motionOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var introSeen = localStorage.getItem('kairos:introSeen') === 'true';
    document.documentElement.dataset.kairosIntro =
      motionOk && !introSeen ? 'play' : 'seen';

    // Nav rail: the pin feeds --rail-w, and every page's .rail-offset takes its
    // margin from that. Read after hydration instead, the rail opened and the
    // whole page slid sideways a frame after each load. Setting it here means
    // the first paint already has the right width.
    document.documentElement.dataset.railPinned =
      localStorage.getItem('kairos:railPinned') === 'true' ? 'true' : 'false';

    // Notification/toast anchors. One preference: the popups take the chosen
    // corner and the toasts take the diagonally opposite one, except that
    // bottom-right belongs to Ask Kairos and is never used by either. Set
    // here rather than after hydration because a toast can fire before React
    // has mounted, and it must not appear in the default corner and jump.
    // Mirrors ~/lib/notificationPosition; tests/lib/notificationPosition.test.ts
    // asserts the two stay in step.
    var slots = ['top-left','top-center','top-right','bottom-left','bottom-center','bottom-right'];
    var pos = localStorage.getItem('kairos:notifPosition');
    if (slots.indexOf(pos) === -1) pos = 'top-right';
    var opposite = {
      'top-left': 'bottom-center',
      'top-center': 'bottom-left',
      'top-right': 'bottom-left',
      'bottom-left': 'top-right',
      'bottom-center': 'top-right',
      'bottom-right': 'top-left'
    };
    var flex = { start: 'flex-start', center: 'center', end: 'flex-end' };
    var axes = function (value) {
      var parts = value.split('-');
      return {
        block: parts[0] === 'top' ? 'start' : 'end',
        inline: parts[1] === 'left' ? 'start' : parts[1] === 'right' ? 'end' : 'center'
      };
    };
    var notif = axes(pos);
    var toast = axes(opposite[pos]);
    var root = document.documentElement;
    root.dataset.notifBlock = notif.block;
    root.dataset.notifInline = notif.inline;
    root.dataset.toastBlock = toast.block;
    root.dataset.toastInline = toast.inline;
    root.style.setProperty('--notif-anchor-block', flex[notif.block]);
    root.style.setProperty('--notif-anchor-inline', flex[notif.inline]);
    root.style.setProperty('--toast-anchor-block', flex[toast.block]);
    root.style.setProperty('--toast-anchor-inline', flex[toast.inline]);
  } catch (e) {}
})();
`;

/**
 * Base64 SHA-256 of `THEME_INIT_SCRIPT`.
 *
 * Regenerate by running the CSP test — it prints the expected value on failure.
 */
export const THEME_INIT_SCRIPT_HASH =
  "sha256-FN/ks45esil8S0zaGHI2xW14cBUa+QAMqX09mzQE0OQ=";

/**
 * The same hash as a `script-src` source expression.
 *
 * Hash sources must be single-quoted. Without the quotes Chrome reports
 * `invalid source: sha256-…. It will be ignored.` and silently falls back to
 * blocking the script — which is exactly what happened the first time.
 */
export const THEME_INIT_SCRIPT_SHA256 = `'${THEME_INIT_SCRIPT_HASH}'`;
