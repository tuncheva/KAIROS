 
"use client";

import { useCallback, useMemo, useRef, useState } from"react";
import { AlertCircle, CheckCircle2, Loader2, Shield, Sparkles, Upload, X } from "~/components/ui/icons";
import { motion, AnimatePresence } from"motion/react";

import { api } from"~/trpc/react";
import { cn } from"~/lib/utils";

type PlanSummary = {
 creates: number;
 updates: number;
 statusChanges: number;
 deletes: number;
};

type A2Plan = {
 agentId:"task_planner";
 scope: { orgId?: string | number; projectId: number };
 creates: Array<{ title: string; priority: string; clientRequestId: string }>;
 updates: Array<{ taskId: number }>;
 statusChanges: Array<{ taskId: number; status: string }>;
 deletes: Array<{ taskId: number; dangerous: boolean }>;
 risks: string[];
 questionsForUser: string[];
 diffPreview: {
 creates: string[];
 updates: string[];
 statusChanges: string[];
 deletes: string[];
 };
 planHash?: string;
};

export function AiTaskPlannerPanel(props: {
 projectId: number;
 orgId?: string | number;
 onApplied?: () => void;
 onClose?: () => void;
}) {
 const { projectId, orgId, onApplied, onClose } = props;

 const [message, setMessage] = useState<string>(
"Create a detailed task plan for this project. Keep it actionable, dedupe existing tasks, and include a clear diff preview.",
 );

 const [draftId, setDraftId] = useState<string | null>(null);
 const [plan, setPlan] = useState<A2Plan | null>(null);
 const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
 const [confirmSummary, setConfirmSummary] = useState<PlanSummary | null>(null);

 // Optional PDF context (feature-light): we extract tasks via existing endpoint and prepend
 // the extracted requirements into the next A2 draft message.
 const [selectedFile, setSelectedFile] = useState<File | null>(null);
 const [pdfBase64, setPdfBase64] = useState<string | null>(null);
 const [pdfInstructions, setPdfInstructions] = useState<string>("");
 const [pdfResult, setPdfResult] = useState<null | { tasks: Array<{ title: string; description: string; priority?: string }>; reasoning?: string }>(null);
 const [approvedPdfTaskIndices, setApprovedPdfTaskIndices] = useState<Set<number>>(() => new Set());
 const fileInputRef = useRef<HTMLInputElement | null>(null);

 const draftMutation = api.agent.taskPlannerDraft.useMutation({
 onSuccess(data) {
 setDraftId(data.draftId);
 setPlan(data.plan as unknown as A2Plan);
 setConfirmationToken(null);
 setConfirmSummary(null);
 },
 });

 const confirmMutation = api.agent.taskPlannerConfirm.useMutation({
 onSuccess(data) {
 setConfirmationToken(data.confirmationToken);
 setConfirmSummary(data.summary);
 },
 });

 const applyMutation = api.agent.taskPlannerApply.useMutation({
 onSuccess() {
 onApplied?.();
 },
 });

 const pdfExtractMutation = api.agent.extractTasksFromPdf.useMutation({
 onSuccess(data) {
 setPdfResult({ tasks: data.tasks, reasoning: data.reasoning });
 setApprovedPdfTaskIndices(new Set(data.tasks.map((_, idx) => idx)));
 },
 });

 const createTaskMutation = api.task.create.useMutation({
 onSuccess() {
 onApplied?.();
 },
 });

 const isPending =
 draftMutation.isPending ||
 confirmMutation.isPending ||
 applyMutation.isPending ||
 pdfExtractMutation.isPending;

 const hasDeletes = useMemo(() => {
 const del = plan?.deletes ?? [];
 return del.some((d) => d.dangerous);
 }, [plan]);

 const handleDraft = useCallback(() => {
 const trimmed = message.trim();
 if (!trimmed) return;

 const approvedTasks = pdfResult?.tasks
 ?.map((t, idx) => ({ t, idx }))
 .filter(({ idx }) => approvedPdfTaskIndices.has(idx))
 .slice(0, 30);

 const pdfContextBlock = approvedTasks?.length
 ? `\n\nPDF extracted requirements (approved by user):\n${approvedTasks
 .map(({ t }, i) => `- ${i + 1}. ${t.title}${t.description ? ` — ${t.description}` :""}`)
 .join("\n")}\n\nNotes: ${pdfInstructions.trim() ||"(none)"}`
 :"";

 draftMutation.mutate({
 message: `${trimmed}${pdfContextBlock}`,
 scope: { orgId, projectId },
 });
 }, [approvedPdfTaskIndices, draftMutation, message, orgId, pdfInstructions, pdfResult, projectId]);

 const handleConfirm = useCallback(() => {
 if (!draftId) return;
 confirmMutation.mutate({ draftId });
 }, [confirmMutation, draftId]);

 const handleApply = useCallback(() => {
 if (!draftId || !confirmationToken) return;
 applyMutation.mutate({ draftId, confirmationToken });
 }, [applyMutation, confirmationToken, draftId]);

 return (
 <div className="bg-bg-secondary rounded-2xl overflow-hidden border border-white/[0.06]">
 <div className="px-5 py-4 flex items-center justify-between border-b border-white/[0.06]">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center text-white shadow-lg">
 <Sparkles size={18} />
 </div>
 <div>
 <h2 className="text-[15px] font-semibold text-fg-primary leading-tight">AI Task Planner</h2>
 <p className="text-[12px] text-fg-secondary leading-tight">Draft → Confirm → Apply (with audit)</p>
 </div>
 </div>

 {onClose && (
 <button
 onClick={onClose}
 className="p-2 rounded-lg text-fg-secondary hover:text-fg-primary hover:bg-bg-secondary transition"
 aria-label="Close"
 >
 <X size={18} />
 </button>
 )}
 </div>

 <div className="p-5 space-y-4">
 <div className="space-y-2">
 <label className="text-[12px] uppercase tracking-wide text-fg-secondary">What should the planner do?</label>
 <textarea
 value={message}
 onChange={(e) => setMessage(e.target.value)}
 // Allow typing even while the LLM is generating.
 // Only actions (Draft/Confirm/Apply) are blocked via button disabled states.
 disabled={false}
 rows={4}
 className={cn(
"w-full rounded-lg px-3 py-2 text-[13px] outline-none",
"bg-bg-primary text-fg-primary border border-white/[0.06]",
"focus:border-accent-primary/40",
 )}
 />
 </div>

 <div className="flex items-center gap-2">
 <button
 onClick={handleDraft}
 disabled={isPending || message.trim().length === 0}
 className={cn(
"inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition",
"bg-accent-primary text-white hover:opacity-95 disabled:opacity-50",
 )}
 >
 {draftMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
 Draft plan
 </button>

 <button
 onClick={handleConfirm}
 disabled={isPending || !draftId}
 className={cn(
"inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition",
"bg-accent-primary/10 text-accent-primary border border-accent-primary/20 hover:bg-accent-primary/20",
"disabled:opacity-50",
 )}
 >
 {confirmMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
 Confirm
 </button>

 <button
 onClick={handleApply}
 disabled={isPending || !draftId || !confirmationToken}
 className={cn(
"inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition",
"bg-emerald-600 text-white hover:opacity-95 disabled:opacity-50",
 )}
 >
 {applyMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
 Apply
 </button>
 </div>

 {/* PDF extractor (legacy endpoint) */}
 <div className="space-y-2 p-3 rounded-lg bg-bg-primary border border-white/[0.06]">
 <div className="flex items-center justify-between gap-3">
 <div>
 <div className="text-[12px] uppercase tracking-wide text-fg-secondary">PDF extractor</div>
 <div className="text-[12px] text-fg-tertiary">Upload a PDF to extract requirements/tasks and include them in the next draft.</div>
 </div>
 <input
 ref={fileInputRef}
 type="file"
 accept="application/pdf"
 className="hidden"
 onChange={(e) => {
 const file = e.target.files?.[0];
 if (!file) return;
 setSelectedFile(file);
 setPdfResult(null);
 setApprovedPdfTaskIndices(new Set());

 const reader = new FileReader();
 reader.onload = (ev) => {
 const res = ev.target?.result;
 if (typeof res ==="string") {
 const base64 = res.split(",")[1];
 setPdfBase64(base64 ?? null);
 }
 };
 reader.readAsDataURL(file);
 }}
 />
 <button
 type="button"
 className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition bg-bg-secondary text-fg-primary border border-white/[0.06] hover:opacity-95"
 onClick={() => fileInputRef.current?.click()}
 disabled={isPending}
 >
 <Upload size={16} />
 {selectedFile ?"Replace" :"Upload"}
 </button>
 </div>

 {selectedFile && (
 <div className="text-[12px] text-fg-secondary">
 Selected: <span className="text-fg-primary">{selectedFile.name}</span>
 </div>
 )}

 <div className="space-y-1">
 <label className="text-[12px] text-fg-secondary">Optional instructions for extraction</label>
 <input
 type="text"
 value={pdfInstructions}
 onChange={(e) => setPdfInstructions(e.target.value)}
 placeholder="e.g., focus on deliverables, milestones, acceptance criteria"
 className="w-full rounded-lg px-3 py-2 text-[13px] outline-none bg-bg-secondary text-fg-primary border border-white/[0.06] focus:border-accent-primary/40"
 />
 </div>

 <div className="flex flex-wrap items-center gap-2">
 <button
 type="button"
 onClick={() => {
 if (!pdfBase64) return;
 pdfExtractMutation.mutate({
 projectId,
 pdfBase64,
 fileName: selectedFile?.name ??"",
 message: pdfInstructions.trim() || undefined,
 });
 }}
 disabled={isPending || !pdfBase64}
 className={cn(
"inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-semibold transition",
"bg-accent-primary text-white hover:opacity-95 disabled:opacity-50",
"shadow-lg",
 )}
 >
 {pdfExtractMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
 Extract tasks
 </button>

 {pdfResult?.tasks?.length ? (
 <button
 type="button"
 onClick={() => {
 const approved = pdfResult.tasks
 .map((t, idx) => ({ t, idx }))
 .filter(({ idx }) => approvedPdfTaskIndices.has(idx));

 for (const { t } of approved) {
 createTaskMutation.mutate({
 projectId,
 title: t.title,
 description: t.description ??"",
 assignedToId: undefined,
 priority: (t.priority ??"medium") as"low" |"medium" |"high" |"urgent",
 dueDate: undefined,
 });
 }
 }}
 disabled={isPending || approvedPdfTaskIndices.size === 0}
 className={cn(
"inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition",
"bg-bg-secondary text-fg-primary border border-white/[0.06] hover:opacity-95 disabled:opacity-50",
 )}
 >
 <CheckCircle2 size={16} />
 Add approved to timeline
 </button>
 ) : null}

 {pdfResult && (
 <div className="text-[12px] text-fg-secondary">
 Extracted <span className="text-fg-primary">{pdfResult.tasks.length}</span> tasks. Approved:{""}
 <span className="text-fg-primary">{approvedPdfTaskIndices.size}</span>.
 </div>
 )}
 </div>

 {pdfResult?.tasks?.length ? (
 <div className="mt-2 space-y-2">
 <div className="flex items-center justify-between gap-3">
 <div className="text-[12px] uppercase tracking-wide text-fg-secondary">Extracted tasks</div>
 <div className="flex items-center gap-2">
 <button
 type="button"
 className="px-2 py-1 rounded-md text-[12px] bg-bg-secondary text-fg-primary border border-white/[0.06] hover:opacity-95"
 onClick={() => {
 setApprovedPdfTaskIndices(new Set());
 }}
 disabled={isPending}
 >
 None
 </button>
 <button
 type="button"
 className="px-2 py-1 rounded-md text-[12px] bg-bg-secondary text-fg-primary border border-white/[0.06] hover:opacity-95"
 onClick={() => {
 setApprovedPdfTaskIndices(new Set(pdfResult.tasks.map((_, idx) => idx)));
 }}
 disabled={isPending}
 >
 All
 </button>
 </div>
 </div>

 <ul className="space-y-2 text-[13px] text-fg-primary">
 {pdfResult.tasks.slice(0, 12).map((t, idx) => {
 const checked = approvedPdfTaskIndices.has(idx);
 return (
 <li key={idx} className="flex items-start gap-3">
 <input
 type="checkbox"
 className="mt-1"
 checked={checked}
 disabled={isPending}
 onChange={(e) => {
 const next = new Set(approvedPdfTaskIndices);
 if (e.target.checked) next.add(idx);
 else next.delete(idx);
 setApprovedPdfTaskIndices(next);
 }}
 />
 <div className="min-w-0">
 <div className="font-medium break-words">{t.title}</div>
 {t.description ? <div className="text-fg-secondary break-words">{t.description}</div> : null}
 </div>
 </li>
 );
 })}
 </ul>

 {pdfResult.tasks.length > 12 && (
 <div className="text-[12px] text-fg-secondary">Showing first 12 tasks. Draft will include approved tasks only (up to 30).</div>
 )}
 </div>
 ) : null}
 </div>


 <AnimatePresence>
 {(draftMutation.error ?? confirmMutation.error ?? applyMutation.error) && (
 <motion.div
 initial={{ opacity: 0, y: -6 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -6 }}
 className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20"
 >
 <AlertCircle size={16} className="mt-0.5 text-red-400" />
 <div className="text-[13px] text-fg-primary">
 {(draftMutation.error?.message ??
 confirmMutation.error?.message ??
 applyMutation.error?.message ??
"Unknown error")}
 </div>
 </motion.div>
 )}
 </AnimatePresence>

 {plan && (
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <div className="text-[12px] uppercase tracking-wide text-fg-secondary">Diff preview</div>
 <div className="text-[12px] text-fg-secondary">planHash: {plan.planHash ??"(pending)"}</div>
 </div>

 {hasDeletes && (
 <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[13px] text-fg-primary">
 This plan includes deletes. Confirm carefully before applying.
 </div>
 )}

 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 <DiffList title={`Creates (${plan.diffPreview.creates.length})`} items={plan.diffPreview.creates} />
 <DiffList title={`Updates (${plan.diffPreview.updates.length})`} items={plan.diffPreview.updates} />
 <DiffList title={`Status changes (${plan.diffPreview.statusChanges.length})`} items={plan.diffPreview.statusChanges} />
 <DiffList title={`Deletes (${plan.diffPreview.deletes.length})`} items={plan.diffPreview.deletes} />
 </div>

 {confirmSummary && (
 <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[13px] text-fg-primary">
 Confirmed: {confirmSummary.creates} creates, {confirmSummary.updates} updates, {confirmSummary.statusChanges} status changes, {confirmSummary.deletes} deletes.
 </div>
 )}

 {plan.questionsForUser?.length ? (
 <div className="p-3 rounded-lg bg-bg-primary border border-white/[0.06]">
 <div className="text-[12px] uppercase tracking-wide text-fg-secondary mb-2">Questions</div>
 <ul className="list-disc pl-5 space-y-1 text-[13px] text-fg-primary">
 {plan.questionsForUser.map((q, i) => (
 <li key={i}>{q}</li>
 ))}
 </ul>
 </div>
 ) : null}

 {plan.risks?.length ? (
 <div className="p-3 rounded-lg bg-bg-primary border border-white/[0.06]">
 <div className="text-[12px] uppercase tracking-wide text-fg-secondary mb-2">Risks</div>
 <ul className="list-disc pl-5 space-y-1 text-[13px] text-fg-primary">
 {plan.risks.map((r, i) => (
 <li key={i}>{r}</li>
 ))}
 </ul>
 </div>
 ) : null}
 </div>
 )}
 </div>
 </div>
 );
}

function DiffList(props: { title: string; items: string[] }) {
 const { title, items } = props;
 return (
 <div className="p-3 rounded-lg bg-bg-primary border border-white/[0.06]">
 <div className="text-[12px] uppercase tracking-wide text-fg-secondary mb-2">{title}</div>
 {items.length === 0 ? (
 <div className="text-[13px] text-fg-secondary">No changes</div>
 ) : (
 <ul className="space-y-1 text-[13px] text-fg-primary">
 {items.slice(0, 12).map((it, i) => (
 <li key={i} className="flex items-start gap-2">
 <span className="mt-1 w-1.5 h-1.5 rounded-full bg-accent-primary/70 shrink-0" />
 <span>{it}</span>
 </li>
 ))}
 {items.length > 12 && (
 <li className="text-[13px] text-fg-secondary">…and {items.length - 12} more</li>
 )}
 </ul>
 )}
 </div>
 );
}
