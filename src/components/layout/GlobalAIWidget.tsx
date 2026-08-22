"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

import { A1ChatWidgetOverlay } from "~/components/chat/A1ChatWidgetOverlay";
import { AskKairosLauncher } from "~/components/chat/AskKairosLauncher";
import { CommandPalette } from "~/components/layout/CommandPalette";

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
 * Open state lives here rather than inside the overlay because two components
 * now depend on it — the panel has to render, and the launcher has to get out
 * of the way. The overlay still opens itself from the `kairos:openAI` event the
 * side nav dispatches; it reports that back through `onOpenChange`.
 */
export function GlobalAIWidget() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
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

  if (!session) return null;

  const onChatPage = pathname === "/chat/ai";

  return (
    <>
      <CommandPalette />

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

          <A1ChatWidgetOverlay
            isOpen={open}
            onOpenChange={setOpen}
            onClose={() => setOpen(false)}
            prefill={ask.text}
            threadKey={ask.n}
          />
        </>
      )}
    </>
  );
}
