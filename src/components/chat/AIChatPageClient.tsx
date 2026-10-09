"use client";

import { useEffect, useMemo, useState } from "react";
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
} from "~/components/ui/icons";
import { useTranslations } from "next-intl";

import { AUTO_AGENT } from "~/components/agents/AgentPicker";
import { useAgentLabel } from "~/components/agents/useAgentLabel";
import { MemoryPanel } from "~/components/agents/MemoryPanel";
import { ToolInspector } from "~/components/agents/ToolInspector";
import { ProjectIntelligenceChat } from "~/components/projects/ProjectIntelligenceChat";
import { useEntitlement } from "~/hooks/useEntitlements";
import { api } from "~/trpc/react";

import { ChatDialog } from "./ChatDialog";
import { CHAT_ICON_BUTTON, CHAT_PANE, chatPill } from "./chatUi";
import { ComposerMenu } from "./ComposerMenu";
import { EffortMenu, useReasoningEffort } from "./EffortMenu";
import { AiThreadRail } from "./AiThreadRail";
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
  const agentLabels = useAgentLabel();
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
  /* Below `lg` the rail is not a column but a drawer. Its own flag, so opening
     it on a phone never un-collapses the desktop rail and vice versa. */
  const [threadsDrawerOpen, setThreadsDrawerOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("trail");

  const [selectedAgent, setSelectedAgent] = useState<string>(AUTO_AGENT);
  const [scope, setScope] = useState<string>(ALL_PROJECTS);
  const reasoning = useReasoningEffort();

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
      : agents.some((a) => a.id === selectedAgent)
        ? agentLabels.name(selectedAgent)
        : tAgents("auto");

  useEffect(() => {
    if (!threadsDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setThreadsDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threadsDrawerOpen]);

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
              label: agentLabels.name(a.id, a.name),
              description: `${agentLabels.role(a.id, a.role)} — ${a.description}`,
            })),
          // Scheduled agents are listed but not selectable: they have no chat
          // surface, and hiding them leaves a user wondering where the daily
          // brief comes from.
          ...agents
            .filter((a) => a.kind === "scheduled")
            .map((a) => ({
              id: a.id,
              label: agentLabels.name(a.id, a.name),
              description: `${agentLabels.role(a.id, a.role)} — ${a.description}`,
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

      <EffortMenu selected={reasoning.selected} onSelect={reasoning.select} />
    </>
  );

  return (
    <div className="chat-refined tui-screen flex h-full w-full gap-4 overflow-hidden p-2 text-tui-ink sm:px-6 sm:pt-5 sm:pb-6">
      {railOpen && (
        <div className="hidden min-h-0 w-[312px] flex-none lg:flex">
          <AiThreadRail
            conversations={conversations}
            loading={conversationsQuery.isLoading}
            activeId={activeId}
            onSelect={openThread}
            onNew={startNewThread}
            onCollapse={() => setRailOpen(false)}
          />
        </div>
      )}

      {/* Phones and tablets. The column above is `lg:` only, and without this
          the rail was simply gone below it — no way back to an earlier thread
          and no "new conversation" either. */}
      {threadsDrawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={() => setThreadsDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("showConversations")}
            className="fixed inset-y-2 left-2 z-50 flex w-[312px] max-w-[85vw] lg:hidden"
          >
            <AiThreadRail
              conversations={conversations}
              loading={conversationsQuery.isLoading}
              activeId={activeId}
              onSelect={(id) => {
                setThreadsDrawerOpen(false);
                openThread(id);
              }}
              onNew={() => {
                setThreadsDrawerOpen(false);
                startNewThread();
              }}
              onCollapse={() => setThreadsDrawerOpen(false)}
            />
          </div>
        </>
      )}

      <section
        className={`${CHAT_PANE} flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden`}
      >
        {/* ---- Header ---- */}
        <header className="flex flex-none items-center gap-3 border-b border-tui-ink/8 py-[18px] pr-4 pl-3 sm:gap-3.5 sm:pr-5 sm:pl-6">
          <button
            type="button"
            onClick={() => setThreadsDrawerOpen(true)}
            title={t("showConversations")}
            aria-label={t("showConversations")}
            className={`${CHAT_ICON_BUTTON} h-9 w-9 lg:hidden`}
          >
            <PanelLeftOpen size={15} />
          </button>
          {!railOpen && (
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              title={t("showConversations")}
              aria-label={t("showConversations")}
              className={`${CHAT_ICON_BUTTON} hidden h-9 w-9 lg:grid`}
            >
              <PanelLeftOpen size={15} />
            </button>
          )}

          {/* The assistant's mark, where a person's face sits in a direct chat. */}
          <span
            className="grid h-[42px] w-[42px] flex-none place-items-center rounded-full border border-tui-accent/45 text-tui-accent"
            aria-hidden="true"
          >
            <Sparkles size={17} />
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <h1 className="truncate font-display text-[23px] leading-[1.1] tracking-[-0.01em]">
              {activeRow?.title?.trim() ?? t("newConversation")}
            </h1>
            <p className={`truncate text-[12.5px] ${busy ? "text-tui-accent" : "text-tui-ink3"}`}>
              {activeAgentLabel}
              {activeRow ? (
                <>
                  <span aria-hidden> · </span>
                  {t("messageCount", { count: activeRow.messageCount })}
                </>
              ) : null}
            </p>
          </div>

          {scopeProject && (
            <span className="hidden h-7 max-w-[220px] items-center gap-[7px] rounded-full border border-tui-ink/16 px-3 text-[12.5px] text-tui-ink2 md:flex">
              <FolderKanban size={12} className="flex-none text-tui-ink3" />
              <span className="truncate">{scopeProject.title}</span>
            </span>
          )}

          <button
            type="button"
            data-testid="delete-conversation"
            onClick={() => {
              setDeleteError(null);
              setConfirmDelete(true);
            }}
            disabled={!activeId}
            title={t("delete")}
            aria-label={t("delete")}
            className={`${CHAT_ICON_BUTTON} h-9 w-9 enabled:hover:border-tui-danger/40 enabled:hover:bg-tui-danger/8 enabled:hover:text-tui-danger disabled:cursor-not-allowed`}
          >
            <Trash2 size={15} />
          </button>
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
            effort={reasoning.effort}
            onToolsUsed={setToolsUsed}
            onTrail={setTrail}
            onBusyChange={setBusy}
            composerControls={composerControls}
          />
        </div>
      </section>

      {/* ---- Right rail ---- */}
      <aside
        className={`${CHAT_PANE} kairos-console-rail hidden min-h-0 w-[332px] flex-none flex-col overflow-hidden xl:flex`}
      >
        <div
          className="flex flex-none flex-wrap gap-1.5 border-b border-tui-ink/8 px-4 pt-4 pb-3.5"
          role="tablist"
        >
          {(
            [
              ["trail", t("tabTrail"), ListTree],
              ["memory", tAgents("memory"), Brain],
              ["tools", tAgents("tools"), Wrench],
              // Short label deliberately: four tabs share a 332px rail, and
              // "Documents" would wrap or squeeze the other three.
              ["documents", tDocs("tabShort"), FileText],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              onClick={() => setRightTab(id)}
              aria-selected={rightTab === id}
              className={`flex h-7 items-center gap-1.5 rounded-full border px-[11px] text-[12.5px] font-medium whitespace-nowrap transition-colors ${chatPill(rightTab === id)}`}
            >
              <Icon size={12} />
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
        <ChatDialog
          role="alertdialog"
          icon={<Trash2 size={17} />}
          tone="danger"
          eyebrow={activeRow?.title?.trim() ?? t("newConversation")}
          title={tChat("deleteChatTitle")}
          sub={tChat("deleteChatConfirmMessage")}
          cancelLabel={tChat("cancel")}
          closeLabel={tChat("cancel")}
          onDismiss={() => {
            setConfirmDelete(false);
            setDeleteError(null);
          }}
          primary={{
            label: deleteConversation.isPending
              ? tChat("deleting")
              : tChat("deleteAndStartOver"),
            onClick: () => void deleteActiveThread(),
            disabled: deleteConversation.isPending,
          }}
        >
          {deleteError && (
            <p
              className="mx-5 mt-4 text-[13px] text-tui-danger sm:mx-[26px]"
              role="alert"
            >
              {tChat("deleteChatFailed")} {deleteError}
            </p>
          )}
        </ChatDialog>
      )}
    </div>
  );
}
