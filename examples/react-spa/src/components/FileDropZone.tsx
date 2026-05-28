/**
 * FileDropZone
 *
 * Drag-and-drop / click-to-select file input with inline validation feedback.
 * Enforces API constraints before calling onFilesSelected:
 *   - Accepted MIME types: image/jpeg, image/png, image/webp
 *   - Max file size: 20 MB (validated in the hook; shown here for UX)
 *   - Max batch size: 10 files
 *
 * Passes the raw File array to the parent; final validation happens in
 * useWatermark.addFiles() which deduplicates and accumulates error messages.
 */

import { useCallback, useRef, useState } from "react";
import { Upload, Plus } from "lucide-react";
import { ACCEPTED_MIME_TYPES, MAX_FILES_PER_BATCH } from "../hooks/useWatermark";

interface FileDropZoneProps {
  /** Number of files already staged in the batch */
  currentCount: number;
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
}

const ACCEPT_ATTR = ".jpg,.jpeg,.png,.webp";
const ACCEPTED_SET = new Set<string>(ACCEPTED_MIME_TYPES);

function filterByType(files: File[]): File[] {
  return files.filter((f) => ACCEPTED_SET.has(f.type));
}

export function FileDropZone({
  currentCount,
  disabled = false,
  onFilesSelected,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const isFull = currentCount >= MAX_FILES_PER_BATCH;
  const isDisabled = disabled || isFull;

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || isDisabled) return;
      const valid = filterByType(Array.from(files));
      if (valid.length > 0) onFilesSelected(valid);
    },
    [isDisabled, onFilesSelected],
  );

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!isDisabled) setIsDragging(true);
    },
    [isDisabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when leaving the zone entirely (not a child element)
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  // ── Keyboard / click ───────────────────────────────────────────────────────

  const handleClick = useCallback(() => {
    if (!isDisabled) inputRef.current?.click();
  }, [isDisabled]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Reset value so the same file can be re-added after removal
      e.target.value = "";
    },
    [handleFiles],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isFull) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-border/40 bg-muted/20 py-8">
        <p className="text-sm text-muted-foreground">
          Batch full — {MAX_FILES_PER_BATCH}/{MAX_FILES_PER_BATCH} files added.
        </p>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-label="Upload images — click or drag and drop"
      aria-disabled={isDisabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`
        group relative flex flex-col items-center justify-center gap-3
        rounded-xl border border-dashed px-6 py-10 text-center
        transition-all duration-200 select-none
        ${
          isDisabled
            ? "opacity-40 cursor-not-allowed border-border/40 bg-muted/20"
            : isDragging
            ? "border-accent/60 bg-accent/5 shadow-glow-sm cursor-copy"
            : "border-border/60 bg-muted/30 hover:border-accent/40 hover:bg-muted/50 cursor-pointer"
        }
      `}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={handleInputChange}
      />

      {/* Icon */}
      <div
        className={`
          flex h-12 w-12 items-center justify-center rounded-full border
          transition-colors duration-200
          ${
            isDragging
              ? "border-accent/50 bg-accent/10"
              : "border-border bg-muted group-hover:border-accent/30 group-hover:bg-accent/5"
          }
        `}
      >
        {currentCount > 0 ? (
          <Plus className={`h-5 w-5 ${isDragging ? "text-accent" : "text-muted-foreground group-hover:text-accent"}`} />
        ) : (
          <Upload className={`h-5 w-5 ${isDragging ? "text-accent" : "text-muted-foreground group-hover:text-accent"}`} />
        )}
      </div>

      {/* Text */}
      <div>
        <p className={`text-sm font-medium ${isDragging ? "text-accent" : "text-foreground"}`}>
          {isDragging
            ? "Drop to add images"
            : currentCount > 0
            ? "Add more images"
            : "Drop images here or click to select"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          JPEG · PNG · WebP · max 20 MB per file · up to {MAX_FILES_PER_BATCH} files
        </p>
      </div>

      {/* Slot indicator */}
      {currentCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {currentCount}/{MAX_FILES_PER_BATCH} files added
          {" · "}
          {MAX_FILES_PER_BATCH - currentCount} slot{MAX_FILES_PER_BATCH - currentCount !== 1 ? "s" : ""} remaining
        </p>
      )}
    </div>
  );
}
