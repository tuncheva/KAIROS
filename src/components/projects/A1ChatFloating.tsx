"use client";

import { useState } from "react";
import { MessageSquare, X } from "~/components/ui/icons";
import { ProjectIntelligenceChat } from "./ProjectIntelligenceChat";

/**
 * UI-only floating launcher for Agent A1 chat.
 *
 * IMPORTANT:
 * - This component must not change agent logic. It only shows/hides existing chat UI.
 */
export function A1ChatFloating(props: { projectId?: number }) {
  const { projectId } = props;

  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Floating open button */}
      <button
        type="button"
        className="kairos-a1-fab"
        aria-label="Open Assistant"
        onClick={() => setIsOpen(true)}
      >
        <MessageSquare size={20} />
      </button>

      {/* Floating panel */}
      {isOpen && (
        <div className="kairos-a1-floating-panel" role="dialog" aria-label="Assistant">
          <div className="kairos-a1-floating-panel-inner">
            <button
              type="button"
              className="kairos-a1-floating-close"
              aria-label="Close Assistant"
              onClick={() => setIsOpen(false)}
            >
              <X size={18} />
            </button>

            <ProjectIntelligenceChat projectId={projectId} />
          </div>
        </div>
      )}
    </>
  );
}
