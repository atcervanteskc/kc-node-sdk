/**
 * useWatermark
 *
 * State machine for the KeepChill watermark upload pipeline.
 *
 * Orchestrates:
 *   1. File staging (validate + preview)
 *   2. Batch signed-URL request
 *   3. Parallel GCS uploads
 *   4. Parallel job polling
 *
 * Each file transitions through:
 *   staged → requesting → uploading → processing → success | error
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  getToken,
  invalidateToken,
  requestSignedUrls,
  uploadToGcs,
  pollJob,
  getJobStatus,
  type WatermarkType,
} from "../api/keepchill";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FileEntryStatus =
  | "staged"      // Queued — waiting for user to click Process
  | "requesting"  // Fetching signed upload URL from API
  | "uploading"   // Sending bytes to GCS via PUT
  | "processing"  // KeepChill Image Worker is watermarking
  | "success"     // Complete — resultUrl is populated
  | "error";      // Failed — error message is populated

export interface FileEntry {
  id: string;
  file: File;
  /** Object URL for thumbnail preview — revoked on remove/clear */
  previewUrl: string;
  status: FileEntryStatus;
  jobId?: string;
  fileId?: string;
  /** Signed GCS download URL. Expires — download promptly. */
  resultUrl?: string;
  error?: string;
}

// ── Validation constants — must match API limits ───────────────────────────────

export const ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** 20 MB — maximum file size accepted by the KeepChill API */
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/** 10 — maximum files per /v1/watermarks/signed-urls call */
export const MAX_FILES_PER_BATCH = 10;

const IN_PROGRESS_STATUSES: FileEntryStatus[] = ["requesting", "uploading", "processing"];
const MAX_BASENAME_LENGTH = 200;

// ── Reducer ───────────────────────────────────────────────────────────────────

type Action =
  | { type: "ADD"; entries: FileEntry[] }
  | { type: "REMOVE"; id: string }
  | { type: "CLEAR" }
  | { type: "SET_STATUS"; id: string; status: FileEntryStatus; jobId?: string; fileId?: string }
  | { type: "SET_SUCCESS"; id: string; resultUrl: string }
  | { type: "SET_ERROR"; id: string; error: string };

function filesReducer(state: FileEntry[], action: Action): FileEntry[] {
  switch (action.type) {
    case "ADD":
      return [...state, ...action.entries];

    case "REMOVE":
      return state.filter((e) => e.id !== action.id);

    case "CLEAR":
      // Revoke object URLs to free browser memory
      state.forEach((e) => URL.revokeObjectURL(e.previewUrl));
      return [];

    case "SET_STATUS":
      return state.map((e) =>
        e.id === action.id
          ? {
              ...e,
              status: action.status,
              ...(action.jobId !== undefined ? { jobId: action.jobId } : {}),
              ...(action.fileId !== undefined ? { fileId: action.fileId } : {}),
            }
          : e,
      );

    case "SET_SUCCESS":
      return state.map((e) =>
        e.id === action.id
          ? { ...e, status: "success" as const, resultUrl: action.resultUrl }
          : e,
      );

    case "SET_ERROR":
      return state.map((e) =>
        e.id === action.id
          ? { ...e, status: "error" as const, error: action.error }
          : e,
      );

    default:
      return state;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Sanitize a filename before sending it to the API.
 * Removes characters that could cause issues with GCS object names or
 * potential injection in downstream HTML rendering.
 */
function sanitizeFilename(name: string): string {
  const lastDot = name.lastIndexOf(".");
  const ext = lastDot !== -1 ? name.slice(lastDot).toLowerCase() : ".jpg";
  let base = lastDot !== -1 ? name.slice(0, lastDot) : name;

  base = base
    .replace(/\.\./g, "_")                    // path traversal
    .replace(/[/\\]/g, "_")                   // path separators
    .replace(/<[^>]*>/g, "")                  // HTML tags
    .replace(/[&'"`;$(){}[\]!|]/g, "_")       // shell/injection characters
    .replace(/[^a-zA-Z0-9._-]/g, "_")         // everything else non-alphanumeric
    .replace(/_{2,}/g, "_")                    // collapse multiple underscores
    .slice(0, MAX_BASENAME_LENGTH);

  return (base || "image") + ext;
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseWatermarkReturn {
  entries: FileEntry[];
  /** True while any file is in a non-terminal in-progress state */
  isProcessing: boolean;
  /** Validation error from the last addFiles call, if any */
  addError: string | null;
  addFiles: (files: File[]) => void;
  removeFile: (id: string) => void;
  clearAll: () => void;
  /** Initiates the full upload pipeline for all staged files.
   *  Throws for batch-level failures (auth, quota) so callers can surface them. */
  processFiles: (watermarkType: WatermarkType) => Promise<void>;
  /**
   * Manually check the current status of a single file's job.
   * Only acts when the file is in `processing` state and has a job ID.
   * Updates the file's entry in place — transitions to success/error if terminal.
   * Silently no-ops for files in other states.
   */
  checkJobStatus: (fileId: string) => Promise<void>;
}

/**
 * @param apiKey - The tenant API key. Changing this value clears the cached
 *                 JWT automatically so the next processFiles call re-authenticates.
 */
export function useWatermark(apiKey: string): UseWatermarkReturn {
  const [entries, dispatch] = useReducer(filesReducer, []);
  const [addError, setAddError] = useState<string | null>(null);

  // Processing lock — prevents double-submissions
  const processingRef = useRef(false);

  // Mirror entries in a ref so stable callbacks can read current state
  // without being listed as a dependency (avoids re-creating callbacks on every render)
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  // Clear cached JWT whenever the API key changes to force re-authentication
  useEffect(() => {
    invalidateToken();
  }, [apiKey]);

  const isProcessing = entries.some((e) => IN_PROGRESS_STATUSES.includes(e.status));

  // ── addFiles ───────────────────────────────────────────────────────────────

  const addFiles = useCallback((newFiles: File[]) => {
    setAddError(null);

    const current = entriesRef.current;
    const existingNames = new Set(current.map((e) => e.file.name));
    const remainingSlots = MAX_FILES_PER_BATCH - current.length;

    if (remainingSlots <= 0) {
      setAddError(`Batch is full — maximum ${MAX_FILES_PER_BATCH} files per batch.`);
      return;
    }

    const errors: string[] = [];
    const valid: FileEntry[] = [];

    for (const file of newFiles) {
      if (valid.length >= remainingSlots) {
        const skipped = newFiles.length - valid.length;
        errors.push(`${skipped} file(s) skipped — batch limit is ${MAX_FILES_PER_BATCH}.`);
        break;
      }

      if (existingNames.has(file.name)) {
        errors.push(`"${file.name}": already added.`);
        continue;
      }

      if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
        errors.push(`"${file.name}": unsupported format (JPEG, PNG, or WebP only).`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        errors.push(`"${file.name}": exceeds the 20 MB file size limit.`);
        continue;
      }

      existingNames.add(file.name);
      valid.push({
        id: generateId(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "staged",
      });
    }

    if (errors.length > 0) {
      setAddError(
        errors.slice(0, 2).join(" ") +
          (errors.length > 2 ? ` (+${errors.length - 2} more issues)` : ""),
      );
    }

    if (valid.length > 0) {
      dispatch({ type: "ADD", entries: valid });
    }
  }, []); // stable — reads entries via ref

  // ── removeFile ─────────────────────────────────────────────────────────────

  const removeFile = useCallback((id: string) => {
    const entry = entriesRef.current.find((e) => e.id === id);
    if (entry) URL.revokeObjectURL(entry.previewUrl);
    dispatch({ type: "REMOVE", id });
    setAddError(null);
  }, []);

  // ── clearAll ───────────────────────────────────────────────────────────────

  const clearAll = useCallback(() => {
    dispatch({ type: "CLEAR" });
    setAddError(null);
  }, []);

  // ── processFiles ───────────────────────────────────────────────────────────

  const processFiles = useCallback(
    async (watermarkType: WatermarkType): Promise<void> => {
      if (processingRef.current || !apiKey) return;

      const staged = entriesRef.current.filter((e) => e.status === "staged");
      if (staged.length === 0) return;

      processingRef.current = true;

      // Immediately mark all staged files as "requesting" for instant visual feedback
      staged.forEach((e) =>
        dispatch({ type: "SET_STATUS", id: e.id, status: "requesting" }),
      );

      try {
        // ── Step 1: Obtain JWT ────────────────────────────────────────────────
        const token = await getToken(apiKey);

        // ── Step 2: Batch signed-URL request ─────────────────────────────────
        const descriptors = staged.map((e) => ({
          name: sanitizeFilename(e.file.name),
          type: e.file.type,
          watermark_type: watermarkType,
        }));

        const tickets = await requestSignedUrls(token, descriptors);

        // ── Steps 3 & 4: Upload + Poll — all files in parallel ────────────────
        // Promise.allSettled so one file's failure doesn't abort the batch
        await Promise.allSettled(
          staged.map(async (entry, i) => {
            const ticket = tickets[i];

            // Guard: API returned fewer tickets than expected (should not happen)
            if (ticket === undefined) {
              dispatch({
                type: "SET_ERROR",
                id: entry.id,
                error: "No upload ticket received for this file.",
              });
              return;
            }

            try {
              // ── Step 3: Upload to GCS ───────────────────────────────────────
              dispatch({
                type: "SET_STATUS",
                id: entry.id,
                status: "uploading",
                jobId: ticket.jobId,
                fileId: ticket.fileId,
              });
              await uploadToGcs(ticket.uploadUrl, entry.file);

              // ── Step 4: Poll for result ─────────────────────────────────────
              dispatch({ type: "SET_STATUS", id: entry.id, status: "processing" });

              // Refresh token before polling — uploads can take time on large files
              const freshToken = await getToken(apiKey);
              const result = await pollJob(ticket.jobId, ticket.fileId, freshToken);

              dispatch({
                type: "SET_SUCCESS",
                id: entry.id,
                resultUrl: result.processed_image_url ?? "",
              });
            } catch (err) {
              dispatch({
                type: "SET_ERROR",
                id: entry.id,
                error: err instanceof Error ? err.message : "Unknown error",
              });
            }
          }),
        );
      } catch (err) {
        // Batch-level failure (auth error, quota exceeded, network failure).
        // Mark any files still stuck in "requesting" state as errored.
        entriesRef.current
          .filter((e) => e.status === "requesting")
          .forEach((e) =>
            dispatch({
              type: "SET_ERROR",
              id: e.id,
              error: err instanceof Error ? err.message : "Batch processing failed.",
            }),
          );

        // Re-throw so the caller (App) can surface auth/quota errors distinctly
        throw err;
      } finally {
        processingRef.current = false;
      }
    },
    [apiKey],
  );

  // ── checkJobStatus ─────────────────────────────────────────────────────────

  const checkJobStatus = useCallback(
    async (fileId: string): Promise<void> => {
      const entry = entriesRef.current.find((e) => e.id === fileId);

      // Only act on files that are actively processing and have a job ID
      if (!entry || !entry.jobId || entry.status !== "processing") return;
      if (!apiKey) return;

      try {
        const token = await getToken(apiKey);
        const result = await getJobStatus(entry.jobId, entry.fileId ?? "", token);

        if (result.status === "success") {
          dispatch({
            type: "SET_SUCCESS",
            id: fileId,
            resultUrl: result.processed_image_url ?? "",
          });
        } else if (result.status === "error") {
          dispatch({
            type: "SET_ERROR",
            id: fileId,
            error: result.error ?? "Image processing failed.",
          });
        }
        // pending / processing — no state change; UI shows the same spinner
      } catch (err) {
        // Don't change the file status on a failed manual check — the auto-poll
        // is still running in the background. Surface the error to the caller.
        throw err;
      }
    },
    [apiKey],
  );

  return { entries, isProcessing, addError, addFiles, removeFile, clearAll, processFiles, checkJobStatus };
}
