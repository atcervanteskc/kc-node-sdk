/**
 * App — KeepChill Client Example
 *
 * Root component. Wires together the API key input, watermark style selector,
 * file drop zone, and file list into a single-page demo of the KeepChill
 * Watermark API.
 *
 * Authentication state:
 *   undefined — not yet tested (initial state, also reset on key change)
 *   true      — last processFiles() call succeeded (token was valid)
 *   false     — last processFiles() call threw an auth/network error
 */

import { useCallback, useState } from "react";
import { ShieldCheck, ExternalLink, AlertCircle, Loader2 } from "lucide-react";
import { ApiKeyInput } from "./components/ApiKeyInput";
import { WatermarkTypeSelector } from "./components/WatermarkTypeSelector";
import { FileDropZone } from "./components/FileDropZone";
import { FileList } from "./components/FileList";
import { useWatermark } from "./hooks/useWatermark";
import type { WatermarkType } from "./api/keepchill";

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [watermarkType, setWatermarkType] = useState<WatermarkType>("photographer");
  const [isAuthValid, setIsAuthValid] = useState<boolean | undefined>(undefined);
  const [processingError, setProcessingError] = useState<string | null>(null);

  const { entries, isProcessing, addError, addFiles, removeFile, clearAll, processFiles, checkJobStatus } =
    useWatermark(apiKey);

  const stagedCount = entries.filter((e) => e.status === "staged").length;
  const hasApiKey = apiKey.trim().length > 0;
  const canProcess = hasApiKey && stagedCount > 0 && !isProcessing;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleApiKeyChange = useCallback((value: string) => {
    setApiKey(value);
    // Reset auth state on key change — will be re-validated on next process attempt
    setIsAuthValid(undefined);
    setProcessingError(null);
  }, []);

  const handleProcess = useCallback(async () => {
    if (!canProcess) return;
    setProcessingError(null);

    try {
      await processFiles(watermarkType);
      setIsAuthValid(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed — see file rows for details.";
      setProcessingError(message);

      // If the error message suggests an auth failure, flag the key as invalid
      // so the UI prompts the user to check their API key
      const isAuthErr = message.toLowerCase().includes("auth") ||
        message.toLowerCase().includes("401") ||
        message.toLowerCase().includes("invalid");
      setIsAuthValid(isAuthErr ? false : undefined);
    }
  }, [canProcess, processFiles, watermarkType]);

  // ── Process button copy ────────────────────────────────────────────────────

  let buttonLabel = "Process Images";
  if (isProcessing)    buttonLabel = "Processing…";
  else if (!hasApiKey) buttonLabel = "Enter API Key First";
  else if (stagedCount === 0) buttonLabel = "Add Images to Process";

  // ── Layout ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-border/40 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <ShieldCheck className="h-5 w-5 text-accent shrink-0" />
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-foreground truncate">
              KeepChill Client Example
            </h1>
            <p className="text-xs text-muted-foreground">
              Watermark API integration demo
            </p>
          </div>
          <a
            href="https://keepchill.io/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="
              inline-flex items-center gap-1.5 rounded-lg border border-border/60
              bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground
              hover:text-foreground hover:border-border transition-colors
            "
          >
            Developer Guide
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <main className="flex-1 mx-auto w-full max-w-3xl px-6 py-10 space-y-6">

        {/* ── Configuration card ──────────────────────────────────────────── */}
        <section
          className="rounded-2xl border border-border/60 bg-card p-6 space-y-2"
          aria-label="API Configuration"
        >
          <h2 className="text-xs font-semibold uppercase tracking-widest text-accent/80">
            Configuration
          </h2>
          <p className="text-sm text-muted-foreground">
            Paste your KeepChill API key to authenticate. The key is used only
            to obtain a short-lived token and is never stored or transmitted
            anywhere else.
          </p>

          <div className="pt-2">
            <ApiKeyInput
              value={apiKey}
              onChange={handleApiKeyChange}
              isValid={isAuthValid}
            />
          </div>
        </section>

        {/* ── Upload & Process card ────────────────────────────────────────── */}
        <section
          className="rounded-2xl border border-border/60 bg-card p-6 space-y-6"
          aria-label="Upload and Process"
        >
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-accent/80">
              Upload &amp; Process
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Choose a watermark style, add your images, then click Process.
            </p>
          </div>

          {/* Watermark type selector */}
          <WatermarkTypeSelector
            value={watermarkType}
            onChange={setWatermarkType}
            disabled={isProcessing}
          />

          {/* Drop zone */}
          <FileDropZone
            currentCount={entries.length}
            disabled={isProcessing}
            onFilesSelected={addFiles}
          />

          {/* Add-error (validation, duplicate, size) */}
          {addError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-px" />
              <p className="text-sm text-destructive leading-snug">{addError}</p>
            </div>
          )}

          {/* File list */}
          <FileList
            entries={entries}
            isProcessing={isProcessing}
            onRemove={removeFile}
            onClear={clearAll}
            onCheckStatus={checkJobStatus}
          />

          {/* Batch-level processing error (auth failure, quota, network) */}
          {processingError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-px" />
              <div>
                <p className="text-sm font-medium text-destructive">Processing failed</p>
                <p className="text-xs text-destructive/80 mt-0.5">{processingError}</p>
              </div>
            </div>
          )}

          {/* Process button */}
          <button
            type="button"
            disabled={!canProcess}
            onClick={() => { void handleProcess(); }}
            className={`
              w-full rounded-xl px-6 py-3.5 text-sm font-semibold
              flex items-center justify-center gap-2
              transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50
              ${
                canProcess
                  ? "bg-accent text-accent-foreground hover:brightness-110 shadow-glow-sm"
                  : "bg-muted text-muted-foreground cursor-not-allowed opacity-60"
              }
            `}
          >
            {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
            {buttonLabel}
          </button>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border/30 py-8">
        <div className="mx-auto max-w-3xl px-6 flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>
            KeepChill Client Example — not for production use. See{" "}
            <a
              href="https://keepchill.io/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent/80 hover:text-accent underline underline-offset-2 transition-colors"
            >
              Developer Guide
            </a>{" "}
            for the full API reference.
          </p>
          <a
            href="mailto:support@keepchill.io"
            className="hover:text-foreground transition-colors"
          >
            support@keepchill.io
          </a>
        </div>
      </footer>
    </div>
  );
}
