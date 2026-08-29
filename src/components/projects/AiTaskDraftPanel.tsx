 
"use client";

import { useState, useRef, useCallback } from"react";
import {
 Sparkles,
 FileText,
 Upload,
 X,
 Plus,
 CheckCircle2,
 AlertCircle,
 Loader2,
 BrainCircuit
} from "~/components/ui/icons";
import { motion, AnimatePresence } from"motion/react";
import { useTranslations } from"next-intl";
import { api } from"~/trpc/react";
import { cn } from"~/lib/utils";
import type { GeneratedTask } from"~/server/llm/schemas/taskGenerationSchemas";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface AiTaskDraftPanelProps {
 projectId: number;
 projectTitle: string;
 projectDescription: string | null;
 onAddTask: (task: {
 title: string;
 description: string;
 priority:"low" |"medium" |"high" |"urgent";
 dueDate?: Date;
 }) => void;
 onAddAllTasks: (tasks: Array<{
 title: string;
 description: string;
 priority:"low" |"medium" |"high" |"urgent";
 dueDate?: Date;
 }>) => void;
 onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AiTaskDraftPanel({
 projectId,
 projectTitle: _projectTitle,
 projectDescription,
 onAddTask,
 onAddAllTasks,
 onClose
}: AiTaskDraftPanelProps) {
 const t = useTranslations("ai");
 const [activeTab, setActiveTab] = useState<"description" |"pdf">("description");

 // Form state
 const [descInstructions, setDescInstructions] = useState("");
 const [pdfInstructions, setPdfInstructions] = useState("");
 const [selectedFile, setSelectedFile] = useState<File | null>(null);
 const [pdfBase64, setPdfBase64] = useState<string | null>(null);
 const [fileError, setFileError] = useState<string | null>(null);

 // Results state
 const [draftTasks, setDraftTasks] = useState<GeneratedTask[] | null>(null);
 const [reasoning, setReasoning] = useState<string | null>(null);
 const [addedTaskIndices, setAddedTaskIndices] = useState<Set<number>>(new Set());

 const fileInputRef = useRef<HTMLInputElement>(null);

 // ---- tRPC mutations ---------------------------------------------------
 const generateFromDesc = api.agent.generateTaskDrafts.useMutation({
 onSuccess(data) {
 setDraftTasks(data.tasks);
 setReasoning(data.reasoning);
 setAddedTaskIndices(new Set());
 },
 });

 const generateFromPdf = api.agent.extractTasksFromPdf.useMutation({
 onSuccess(data) {
 setDraftTasks(data.tasks);
 setReasoning(data.reasoning);
 setAddedTaskIndices(new Set());
 },
 });

 const isPending = generateFromDesc.isPending || generateFromPdf.isPending;

 // ---- File handling ----------------------------------------------------
 const processFile = useCallback((file: File) => {
 setFileError(null);

 if (file.type !=="application/pdf") {
 setFileError(t("errorNotPdf"));
 return;
 }

 if (file.size > MAX_FILE_SIZE_BYTES) {
 setFileError(t("errorTooLarge", { max: MAX_FILE_SIZE_MB }));
 return;
 }

 setSelectedFile(file);

 const reader = new FileReader();
 reader.onload = (ev) => {
 const result = ev.target?.result;
 if (typeof result ==="string") {
 const base64 = result.split(",")[1];
 setPdfBase64(base64 ?? null);
 }
 };
 reader.onerror = () => setFileError(t("readFailed"));
 reader.readAsDataURL(file);
 }, [t]);

 const handleFileChange = useCallback(
 (e: React.ChangeEvent<HTMLInputElement>) => {
 const file = e.target.files?.[0];
 if (file) processFile(file);
 },
 [processFile],
 );

 // ---- Generate / extract -----------------------------------------------
 const handleGenerate = useCallback(() => {
 if (activeTab ==="description") {
 generateFromDesc.mutate({
 projectId,
 message: descInstructions.trim() || undefined,
 });
 } else {
 if (!pdfBase64) return;
 generateFromPdf.mutate({
 projectId,
 pdfBase64,
 fileName: selectedFile?.name ??"",
 message: pdfInstructions.trim() || undefined,
 });
 }
 }, [activeTab, descInstructions, generateFromDesc, generateFromPdf, pdfBase64, pdfInstructions, projectId, selectedFile?.name]);

 // ---- Task actions -----------------------------------------------------
 const handleAddTask = useCallback(
 (task: GeneratedTask, index: number) => {
 if (addedTaskIndices.has(index)) return;

 onAddTask({
 title: task.title,
 description: task.description,
 priority: task.priority,
 dueDate: task.estimatedDueDays
 ? new Date(Date.now() + task.estimatedDueDays * 86_400_000)
 : undefined,
 });

 setAddedTaskIndices((prev) => {
 const next = new Set(prev);
 next.add(index);
 return next;
 });
 },
 [addedTaskIndices, onAddTask],
 );

 const handleAddAll = useCallback(() => {
 if (!draftTasks) return;

 const remaining = draftTasks
 .map((tk, idx) => ({ tk, idx }))
 .filter(({ idx }) => !addedTaskIndices.has(idx));

 if (remaining.length === 0) return;

 onAddAllTasks(
 remaining.map(({ tk }) => ({
 title: tk.title,
 description: tk.description,
 priority: tk.priority,
 dueDate: tk.estimatedDueDays
 ? new Date(Date.now() + tk.estimatedDueDays * 86_400_000)
 : undefined,
 })),
 );

 setAddedTaskIndices(new Set(draftTasks.map((_, i) => i)));
 }, [draftTasks, addedTaskIndices, onAddAllTasks]);

 const reset = useCallback(() => {
 setDraftTasks(null);
 setReasoning(null);
 setAddedTaskIndices(new Set());
 setSelectedFile(null);
 setPdfBase64(null);
 setFileError(null);
 }, []);

 // ---- Small sub-components --------------------------------------------
 const TabButton = ({ id, icon: Icon, label }: { id:"description" |"pdf"; icon: React.ComponentType<{ size: number }>; label: string }) => (
 <button
 onClick={() => { setActiveTab(id); reset(); }}
 disabled={isPending}
 className={cn(
"flex-1 flex items-center justify-center gap-2 py-2.5 text-[13px] font-medium transition-all rounded-lg relative",
 activeTab === id
 ?"text-fg-primary"
 :"text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
 )}
 >
 <Icon size={16} />
 {label}
 {activeTab === id && (
 <motion.div
 layoutId="activeTabAi"
 className="absolute inset-0 border-2 border-accent-primary/20 rounded-lg pointer-events-none"
 />
 )}
 </button>
 );

 // ---- Render -----------------------------------------------------------
 return (
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 {/* Header */}
 <div className="px-5 py-4 flex items-center justify-between border-b border-border-light/20">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center text-white shadow-lg shadow-accent-primary/20">
 <BrainCircuit size={18} />
 </div>
 <div>
 <h2 className="text-[15px] font-semibold text-fg-primary leading-tight">
 {t("title")}
 </h2>
 <p className="text-[12px] text-fg-secondary">
 {t("subtitle")}
 </p>
 </div>
 </div>
 {onClose && (
 <button
 onClick={onClose}
 className="kairos-tap p-1.5 rounded-full hover:bg-bg-secondary text-fg-secondary transition-colors"
 >
 <X size={16} />
 </button>
 )}
 </div>

 <div className="p-5 space-y-5">
 {/* =========== INPUT MODE =========== */}
 {!draftTasks ? (
 <>
 {/* Tab switcher */}
 <div className="flex p-1 bg-bg-secondary/50 rounded-xl border border-border-light/10">
 <TabButton id="description" icon={FileText} label={t("tabDescription")} />
 <TabButton id="pdf" icon={Upload} label={t("tabPdf")} />
 </div>

 <AnimatePresence mode="wait">
 {activeTab ==="description" ? (
 <motion.div
 key="description"
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -10 }}
 className="space-y-4"
 >
 {!projectDescription && (
 <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex gap-2.5">
 <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
 <p className="text-[12px] text-amber-500/90 leading-relaxed">
 {t("noDescription")}
 </p>
 </div>
 )}

 <div className="space-y-2">
 <label className="text-[12px] font-medium text-fg-secondary px-1 flex justify-between">
 {t("instructions")}
 <span className="opacity-50 italic">{t("optional")}</span>
 </label>
 <textarea
 value={descInstructions}
 onChange={(e) => setDescInstructions(e.target.value)}
 placeholder={t("placeholderDescription")}
 rows={4}
 className="kairos-textarea text-[13px] min-h-[100px]"
 disabled={isPending}
 />
 </div>

 <button
 onClick={handleGenerate}
 disabled={isPending || (!projectDescription && !descInstructions.trim())}
 className="w-full py-2.5 rounded-xl bg-gradient-to-r from-accent-primary to-accent-secondary text-white font-medium text-[13px] flex items-center justify-center gap-2 shadow-lg shadow-accent-primary/10 hover:shadow-accent-primary/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale disabled:scale-100"
 >
 {isPending ? (
 <>
 <Loader2 size={16} className="animate-spin" />
 {t("analyzing")}
 </>
 ) : (
 <>
 <Sparkles size={16} />
 {t("generateButton")}
 </>
 )}
 </button>
 </motion.div>
 ) : (
 <motion.div
 key="pdf"
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -10 }}
 className="space-y-4"
 >
 {/* Drop zone / selected file */}
 {!selectedFile ? (
 <div
 onClick={() => fileInputRef.current?.click()}
 onDragOver={(e) => e.preventDefault()}
 onDrop={(e) => {
 e.preventDefault();
 const file = e.dataTransfer.files[0];
 if (file) processFile(file);
 }}
 className={cn(
"border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all gap-3",
 fileError
 ?"border-red-500/30 bg-red-500/5"
 :"border-border-light/20 bg-bg-secondary/30 hover:bg-accent-primary/5 hover:border-accent-primary/30"
 )}
 >
 <div className="w-12 h-12 rounded-full bg-accent-primary/10 flex items-center justify-center text-accent-primary">
 <Upload size={24} />
 </div>
 <div>
 <p className="text-[13px] font-medium text-fg-primary">
 {t("dropPdf")} <span className="text-accent-primary">{t("browse")}</span>
 </p>
 <p className="text-[11px] text-fg-secondary mt-1">
 {t("supportedFormats", { max: MAX_FILE_SIZE_MB })}
 </p>
 </div>
 <input
 type="file"
 ref={fileInputRef}
 onChange={handleFileChange}
 accept="application/pdf"
 className="hidden"
 />
 </div>
 ) : (
 <div className="flex items-center gap-3 p-3 bg-bg-secondary/80 border border-border-light/20 rounded-xl">
 <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500">
 <FileText size={20} />
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-[13px] font-medium text-fg-primary truncate">
 {selectedFile.name}
 </p>
 <p className="text-[11px] text-fg-secondary">
 {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
 </p>
 </div>
 <button
 onClick={() => { setSelectedFile(null); setPdfBase64(null); }}
 className="p-1.5 rounded-full hover:bg-bg-secondary text-fg-secondary"
 >
 <X size={14} />
 </button>
 </div>
 )}

 {fileError && (
 <p className="text-[11px] text-red-400 px-1 flex items-center gap-1.5">
 <AlertCircle size={12} />
 {fileError}
 </p>
 )}

 <div className="space-y-2">
 <label className="text-[12px] font-medium text-fg-secondary px-1 flex justify-between">
 {t("instructions")}
 <span className="opacity-50 italic">{t("optional")}</span>
 </label>
 <textarea
 value={pdfInstructions}
 onChange={(e) => setPdfInstructions(e.target.value)}
 placeholder={t("placeholderPdf")}
 rows={3}
 className="kairos-textarea text-[13px] min-h-[80px]"
 disabled={isPending}
 />
 </div>

 <button
 onClick={handleGenerate}
 disabled={isPending || !pdfBase64}
 className="w-full py-2.5 rounded-xl bg-gradient-to-r from-accent-primary to-accent-secondary text-white font-medium text-[13px] flex items-center justify-center gap-2 shadow-lg shadow-accent-primary/10 hover:shadow-accent-primary/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale disabled:scale-100"
 >
 {isPending ? (
 <>
 <Loader2 size={16} className="animate-spin" />
 {t("extracting")}
 </>
 ) : (
 <>
 <Sparkles size={16} />
 {t("extractButton")}
 </>
 )}
 </button>
 </motion.div>
 )}
 </AnimatePresence>
 </>
 ) : (
 /* =========== RESULTS MODE =========== */
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 className="space-y-4"
 >
 {/* Results header */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center text-green-500">
 <CheckCircle2 size={12} />
 </div>
 <span className="text-[13px] font-semibold text-fg-primary">
 {t("tasksGenerated", { count: draftTasks.length })}
 </span>
 </div>
 <div className="flex gap-2">
 <button
 onClick={reset}
 className="text-[12px] px-3 py-1 rounded-lg border border-white/[0.06] text-fg-secondary hover:bg-bg-secondary transition-colors"
 >
 {t("removeFile")}
 </button>
 <button
 onClick={handleAddAll}
 disabled={addedTaskIndices.size === draftTasks.length}
 className="text-[12px] font-semibold px-3 py-1 rounded-lg bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 transition-all disabled:opacity-30 disabled:grayscale"
 >
 {t("addAll")}
 </button>
 </div>
 </div>

 {/* Task list */}
 <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar">
 {draftTasks.map((task, idx) => {
 const isAdded = addedTaskIndices.has(idx);
 return (
 <div
 key={idx}
 className={cn(
"p-3 rounded-xl border transition-all text-left group",
 isAdded
 ?"bg-bg-secondary/30 border-border-light/10 opacity-70"
 :"bg-bg-secondary/50 border-border-light/20 hover:border-accent-primary/30 hover:bg-accent-primary/[0.02]"
 )}
 >
 <div className="flex items-start justify-between gap-3">
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap mb-1">
 <h4 className="text-[13px] font-semibold text-fg-primary leading-tight">
 {task.title}
 </h4>
 <span className={cn(
"px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider",
 task.priority ==="urgent" ?"bg-red-500/20 text-red-500" :
 task.priority ==="high" ?"bg-orange-500/20 text-orange-500" :
 task.priority ==="medium" ?"bg-accent-primary/10 text-accent-primary" :
"bg-green-500/10 text-green-500"
 )}>
 {t(`priority.${task.priority}`)}
 </span>
 {task.estimatedDueDays && (
 <span className="text-[10px] text-fg-secondary">
 {t("estimatedDays", { days: task.estimatedDueDays })}
 </span>
 )}
 </div>
 <p className="text-[11px] text-fg-secondary leading-relaxed line-clamp-2">
 {task.description}
 </p>
 </div>
 <button
 onClick={() => handleAddTask(task, idx)}
 disabled={isAdded}
 className={cn(
"w-7 h-7 rounded-lg flex items-center justify-center transition-all shrink-0 mt-0.5",
 isAdded
 ?"bg-green-500/20 text-green-500"
 :"bg-bg-secondary text-fg-secondary hover:bg-accent-primary hover:text-white"
 )}
 title={isAdded ? t("added") : t("addTask")}
 >
 {isAdded ? <CheckCircle2 size={14} /> : <Plus size={16} />}
 </button>
 </div>
 </div>
 );
 })}
 </div>

 {/* AI reasoning */}
 {reasoning && (
 <div className="p-3 bg-bg-secondary/30 rounded-xl border border-border-light/10">
 <h5 className="text-[11px] font-bold text-fg-secondary uppercase tracking-wider mb-1 px-0.5">
 {t("reasoning")}
 </h5>
 <p className="text-[11px] text-fg-secondary italic leading-relaxed px-0.5">
 &ldquo;{reasoning}&rdquo;
 </p>
 </div>
 )}

 <button
 onClick={onClose}
 className="w-full py-2.5 rounded-xl border border-accent-primary/20 text-accent-primary text-[13px] font-medium hover:bg-accent-primary/10 transition-all"
 >
 {t("close")}
 </button>
 </motion.div>
 )}
 </div>

 {/* Error bar */}
 {(generateFromDesc.error ?? generateFromPdf.error) && (
 <div className="px-5 pb-5 pt-0">
 <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2.5 text-red-500">
 <AlertCircle size={16} className="shrink-0" />
 <p className="text-[12px] font-medium">
 {generateFromDesc.error?.message ?? generateFromPdf.error?.message ?? t("errorGeneric")}
 </p>
 </div>
 </div>
 )}
 </div>
 );
}

export default AiTaskDraftPanel;
