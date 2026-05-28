/**
 * FileList
 *
 * Renders the staged and processed file entries.
 * Returns null when the list is empty so the parent doesn't render dead space.
 *
 * Status indicators:
 *   staged      — neutral, remove button available
 *   requesting  — spinner (fetching signed URL)
 *   uploading   — spinner (sending bytes to GCS)
 *   processing  — spinner (KeepChill Image Worker running)
 *   success     — green check + download link
 *   error       — red alert + inline error message
 *
 * Result URLs are pre-signed GCS URLs — they expire. A reminder is shown once
 * all files reach a terminal state (success or error).
 */

import { useCallback, useState } from "react";
import { X, Loader2, CheckCircle2, AlertCircle, Download, ExternalLink, RefreshCw } from "lucide-react";
import type { FileEntry, FileEntryStatus } from "../hooks/useWatermark";

interface FileListProps {
  entries: FileEntry[];
  isProcessing: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
  /** Manually trigger a one-shot status check for a single file. */
  onCheckStatus: (fileId: string) => Promise<void>;
}

const IN_PROGRESS: FileEntryStatus[] = ["requesting", "uploading", "processing"];

const STATUS_LABEL: Record<FileEntryStatus, string> = {
  staged:     "Queued",
  requesting: "Requesting URL…",
  uploading:  "Uploading…",
  processing: "Processing…",
  success:    "Done",
  error:      "Failed",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface StatusBadgeProps {
  status: FileEntryStatus;
}

function StatusBadge({ status }: StatusBadgeProps) {
  const isSpinning = IN_PROGRESS.includes(status);

  return (
    <span
      className={`
        inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap
        ${status === "success"  ? "bg-success/10 text-success" : ""}
        ${status === "error"    ? "bg-destructive/10 text-destructive" : ""}
        ${status === "staged"   ? "bg-muted text-muted-foreground" : ""}
        ${isSpinning            ? "bg-accent/10 text-accent" : ""}
      `}
    >
      {isSpinning && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === "success" && <CheckCircle2 className="h-3 w-3" />}
      {status === "error"   && <AlertCircle   className="h-3 w-3" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function FileList({ entries, isProcessing, onRemove, onClear, onCheckStatus }: FileListProps) {
  if (entries.length === 0) return null;

  // Track which file IDs have a manual check in flight so we can show a spinner
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());

  const handleCheck = useCallback(
    async (fileId: string) => {
      if (checkingIds.has(fileId)) return;
      setCheckingIds((prev) => new Set(prev).add(fileId));
      try {
        await onCheckStatus(fileId);
      } finally {
        setCheckingIds((prev) => {
          const next = new Set(prev);
          next.delete(fileId);
          return next;
        });
      }
    },
    [checkingIds, onCheckStatus],
  );

  const allTerminal = entries.every(
    (e) => e.status === "success" || e.status === "error",
  );

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Files ({entries.length})
        </p>
        {allTerminal && !isProcessing && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* File rows */}
      <ul className="space-y-2">
        {entries.map((entry) => {
          const isInProgress = IN_PROGRESS.includes(entry.status);

          return (
            <li
              key={entry.id}
              className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/30 p-3"
            >
              {/* Thumbnail */}
              <img
                src={entry.previewUrl}
                alt={entry.file.name}
                className="h-10 w-10 rounded-md object-cover shrink-0 border border-border/40"
              />

              {/* File info */}
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium text-foreground truncate"
                  title={entry.file.name}
                >
                  {entry.file.name}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(entry.file.size)}
                  </span>
                  {entry.jobId && (
                    <>
                      <span className="text-muted-foreground/30">·</span>
                      <span className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-[140px]">
                        {entry.jobId}
                      </span>
                    </>
                  )}
                </div>
                {/* Inline error message */}
                {entry.status === "error" && entry.error && (
                  <p className="mt-1 text-xs text-destructive leading-snug">
                    {entry.error}
                  </p>
                )}
              </div>

              {/* Status + actions */}
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={entry.status} />

                {/* Manual check — shown while the job is processing */}
                {entry.status === "processing" && entry.jobId && (
                  <button
                    type="button"
                    disabled={checkingIds.has(entry.id)}
                    onClick={() => { void handleCheck(entry.id); }}
                    className="
                      inline-flex items-center gap-1 rounded-lg border border-border/60
                      bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground
                      hover:text-foreground hover:border-border transition-colors
                      disabled:opacity-40 disabled:cursor-not-allowed
                    "
                    title="Check current job status now"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${checkingIds.has(entry.id) ? "animate-spin" : ""}`}
                    />
                    Check now
                  </button>
                )}

                {/* Download — only when success and URL is available */}
                {entry.status === "success" && entry.resultUrl && (
                  <a
                    href={entry.resultUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="
                      inline-flex items-center gap-1 rounded-lg border border-accent/30
                      bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent
                      hover:bg-accent/20 transition-colors
                    "
                    title="Open result in new tab"
                  >
                    <Download className="h-3 w-3" />
                    Download
                    <ExternalLink className="h-2.5 w-2.5 opacity-70" />
                  </a>
                )}

                {/* Processed-but-no-URL — explains why download is absent */}
                {entry.status === "success" && !entry.resultUrl && (
                  <span
                    className="
                      inline-flex items-center gap-1 rounded-lg border border-warning/30
                      bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning
                    "
                    title="kc-tenants-service returns signed_url: null until T42 is implemented (the GET /v1/jobs/{job_id} handler does not yet mint a fresh signed download URL). The image is processed and stored in GCS; webhook delivery carries the signed URL."
                  >
                    Processed (no URL via API yet)
                  </span>
                )}

                {/* Remove — only for staged files and when not processing */}
                {entry.status === "staged" && !isProcessing && (
                  <button
                    type="button"
                    onClick={() => onRemove(entry.id)}
                    aria-label={`Remove ${entry.file.name}`}
                    className="
                      rounded-md p-1 text-muted-foreground
                      hover:text-destructive hover:bg-destructive/10 transition-colors
                    "
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}

                {/* Retry placeholder — when error + not processing */}
                {entry.status === "error" && !isProcessing && (
                  <button
                    type="button"
                    onClick={() => onRemove(entry.id)}
                    aria-label={`Dismiss ${entry.file.name}`}
                    className="
                      rounded-md p-1 text-muted-foreground
                      hover:text-foreground hover:bg-muted transition-colors
                    "
                    title="Remove this file"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Expiry reminder — shown once all files are done */}
      {allTerminal && entries.some((e) => e.status === "success") && (
        <p className="text-xs text-warning/80 text-center pt-1">
          Result URLs are pre-signed and expire — download your images promptly.
        </p>
      )}
    </div>
  );
}
