"use client";

import { useState } from "react";
import { Brain, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";

import { ProjectIntelligenceChat } from "~/components/projects/ProjectIntelligenceChat";
import { useEntitlement } from "~/hooks/useEntitlements";
import { api } from "~/trpc/react";

import { AUTO_AGENT, AgentPicker } from "./AgentPicker";
import { MemoryPanel } from "./MemoryPanel";
import { ToolInspector } from "./ToolInspector";

interface Props {
  projectId?: number;
  prefill?: string;
}

/**
 * The expanded assistant: pick an agent, see its tools, edit what it remembers.
 *
 * Rendered only when the floating widget is maximised. The compact widget keeps
 * rendering the chat alone — three panes in a 400px window is not a workspace,
 * and the quick-ask surface people already use should not change shape because
 * a feature was added elsewhere.
 *
 * `ProjectIntelligenceChat` is embedded unchanged. It gained two props and no
 * new behaviour, so every other place it is mounted is unaffected.
 */
export function AgentWorkspace({ projectId, prefill }: Props) {
  const t = useTranslations("agents");

  const [selected, setSelected] = useState<string>(AUTO_AGENT);
  const [toolsUsed, setToolsUsed] = useState<string[]>([]);
  const [rail, setRail] = useState<"tools" | "memory">("tools");

  const agentsQuery = api.agent.agents.useQuery(undefined, {
    // Static content — the roster does not change while the app is open.
    staleTime: Infinity,
  });
  const canAddCustomTools = useEntitlement("customTools");

  const agents = agentsQuery.data ?? [];
  const activeAgentId = selected === AUTO_AGENT ? null : selected;

  // Auto has no single agent to inspect, so the inspector shows A1's tools:
  // that is what a routed turn actually runs before it decides to hand off.
  const inspected =
    agents.find((a) => a.id === (activeAgentId ?? "workspace_concierge")) ?? null;

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 md:block dark:border-white/[0.06]">
        <AgentPicker
          agents={agents}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            // The previous turn's lookups belong to the previous agent.
            setToolsUsed([]);
          }}
        />
      </aside>

      <main className="min-w-0 flex-1">
        <ProjectIntelligenceChat
          // Remount on agent change: the chat holds the rendered thread in local
          // state, and continuing it under a different agent would attribute the
          // bubbles already on screen to one that never produced them.
          key={selected}
          projectId={projectId}
          prefill={prefill}
          pinnedAgentId={activeAgentId ?? undefined}
          onToolsUsed={setToolsUsed}
          // The expanded surface is where a thread runs long enough to be worth
          // deleting, and where there is room for the control.
          showNewChat
        />
      </main>

      <aside className="hidden w-80 shrink-0 flex-col border-l border-slate-200 lg:flex dark:border-white/[0.06]">
        <div className="flex shrink-0 gap-1 border-b border-slate-200 p-2 dark:border-white/[0.06]">
          <button
            type="button"
            onClick={() => setRail("tools")}
            aria-pressed={rail === "tools"}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
              rail === "tools"
                ? "bg-accent-primary/10 text-accent-primary"
                : "text-fg-secondary hover:bg-bg-secondary/60"
            }`}
          >
            <Wrench className="h-3.5 w-3.5" />
            {t("tools")}
          </button>
          <button
            type="button"
            onClick={() => setRail("memory")}
            aria-pressed={rail === "memory"}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
              rail === "memory"
                ? "bg-accent-primary/10 text-accent-primary"
                : "text-fg-secondary hover:bg-bg-secondary/60"
            }`}
          >
            <Brain className="h-3.5 w-3.5" />
            {t("memory")}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {rail === "tools" ? (
            <ToolInspector
              agent={inspected}
              used={toolsUsed}
              canAddCustomTools={canAddCustomTools}
            />
          ) : (
            <MemoryPanel agents={agents} activeAgentId={activeAgentId} />
          )}
        </div>
      </aside>
    </div>
  );
}
