"use client";

import { useRef, useState } from "react";
import {
  AlertCircle,
  FileText,
  Loader2,
  RotateCw,
  ScanLine,
  Trash2,
  Upload,
} from "~/components/ui/icons";
import { useTranslations } from "next-intl";

import { useEntitlement } from "~/hooks/useEntitlements";
import { useUploadThing } from "~/lib/uploadthing";
import { api } from "~/trpc/react";

type Translator = (key: string, values?: Record<string, unknown>) => string;

/**
 * The documents the agents can read, beside the conversation.
 *
 * Deliberately here rather than in settings. Settings is where you go to change
 * how the product behaves; a document is content, and the moment someone wants to
 * add one is the moment they are asking a question the file would answer. Putting
 * it in the rail means "upload the contract, then ask about the contract" is one
 * continuous action instead of a detour through preferences.
 *
 * Status is the whole design problem, and there are four:
 *
 * - **ready** — indexed, searchable, shows how much was indexed.
 * - **no_text** — parsed fine, contains no text layer. A scan. *Not* a failure,
 *   and no Retry button, because every retry will reach the same conclusion.
 *   Saying "failed" here sends someone to support instead of to a different file.
 * - **failed** — something actually broke, and Retry is offered because the cause
 *   may since have been fixed.
 * - **pending** — only visible if a page load catches an in-flight ingest;
 *   indexing runs inline, so it is normally over before the list re-renders.
 */
export function DocumentsPanel() {
  const useT = useTranslations as unknown as (ns: string) => Translator;
  const t = useT("documents");

  const canUseDocuments = useEntitlement("documents");
  const utils = api.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);

  const documents = api.integration.documents.useQuery(undefined, {
    retry: false,
    enabled: canUseDocuments,
  });

  const invalidate = () => void utils.integration.documents.invalidate();

  const add = api.integration.addDocument.useMutation({
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });
  const reindex = api.integration.reindexDocument.useMutation({
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });
  const remove = api.integration.deleteDocument.useMutation({
    onSuccess: invalidate,
  });

  const { startUpload, isUploading } = useUploadThing("documentUploader", {
    onClientUploadComplete: (files) => {
      // Registration is a second step on purpose: the provider callback has no
      // idea about ownership, project scope or entitlements, and `addDocument` is
      // where all three are enforced.
      for (const file of files) {
        add.mutate({
          filename: file.name,
          storageKey: file.url,
          mimeType: file.type || "application/pdf",
          sizeBytes: file.size,
          projectId: null,
        });
      }
    },
    onUploadError: (e) => setError(e.message),
  });

  const busy = isUploading || add.isPending;

  if (!canUseDocuments) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <FileText className="h-5 w-5 text-fg-tertiary" />
        <p className="text-sm leading-snug text-fg-tertiary">{t("proOnly")}</p>
      </div>
    );
  }

  const rows = documents.data ?? [];

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="mb-2 flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-border-medium px-3 py-4 text-center transition-colors hover:bg-bg-secondary disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-fg-tertiary" />
        ) : (
          <Upload className="h-4 w-4 text-fg-tertiary" />
        )}
        <span className="text-xs font-semibold text-fg-primary">
          {busy ? t("indexing") : t("upload")}
        </span>
        <span className="text-[11px] leading-snug text-fg-tertiary">
          {t("uploadHint")}
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,text/plain,text/markdown"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          setError(null);
          if (files.length) void startUpload(files);
          // Cleared so choosing the same file twice still fires a change event.
          e.target.value = "";
        }}
      />

      {/*
        Said once, up front. Retrieval is keyword-based — a decision taken because
        embeddings cost inference per upload — so "how do I cancel" will not find
        "termination clause". A user who does not know that concludes the feature
        is broken rather than that they need different words.
      */}
      <p className="mb-3 px-1 text-[11px] leading-snug text-fg-tertiary">
        {t("keywordNote")}
      </p>

      {error ? (
        <div className="mb-2 flex items-start gap-2 rounded-xl bg-red-500/10 px-2.5 py-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
          <p className="text-[11px] leading-snug text-red-500">{error}</p>
        </div>
      ) : null}

      {documents.isLoading ? (
        <p className="text-sm text-fg-tertiary">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="px-1 text-sm leading-snug text-fg-tertiary">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((doc) => (
            <li key={doc.id} className="rounded-xl bg-bg-secondary px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words text-sm leading-snug text-fg-primary">
                  {doc.filename}
                </p>
                <div className="flex shrink-0 items-center gap-0.5">
                  {/*
                    Retry appears only for `failed`. A `no_text` file will reach the
                    same conclusion every time, so offering it there invites someone
                    to keep pressing a button that cannot help them.
                  */}
                  {doc.status === "failed" ? (
                    <button
                      type="button"
                      onClick={() => reindex.mutate({ id: doc.id })}
                      disabled={reindex.isPending}
                      aria-label={t("retry")}
                      className="rounded-lg p-1 text-fg-tertiary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => remove.mutate({ id: doc.id })}
                    disabled={remove.isPending}
                    aria-label={t("delete")}
                    className="rounded-lg p-1 text-fg-tertiary transition-colors hover:bg-red-500/15 hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <DocumentStatus doc={doc} t={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface StatusProps {
  doc: {
    status: string;
    error: string | null;
    pageCount: number | null;
    chunkCount: number;
    truncated: boolean;
  };
  t: Translator;
}

/**
 * The line under a filename.
 *
 * Each status gets its own sentence rather than a shared badge plus a detail
 * field. The four outcomes mean genuinely different things to the reader, and a
 * uniform treatment would flatten "this is a scan, use OCR" into the same shape
 * as "storage returned 404".
 */
function DocumentStatus({ doc, t }: StatusProps) {
  if (doc.status === "ready") {
    return (
      <p className="pt-1 text-[11px] leading-snug text-fg-tertiary">
        {doc.pageCount
          ? t("readyWithPages", {
              pages: doc.pageCount,
              passages: doc.chunkCount,
            })
          : t("ready", { passages: doc.chunkCount })}
        {doc.truncated ? ` · ${t("truncated")}` : ""}
      </p>
    );
  }

  if (doc.status === "no_text") {
    return (
      <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
        <ScanLine className="mt-0.5 h-3 w-3 shrink-0" />
        {t("noText")}
      </p>
    );
  }

  if (doc.status === "failed") {
    return (
      <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-snug text-red-500">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
        {doc.error ?? t("failed")}
      </p>
    );
  }

  return (
    <p className="flex items-center gap-1.5 pt-1 text-[11px] text-fg-tertiary">
      <Loader2 className="h-3 w-3 animate-spin" />
      {t("indexing")}
    </p>
  );
}
