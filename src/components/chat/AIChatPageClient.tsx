"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Brain,
  FileText,
  FolderKanban,
  ListTree,
  PanelLeftOpen,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { AUTO_AGENT } from "~/components/agents/AgentPicker";
import { MemoryPanel } from "~/components/agents/MemoryPanel";
import { ToolInspector } from "~/components/agents/ToolInspector";
import { ProjectIntelligenceChat } from "~/components/projects/ProjectIntelligenceChat";
import { useEntitlement } from "~/hooks/useEntitlements";
import { api } from "~/trpc/react";

import { ComposerMenu } from "./ComposerMenu";
import { ConversationsRail } from "./ConversationsRail";
import { DocumentsPanel } from "./DocumentsPanel";
import { TurnTrailPanel } from "./TurnTrailPanel";
import type { TrailEvent } from "./trail";

const ALL_PROJECTS = "__all__";

type RightTab = "trail" | "memory" | "tools" | "documents";

/**
 * The full-page assistant, as an audit console.
 *
 * Three columns: the threads you have had, the one you are having, and the
 * evidence behind the turn on screen. The outer two are the reason this page
 * exists at all — the floating widget already answers questions, and what it
 * cannot do is let you go back to a thread from Tuesday or check which records
 * an answer was actually built from.
 *
 * Everything here is chrome. The turn itself still runs through
 * `ProjectIntelligenceChat` and the same draft → confirm → apply path, so a
 * write is no more automatic on this page than it is in the widget.
 */
export function AIChatPageClient() {
  const t = useTranslations("aiConsole");
  const tChat = useTranslations("chat");
  const tAgents = useTranslations("agents");
  const tDocs = useTranslations("documents");

  const searchParams = useSearchParams();
  const prefill = searchParams.get("prefill") ?? undefined;

  const utils = api.useUtils();

  /**
   * `thread` is what the chat is mounted against; `activeId` is what the rail
   * highlights and the header names.
   *
   * They are separate because a fresh thread acquires its id mid-turn. If the
   * chat were keyed on the id, the first answer would arrive, the id would
   * change from null to a string, and React would remount the component and
   * throw away the very transcript that had just been written. So the key only
   * moves when the *user* changes threads.
   */
  const [thread, setThread] = useState<{ key: number; id: string | null }>({
    key: 0,
    // `undefined` would mean "restore the most recent thread". On first load
    // that is exactly right, and it is what the widget has always done.
    id: null,
  });
  const [restoreLatest, setRestoreLatest] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [railOpen, setRailOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightTab>("trail");

  const [selectedAgent, setSelectedAgent] = useState<string>(AUTO_AGENT);
  const [scope, setScope] = useState<string>(ALL_PROJECTS);

  const [trail, setTrail] = useState<TrailEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [toolsUsed, setToolsUsed] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /* ---------------------------------------------------------------- */
  /*  Data                                                            */
  /* ---------------------------------------------------------------- */

  const conversationsQuery = api.agent.conversations.useQuery(
    { limit: 30 },
    { refetchOnWindowFocus: false },
  );

  const agentsQuery = api.agent.agents.useQuery(undefined, {
    // Static content — the roster does not change while the app is open.
    staleTime: Infinity,
  });

  const projectsQuery = api.project.getMyProjects.useQuery(undefined, {
    staleTime: 60_000,
  });

  const deleteConversation = api.agent.deleteConversation.useMutation();
  const canAddCustomTools = useEntitlement("customTools");

  const conversations = useMemo(
    () => conversationsQuery.data ?? [],
    [conversationsQuery.data],
  );
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const projects = useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data],
  );

  const pinnedAgentId = selectedAgent === AUTO_AGENT ? undefined : selectedAgent;
  const scopeProjectId = scope === ALL_PROJECTS ? undefined : Number(scope);

  /*
   * Auto has no single agent to inspect, so the inspector falls back to A1's
   * tools: those are what a routed turn actually runs before it decides who to
   * hand off to.
   */
  const inspectedAgent =
    agents.find((a) => a.id === (pinnedAgentId ?? "workspace_concierge")) ??
    null;

  const activeRow = conversations.find((c) => c.id === activeId) ?? null;
  const scopeProject = projects.find((p) => String(p.id) === scope) ?? null;

  const activeAgentLabel =
    selectedAgent === AUTO_AGENT
      ? tAgents("auto")
      : (agents.find((a) => a.id === selectedAgent)?.name ?? tAgents("auto"));

  /* ---------------------------------------------------------------- */
  /*  Thread switching                                                */
  /* ---------------------------------------------------------------- */

  function openThread(id: string) {
    if (id === activeId && !restoreLatest) return;
    setRestoreLatest(false);
    setThread((prev) => ({ key: prev.key + 1, id }));
    setActiveId(id);
    setTrail([]);
    setToolsUsed([]);
    setBusy(false);
  }

  function startNewThread() {
    setRestoreLatest(false);
    setThread((prev) => ({ key: prev.key + 1, id: null }));
    setActiveId(null);
    setTrail([]);
    setToolsUsed([]);
    setBusy(false);
  }

  /**
   * Throw the thread away — on the server as well as on screen.
   *
   * Clearing the view alone would not be deleting anything: the conversation id
   * would still ride along with the next message and the model would keep
   * replaying a history the user believes is gone. The row goes first, and the
   * screen is only cleared once it has.
   */
  async function deleteActiveThread() {
    if (!activeId) {
      setConfirmDelete(false);
      startNewThread();
      return;
    }

    setDeleteError(null);
    try {
      await deleteConversation.mutateAsync({ conversationId: activeId });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      return;
    }

    setConfirmDelete(false);
    startNewThread();
    void utils.agent.conversations.invalidate();
    void utils.agent.latestConversation.invalidate();
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  const composerControls = (
    <>
      <ComposerMenu
        tone="accent"
        title={tAgents("chooseAgent")}
        label={activeAgentLabel}
        icon={<Sparkles className="h-3.5 w-3.5 shrink-0" />}
        selected={selectedAgent}
        onSelect={setSelectedAgent}
        options={[
          {
            id: AUTO_AGENT,
            label: tAgents("auto"),
            description: tAgents("autoDescription"),
          },
          ...agents
            .filter((a) => a.kind === "conversational")
            .map((a) => ({
              id: a.id,
              label: a.name,
              description: a.description,
            })),
          // Scheduled agents are listed but not selectable: they have no chat
          // surface, and hiding them leaves a user wondering where the daily
          // brief comes from.
          ...agents
            .filter((a) => a.kind === "scheduled")
            .map((a) => ({
              id: a.id,
              label: a.name,
              description: a.description,
              disabled: true,
            })),
        ]}
      />

      <ComposerMenu
        title={t("scopeTitle")}
        label={scopeProject?.title ?? t("allProjects")}
        icon={<FolderKanban className="h-3.5 w-3.5 shrink-0" />}
        selected={scope}
        onSelect={setScope}
        options={[
          { id: ALL_PROJECTS, label: t("allProjects"), description: t("allProjectsHint") },
          ...projects.map((p) => ({ id: String(p.id), label: p.title })),
        ]}
      />
    </>
  );

  return (
    <div className="flex h-full min-h-0 w-full">
      {railOpen && (
        <div className="hidden lg:flex">
          <ConversationsRail
            conversations={conversations}
            loading={conversationsQuery.isLoading}
            activeId={activeId}
            onSelect={openThread}
            onNew={startNewThread}
            onCollapse={() => setRailOpen(false)}
          />
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {/* ---- Header ---- */}
        <header className="flex h-[60px] shrink-0 items-center justify-between gap-5 border-b border-border-medium/60 bg-bg-surface px-5">
          <div className="flex min-w-0 items-center gap-3">
            {!railOpen && (
              <button
                type="button"
                onClick={() => setRailOpen(true)}
                title={t("showConversations")}
                aria-label={t("showConversations")}
                className="hidden items-center gap-2 rounded-[7px] border border-border-medium/70 px-2.5 py-1.5 text-fg-secondary transition-colors hover:bg-bg-tertiary lg:flex"
              >
                <PanelLeftOpen className="h-[15px] w-[15px]" />
                <span className="kairos-stamp text-[10px]">
                  {conversations.length}
                </span>
              </button>
            )}

            <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg-primary">
              {activeRow?.title?.trim() ?? t("newConversation")}
            </h1>

            {scopeProject && (
              <span className="kairos-stamp hidden shrink-0 rounded-[5px] border border-border-medium/70 px-2 py-1 text-[10px] text-fg-tertiary sm:inline">
                {scopeProject.title}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              data-testid="delete-conversation"
              onClick={() => {
                setDeleteError(null);
                setConfirmDelete(true);
              }}
              disabled={!activeId}
              className="kairos-stamp flex items-center gap-1.5 rounded-[7px] border border-border-medium/70 px-2.5 py-1.5 text-[10px] text-fg-secondary transition-colors hover:border-red-400/40 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-3 w-3" />
              <span className="hidden sm:inline">{t("delete")}</span>
            </button>
          </div>
        </header>

        {/* ---- Thread ---- */}
        <div className="min-h-0 flex-1">
          <ProjectIntelligenceChat
            key={thread.key}
            variant="console"
            hideHeader
            // On first load the page restores the most recent thread, exactly as
            // the widget does. Once the user has picked one, the choice is
            // explicit and `undefined` would silently override it.
            conversationId={restoreLatest ? undefined : thread.id}
            onConversationChange={(id) => {
              setActiveId(id);
              // The row does not exist in the rail until the first turn has been
              // stored, and its title is written server-side from that turn.
              void utils.agent.conversations.invalidate();
            }}
            projectId={scopeProjectId}
            prefill={prefill}
            pinnedAgentId={pinnedAgentId}
            onToolsUsed={setToolsUsed}
            onTrail={setTrail}
            onBusyChange={setBusy}
            composerControls={composerControls}
          />
        </div>
      </main>

      {/* ---- Right rail ---- */}
      <aside className="kairos-console-rail hidden w-[332px] shrink-0 flex-col border-l border-border-medium/60 bg-bg-surface xl:flex">
        <div className="flex shrink-0 gap-1.5 px-4 pt-3.5">
          {(
            [
              ["trail", t("tabTrail"), ListTree],
              ["memory", tAgents("memory"), Brain],
              ["tools", tAgents("tools"), Wrench],
              // Short label deliberately: four tabs share a 332px rail, and
              // "Documents" at 10px would wrap or squeeze the other three.
              ["documents", tDocs("tabShort"), FileText],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setRightTab(id)}
              aria-pressed={rightTab === id}
              className={`kairos-stamp flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] transition-colors ${
                rightTab === id
                  ? "bg-accent-primary/10 text-accent-primary"
                  : "text-fg-tertiary hover:bg-bg-tertiary"
              }`}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden pt-1">
          {rightTab === "trail" ? (
            <TurnTrailPanel events={trail} running={busy} />
          ) : rightTab === "memory" ? (
            <MemoryPanel agents={agents} activeAgentId={pinnedAgentId ?? null} />
          ) : rightTab === "documents" ? (
            <DocumentsPanel />
          ) : (
            <ToolInspector
              agent={inspectedAgent}
              used={toolsUsed}
              canAddCustomTools={canAddCustomTools}
            />
          )}
        </div>
      </aside>

      {/* ---- Delete confirmation ---- */}
      {confirmDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border border-border-medium bg-bg-primary p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-fg-primary">
              {tChat("deleteChatTitle")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
              {tChat("deleteChatConfirmMessage")}
            </p>

            {deleteError && (
              <p className="mt-3 text-sm text-red-400">
                {tChat("deleteChatFailed")} {deleteError}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  setDeleteError(null);
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-fg-secondary transition-colors hover:bg-bg-surface"
              >
                {tChat("cancel")}
              </button>
              <button
                type="button"
                data-testid="delete-conversation-confirm"
                onClick={() => void deleteActiveThread()}
                disabled={deleteConversation.isPending}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {deleteConversation.isPending
                  ? tChat("deleting")
                  : tChat("deleteAndStartOver")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
