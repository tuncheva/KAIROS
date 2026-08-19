import "~/styles/globals.css";
import "react-chat-elements/dist/main.css";

import { type Metadata } from "next";
import { headers } from "next/headers";
import { Nunito_Sans } from "next/font/google";
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

const display = Nunito_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["700", "800", "900"],
  variable: "--font-display",
  display: "swap",
});

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  const locale = await getLocale();
  const messages = await getMessages();

  // Per-response CSP nonce, set by `src/proxy.ts`. Next.js stamps its own script
  // tags automatically; the hand-written theme script below needs it applied by
  // hand or the CSP will refuse to run it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang={locale} className={`${sans.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `
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
  } catch (e) {}
})();
            `,
          }}
        />
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
                <ThemeProvider>
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