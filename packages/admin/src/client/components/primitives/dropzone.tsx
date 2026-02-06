/**
 * Dropzone Primitive
 *
 * A reusable drag-and-drop area for file uploads.
 * Supports file type filtering, size validation, and visual feedback.
 *
 * @example
 * ```tsx
 * <Dropzone
 *   onDrop={(files) => handleUpload(files)}
 *   accept={["image/*", "application/pdf"]}
 *   maxSize={5_000_000}
 * />
 * ```
 */

import * as React from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface DropzoneProps {
  /**
   * Called when files are dropped or selected
   */
  onDrop: (files: File[]) => void;

  /**
   * Accepted file types (MIME types or extensions)
   * @example ["image/*", "application/pdf", ".doc"]
   */
  accept?: string[];

  /**
   * Maximum file size in bytes
   */
  maxSize?: number;

  /**
   * Whether multiple files can be selected
   * @default false
   */
  multiple?: boolean;

  /**
   * Disable the dropzone
   */
  disabled?: boolean;

  /**
   * Show loading state (e.g., during upload)
   */
  loading?: boolean;

  /**
   * Current upload progress (0-100)
   */
  progress?: number;

  /**
   * Custom label text
   * @default "Drop files here or click to browse"
   */
  label?: string;

  /**
   * Helper text shown below the label
   */
  hint?: string;

  /**
   * Error message to display
   */
  error?: string;

  /**
   * Additional className
   */
  className?: string;

  /**
   * Children to render inside the dropzone (custom content)
   */
  children?: React.ReactNode;

  /**
   * Callback when validation fails
   */
  onValidationError?: (errors: ValidationError[]) => void;
}

export interface ValidationError {
  file: File;
  type: "type" | "size";
  message: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a file matches accepted types
 */
function matchesAccept(file: File, accept?: string[]): boolean {
  if (!accept || accept.length === 0) return true;

  const mimeType = file.type.toLowerCase();
  const fileName = file.name.toLowerCase();

  return accept.some((pattern) => {
    const normalizedPattern = pattern.toLowerCase();

    // Handle wildcard MIME types like "image/*"
    if (normalizedPattern.endsWith("/*")) {
      const baseType = normalizedPattern.slice(0, -2);
      return mimeType.startsWith(`${baseType}/`);
    }

    // Handle extensions like ".pdf"
    if (normalizedPattern.startsWith(".")) {
      return fileName.endsWith(normalizedPattern);
    }

    // Handle exact MIME types
    return mimeType === normalizedPattern;
  });
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Component
// ============================================================================

export function Dropzone({
  onDrop,
  accept,
  maxSize,
  multiple = false,
  disabled = false,
  loading = false,
  progress,
  label = "Drop files here or click to browse",
  hint,
  error,
  className,
  children,
  onValidationError,
}: DropzoneProps) {
  const [isDragging, setIsDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dragCounterRef = React.useRef(0);

  /**
   * Validate files and return valid ones + errors
   */
  const validateFiles = React.useCallback(
    (files: File[]): { valid: File[]; errors: ValidationError[] } => {
      const valid: File[] = [];
      const errors: ValidationError[] = [];

      for (const file of files) {
        // Check type
        if (!matchesAccept(file, accept)) {
          errors.push({
            file,
            type: "type",
            message: `"${file.name}" is not an accepted file type`,
          });
          continue;
        }

        // Check size
        if (maxSize && file.size > maxSize) {
          errors.push({
            file,
            type: "size",
            message: `"${file.name}" exceeds maximum size of ${formatFileSize(maxSize)}`,
          });
          continue;
        }

        valid.push(file);
      }

      return { valid, errors };
    },
    [accept, maxSize],
  );

  /**
   * Handle file selection
   */
  const handleFiles = React.useCallback(
    (files: FileList | File[]) => {
      if (disabled || loading) return;

      const fileArray = Array.from(files);
      const filesToProcess = multiple ? fileArray : fileArray.slice(0, 1);

      const { valid, errors } = validateFiles(filesToProcess);

      if (errors.length > 0) {
        onValidationError?.(errors);
      }

      if (valid.length > 0) {
        onDrop(valid);
      }
    },
    [disabled, loading, multiple, validateFiles, onDrop, onValidationError],
  );

  /**
   * Handle drag events
   */
  const handleDragEnter = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current += 1;
      if (e.dataTransfer.items.length > 0 && !disabled && !loading) {
        setIsDragging(true);
      }
    },
    [disabled, loading],
  );

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  /**
   * Handle click to open file dialog
   */
  const handleClick = React.useCallback(() => {
    if (disabled || loading) return;
    inputRef.current?.click();
  }, [disabled, loading]);

  /**
   * Handle file input change
   */
  const handleInputChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files);
      }
      // Reset input so same file can be selected again
      e.target.value = "";
    },
    [handleFiles],
  );

  /**
   * Build accept string for input
   */
  const acceptString = accept?.join(",") || undefined;

  /**
   * Build hint text
   */
  const hintText = React.useMemo(() => {
    if (hint) return hint;

    const parts: string[] = [];

    if (accept && accept.length > 0) {
      // Simplify accept types for display
      const types = accept
        .map((t) => {
          if (t.startsWith("image/")) return "Images";
          if (t.startsWith("video/")) return "Videos";
          if (t.startsWith("audio/")) return "Audio";
          if (t === "application/pdf") return "PDF";
          if (t.startsWith(".")) return t.toUpperCase();
          return t;
        })
        .filter((v, i, a) => a.indexOf(v) === i); // unique
      parts.push(types.join(", "));
    }

    if (maxSize) {
      parts.push(`Max ${formatFileSize(maxSize)}`);
    }

    return parts.length > 0 ? parts.join(" • ") : undefined;
  }, [hint, accept, maxSize]);

  return (
    <div
      role="button"
      tabIndex={disabled || loading ? -1 : 0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
        "border-border/60 bg-muted/30 hover:border-border hover:bg-muted/50",
        isDragging && "border-primary bg-primary/5",
        error && "border-destructive/50 bg-destructive/5",
        (disabled || loading) && "pointer-events-none opacity-60",
        className,
      )}
      aria-disabled={disabled || loading}
      data-dragging={isDragging || undefined}
    >
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={acceptString}
        multiple={multiple}
        onChange={handleInputChange}
        className="sr-only"
        disabled={disabled || loading}
        tabIndex={-1}
      />

      {/* Custom children or default content */}
      {children || (
        <>
          {/* Icon / Loading */}
          <div className="flex items-center justify-center">
            {loading ? (
              <div className="relative">
                <Icon
                  icon="ph:spinner-gap"
                  className="text-muted-foreground size-10 animate-spin"
                />
                {typeof progress === "number" && (
                  <span className="text-muted-foreground absolute inset-0 flex items-center justify-center text-xs font-medium">
                    {progress}%
                  </span>
                )}
              </div>
            ) : (
              <Icon
                icon="ph:cloud-arrow-up"
                className={cn(
                  "size-10 transition-colors",
                  isDragging ? "text-primary" : "text-muted-foreground",
                )}
              />
            )}
          </div>

          {/* Label */}
          <div className="space-y-1">
            <p
              className={cn(
                "text-sm font-medium",
                isDragging ? "text-primary" : "text-foreground",
              )}
            >
              {loading ? "Uploading..." : label}
            </p>

            {/* Hint */}
            {hintText && !loading && (
              <p className="text-muted-foreground text-xs">{hintText}</p>
            )}

            {/* Progress bar */}
            {loading && typeof progress === "number" && (
              <div className="bg-muted mx-auto mt-2 h-1.5 w-32 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* Error message */}
      {error && (
        <p className="text-destructive absolute bottom-2 left-0 right-0 text-center text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
