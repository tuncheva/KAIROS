/**
 * The landmark the three auth pages were missing.
 *
 * The root layout renders a "skip to content" link pointing at `#main-content`.
 * Every page under `(app)` provides that id; none of the `(auth)` pages did, so
 * on exactly the screens a keyboard user meets first — reset password, verify
 * email, security — the skip link resolved to nothing and the page had no
 * `<main>` landmark at all.
 *
 * A layout rather than an edit to each page: two of the three have several
 * early returns, and one `<main>` per branch is three chances for the next
 * branch to forget.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main id="main-content">{children}</main>;
}
