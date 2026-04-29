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

import { Icon } from "@iconify/react";
import * as React from "react";

import { useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

// ============================================================================
// Types
// ============================================================================

interface DropzoneProps {
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
	 * Visual density of the dropzone.
	 * @default "panel"
	 */
	variant?: "panel" | "compact";

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
	 * Secondary action rendered inside the dropzone.
	 */
	action?: {
		label: string;
		icon?: string;
		onClick: () => void;
		disabled?: boolean;
	};

	/**
	 * Callback when validation fails
	 */
	onValidationError?: (errors: ValidationError[]) => void;
}

interface ValidationError {
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
	variant = "panel",
	label,
	hint,
	error,
	className,
	children,
	action,
	onValidationError,
}: DropzoneProps) {
	const { t } = useTranslation();
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
						message: t("dropzone.invalidType", { name: file.name }),
					});
					continue;
				}

				// Check size
				if (maxSize && file.size > maxSize) {
					errors.push({
						file,
						type: "size",
						message: t("dropzone.tooLarge", {
							name: file.name,
							maxSize: formatFileSize(maxSize),
						}),
					});
					continue;
				}

				valid.push(file);
			}

			return { valid, errors };
		},
		[accept, maxSize, t],
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
	const isCompact = variant === "compact";

	/**
	 * Build hint text
	 */
	const hintText = React.useMemo(() => {
		if (hint) return hint;

		const parts: string[] = [];

		if (accept && accept.length > 0) {
			// Simplify accept types for display
			const types = accept
				.map((mimeType) => {
					if (mimeType.startsWith("image/")) return t("dropzone.typeImages");
					if (mimeType.startsWith("video/")) return t("dropzone.typeVideos");
					if (mimeType.startsWith("audio/")) return t("dropzone.typeAudio");
					if (mimeType === "application/pdf") return t("dropzone.typePDF");
					if (mimeType.startsWith(".")) return mimeType.toUpperCase();
					return mimeType;
				})
				.filter((v, i, a) => a.indexOf(v) === i); // unique
			parts.push(types.join(", "));
		}

		if (maxSize) {
			parts.push(`Max ${formatFileSize(maxSize)}`);
		}

		return parts.length > 0 ? parts.join(" • ") : undefined;
	}, [hint, accept, maxSize, t]);

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
				"qa-dropzone control-surface relative flex cursor-pointer hover:bg-muted/40 rounded-lg border transition-colors",
				isCompact
					? "min-h-16 flex-row items-center justify-start gap-3 border border-dashed p-3 text-left"
					: "min-h-[120px] flex-col items-center justify-center gap-2 border-2 p-6 text-center",
				isDragging && "border-border-strong bg-surface-high",
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
					<div
						className={cn(
							"flex shrink-0 items-center justify-center",
							isCompact &&
								"bg-background/70 border-border-subtle size-9 rounded border",
						)}
					>
						{loading ? (
							<div className="relative">
								<Icon
									icon="ph:spinner-gap"
									className={cn(
										"text-muted-foreground animate-spin",
										isCompact ? "size-5" : "size-10",
									)}
								/>
								{typeof progress === "number" && (
									<span
										className={cn(
											"text-muted-foreground absolute inset-0 flex items-center justify-center font-medium tabular-nums",
											isCompact ? "text-[9px]" : "text-xs",
										)}
									>
										{progress}%
									</span>
								)}
							</div>
						) : (
							<Icon
								icon="ph:cloud-arrow-up"
								className={cn(
									"transition-colors",
									isCompact ? "size-5" : "size-10",
									isDragging ? "text-foreground" : "text-muted-foreground",
								)}
							/>
						)}
					</div>

					{/* Label */}
					<div className={cn("min-w-0 space-y-1", isCompact && "flex-1")}>
						<p
							className={cn(
								"text-foreground text-sm font-medium",
								isCompact && "truncate",
							)}
						>
							{loading ? t("dropzone.uploading") : label || t("dropzone.label")}
						</p>

						{/* Hint */}
						{hintText && !loading && (
							<p
								className={cn(
									"text-muted-foreground text-xs",
									isCompact && "truncate",
								)}
							>
								{hintText}
							</p>
						)}

						{/* Progress bar */}
						{loading && typeof progress === "number" && (
							<div
								className={cn(
									"bg-muted mt-2 h-1.5 overflow-hidden rounded-full",
									isCompact ? "w-full" : "mx-auto w-32",
								)}
							>
								<div
									className="bg-primary h-full rounded-full transition-[width] duration-300"
									style={{ width: `${progress}%` }}
								/>
							</div>
						)}
					</div>

					{action && !loading && !disabled && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={action.disabled}
							onClick={(e) => {
								e.stopPropagation();
								action.onClick();
							}}
							onKeyDown={(e) => {
								e.stopPropagation();
							}}
							className={cn("shrink-0", isCompact && "max-w-[45%] px-2.5")}
						>
							{action.icon && (
								<Icon icon={action.icon} className="size-4 shrink-0" />
							)}
							<span className="truncate">{action.label}</span>
						</Button>
					)}
				</>
			)}

			{/* Error message */}
			{error && (
				<p className="text-destructive absolute right-0 bottom-2 left-0 text-center text-xs">
					{error}
				</p>
			)}
		</div>
	);
}
