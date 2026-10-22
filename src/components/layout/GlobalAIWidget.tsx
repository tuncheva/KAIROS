"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { AskKairosLauncher } from "~/components/chat/AskKairosLauncher";
import { pageContextFromPath } from "~/lib/pageContext";
import { api } from "~/trpc/react";

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
   * Latches true the first time the widget is opened and never flips back.
   *
   * The overlay is a heavy component (ProjectIntelligenceChat + rehydration
   * query) that we do not want in the bundle until needed, so it is only
   * mounted after the first open. Once mounted it stays mounted for the
   * session: `A1ChatWidgetOverlay` hides itself with `display:none` instead
   * of returning null, so its internal state — the fetched conversation
   * history, the message list, the conversation id — survives close/reopen
   * without a refetch.
   */
  const [everOpened, setEverOpened] = useState(false);
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
   * A question handed to the widget from outside it — from clicking a Risk
   * Radar nudge on the launcher, or the TopBar's AI button.
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
    /* The TopBar's search field is the other way in, and the only one anybody
       discovers without being told the shortcut exists. Same arming, same
       reason it lives here: the palette is not mounted yet, so it cannot be
       the thing that hears the request to open it. */
    const onOpenRequest = () => setPaletteArmed(true);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("kairos:openPalette", onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("kairos:openPalette", onOpenRequest);
    };
  }, [paletteArmed]);

  /*
   * The side nav's "Kairos AI" row dispatches this. The overlay still listens
   * for it too, for the uncontrolled case, but that listener cannot be what
   * opens the widget any more: the overlay is not mounted until `open` is true,
   * so nothing would be there to hear the event that is supposed to open it.
   */
  useEffect(() => {
    const handler = () => { setOpen(true); setEverOpened(true); };
    window.addEventListener("kairos:openAI", handler);
    return () => window.removeEventListener("kairos:openAI", handler);
  }, []);

  /*
   * The TopBar's AI button: open over this page and ask about it.
   *
   * The question is plain words in the user's language — what they would have
   * typed — and says only "this note"; which note is not in the text but in the
   * page context the widget sends beside it, which the server resolves. On a
   * page with nothing to point at, the button just opens the widget: a question
   * about nothing would spend a request on an answer nobody wanted.
   *
   * Read from `window.location` at the moment of the click rather than from
   * hooks. This component renders in the root layout, server side included, and
   * the query string is only needed here, once, after a click.
   */
  const tAsk = useTranslations("ai.askAboutPage");
  const utils = api.useUtils();
  useEffect(() => {
    const handler = () => {
      const page = pageContextFromPath(window.location.pathname, window.location.search);
      const show = () => {
        setOpen(true);
        setEverOpened(true);
      };
      if (!page) {
        show();
        return;
      }

      /* The user's own question from Settings → AI, if they wrote one. Fetched
         on the click rather than on every page load: most page loads never
         press the button. Settings invalidates this query when it saves, so a
         change made a moment ago is the one used. A failed read is the
         built-in question, not a button that does nothing. */
      void utils.agent.settings
        .fetch(undefined, { staleTime: 60_000 })
        .then((s) => s.values["workspace_concierge.pageOpener"])
        .catch(() => "")
        .then((custom) => {
          const text = custom || tAsk(page.kind);
          // Together with the open, so the panel first appears already on the
          // new question — not on the old thread for a frame before it.
          setAsk((a) => ({ text, n: a.n + 1 }));
          show();
        });
    };
    window.addEventListener("kairos:askAboutPage", handler);
    return () => window.removeEventListener("kairos:askAboutPage", handler);
  }, [tAsk, utils]);

  if (!session) return null;

  const onChatPage = pathname === "/chat/ai";
  /* An open direct-message thread has its composer pinned to the bottom of the
     screen on a phone, exactly where the pill's bottom corners are — it sat on
     the send button. */
  const onChatThread = pathname.startsWith("/chat/");

  return (
    <>
      {paletteArmed && <CommandPalette initialOpen />}

      {!onChatPage && (
        <>
          {!open && (
            <AskKairosLauncher
              hideBelowLg={onChatThread}
              onOpen={(text) => {
                if (text) setAsk((a) => ({ text, n: a.n + 1 }));
                setOpen(true);
                setEverOpened(true);
              }}
            />
          )}

          {/* Mounted on first open, then kept alive for the session so the
              conversation history survives close/reopen without re-fetching. */}
          {everOpened && (
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
