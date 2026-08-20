import "~/styles/globals.css";
import "react-chat-elements/dist/main.css";

import { type Metadata } from "next";
import { Nunito_Sans, Instrument_Serif, Playfair_Display } from "next/font/google";
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
import { headers } from "next/headers";
import { THEME_INIT_SCRIPT } from "~/server/http/themeInitScript";

export const metadata: Metadata = {
  title: "KAIROS",
  description: "Coordinate events, manage projects, and collaborate with your team",
  icons: [{ rel: "icon", url: "/logo_white.png" }],
};

const sans = Nunito_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["200", "300", "400", "600", "700", "800", "900"],
  variable: "--font-geist-sans",
  display: "swap",
});

// Display face for the landing page and headings. Instrument Serif has no
// Cyrillic, so the Bulgarian locale gets Playfair Display instead — both are
// bound to `--font-display`, and only one class lands on <html> per request.
const displayLatin = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const displayCyrillic = Playfair_Display({
  subsets: ["latin", "cyrillic"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

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
  const display = locale === "bg" ? displayCyrillic : displayLatin;

  return (
    <html lang={locale} className={`${sans.variable} ${display.variable}`} suppressHydrationWarning>
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