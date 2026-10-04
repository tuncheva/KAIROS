import "~/styles/globals.css";

import { type Metadata, type Viewport } from "next";
// Self-hosted (see styles/fonts.css for why not next/font/google).
import "@fontsource-variable/nunito-sans/wght.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/playfair-display/wght.css";
import "@fontsource-variable/playfair-display/wght-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource-variable/source-serif-4/wght.css";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "~/styles/fonts.css";
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';

import { TRPCReactProvider } from "~/trpc/react";
import { auth } from "~/server/auth";
import NextAuthSessionProvider from "~/components/providers/SessionProvider";
import { ThemeProvider } from "~/components/providers/ThemeProvider";
import { ToastProvider } from "~/components/providers/ToastProvider";
import { UserPreferencesProvider } from "~/components/providers/UserPreferencesProvider";
import { SocketProvider } from "~/components/providers/SocketProvider";
import WebSocketInitializer from "~/components/layout/WebSocketInitializer";
import { GlobalAIWidget } from "~/components/layout/GlobalAIWidget";
import { OnboardingSheet } from "~/components/onboarding/OnboardingSheet";
import { headers } from "next/headers";
import { THEME_INIT_SCRIPT } from "~/server/http/themeInitScript";

export const metadata: Metadata = {
  title: "KAIROS",
  description: "Coordinate events, manage projects, and collaborate with your team",
  icons: {
    icon: [{ url: "/logo_white.png" }],
    // iOS uses this for the Home Screen tile; the transparent logo rendered as
    // white-on-black-on-nothing without it.
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  // Lets iOS render the app full-screen when it is saved to the home screen,
  // which is the only way the status-bar area is ours to paint.
  appleWebApp: { capable: true, title: "KAIROS", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

/**
 * `viewportFit: "cover"` is the line that matters most on a phone.
 *
 * Without it the page is laid out inside the notch-free "safe" rectangle and
 * every `env(safe-area-inset-*)` resolves to `0px` — which is why the bottom
 * nav's `pb-[calc(0.5rem+env(safe-area-inset-bottom))]` was, until now, just
 * `pb-2` on every iPhone and sat underneath the home indicator. With `cover`
 * the page fills the display and the insets carry real values, so the shell can
 * pad itself out of the notch, the home indicator and the landscape ears.
 *
 * `maximumScale`/`userScalable` are deliberately left at their permissive
 * defaults: blocking pinch-zoom is an accessibility failure, and the usual
 * reason people reach for it — iOS zooming in when you focus a field under
 * 16px — is fixed properly in `globals.css` instead.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0f" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  // Per-response CSP nonce from `src/proxy.ts`. Only next-themes needs it: Next
  // stamps its own script tags from the CSP header, and our theme script is allowed
  // by hash instead (a nonce on it caused a hydration mismatch).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const locale = await getLocale();
  const messages = await getMessages();


  // Instrument Serif carries no Cyrillic glyphs; `bg` falls back to a serif
  // that does rather than to whatever the OS picks.
  const display = locale === "bg" ? "font-display-cyrillic" : "font-display-latin";

  return (
    <html lang={locale} className={`font-vars ${display}`} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint. Allowed by hash rather
            than nonce; the script text and its hash live together in
            `~/server/http/themeInitScript` with a test keeping them in step. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-bg-primary text-fg-primary font-sans antialiased" suppressHydrationWarning>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <NextIntlClientProvider messages={messages} locale={locale}>
          <TRPCReactProvider>
            <NextAuthSessionProvider session={session}>
              <SocketProvider>
                <WebSocketInitializer />
                <ThemeProvider nonce={nonce}>
                  <ToastProvider>
                    <UserPreferencesProvider>
                      {children}
                      <GlobalAIWidget />
                      <OnboardingSheet />
                    </UserPreferencesProvider>
                  </ToastProvider>
                </ThemeProvider>
              </SocketProvider>
            </NextAuthSessionProvider>
          </TRPCReactProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}