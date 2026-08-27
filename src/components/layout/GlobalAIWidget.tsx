"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

import { AskKairosLauncher } from "~/components/chat/AskKairosLauncher";

/**
 * The two heavy surfaces, split out of the shared bundle.
 *
 * This component is mounted by the root layout, so whatever it imports
 * statically is downloaded and parsed before *any* page can become
 * interactive — the marketing pages and the sign-in screen included. What it
 * was importing is the assistant: `A1ChatWidgetOverlay` pulls in
 * `ProjectIntelligenceChat` (~2,500 lines), the agent picker and the composer
 * menu, and the palette pulls in its own matcher and query. None of it is on
 * screen until somebody asks for it.
 *
 * `ssr: false` is correct rather than merely convenient here: both are pure
 * client surfaces that render nothing until opened, so there is no server
 * markup worth producing and no hydration to pay for.
 *
 * The launcher stays a static import. It is the visible closed state of the
 * assistant and is small, so deferring it would only trade bytes for a pill
 * that pops in late.
 */
const A1ChatWidgetOverlay = dynamic(
  () => import("~/components/chat/A1ChatWidgetOverlay").then((m) => m.A1ChatWidgetOverlay),
  { ssr: false },
);

const CommandPalette = dynamic(
  () => import("~/components/layout/CommandPalette").then((m) => m.CommandPalette),
  { ssr: false },
);

/**
 * The global AI surfaces, rendered once in the root layout.
 *
 * Three things, all signed-in only:
 *
 * - The launcher, which is what the assistant looks like when it is closed.
 * - The floating chat widget, hidden on the full-page chat to avoid two of it.
 * - The ⌘K command palette (D-2), which is *not* hidden anywhere: the reason to
 *   have a palette at all is that it works from wherever you happen to be, and a
 *   shortcut that stops working on one page is a shortcut people stop reaching
 *   for everywhere.
 *
 * Open state lives here rather than inside the overlay because three things now
 * depend on it — the panel has to render at all (see the split above), the
 * launcher has to get out of the way, and the `kairos:openAI` event the side nav
 * dispatches has to be heard by something that is always mounted.
 */
export function GlobalAIWidget() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  /**
   * Whether the palette's code has been asked for yet.
   *
   * The palette used to own the ⌘K listener, which only works if the palette is
   * always mounted — the thing the split above is trying to avoid. So the
   * shortcut is bootstrapped here instead: this listener is the only part that
   * has to exist up front, and the first press both loads the palette and tells
   * it to open. Once armed it stays mounted and handles its own toggling, so
   * this listener takes itself off the window.
   */
  const [paletteArmed, setPaletteArmed] = useState(false);
  /**
   * A question handed to the widget from outside it — today, from clicking a
   * Risk Radar nudge on the launcher.
   *
   * `n` remounts the thread, which is the only way the prefill is actually
   * sent: `ProjectIntelligenceChat` fires it once per mount, deliberately, so
   * that it does not re-send on every render. It is bumped only when there is a
   * question to ask, so an ordinary open does not throw the thread away and
   * refetch it.
   */
  const [ask, setAsk] = useState<{ text?: string; n: number }>({ n: 0 });

  useEffect(() => {
    if (paletteArmed) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteArmed(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paletteArmed]);

  /*
   * The side nav's "Kairos AI" row dispatches this. The overlay still listens
   * for it too, for the uncontrolled case, but that listener cannot be what
   * opens the widget any more: the overlay is not mounted until `open` is true,
   * so nothing would be there to hear the event that is supposed to open it.
   */
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("kairos:openAI", handler);
    return () => window.removeEventListener("kairos:openAI", handler);
  }, []);

  if (!session) return null;

  const onChatPage = pathname === "/chat/ai";

  return (
    <>
      {paletteArmed && <CommandPalette initialOpen />}

      {!onChatPage && (
        <>
          {!open && (
            <AskKairosLauncher
              onOpen={(text) => {
                if (text) setAsk((a) => ({ text, n: a.n + 1 }));
                setOpen(true);
              }}
            />
          )}

          {open && (
            <A1ChatWidgetOverlay
              isOpen={open}
              onOpenChange={setOpen}
              onClose={() => setOpen(false)}
              prefill={ask.text}
              threadKey={ask.n}
            />
          )}
        </>
      )}
    </>
  );
}
