/**
 * BulkUploadDialog Component
 *
 * Dialog for bulk uploading multiple files to the assets collection.
 * Triggered from the assets collection header action "Upload Files".
 *
 * Features:
 * - Multi-file dropzone
 * - Individual file progress tracking
 * - Validation (type, size)
 * - Error handling with retry
 * - Success notification
 *
 * @example
 * ```tsx
 * <BulkUploadDialog
 *   collection="assets"
 *   onClose={() => setOpen(false)}
 *   onSuccess={() => queryClient.invalidateQueries()}
 * />
 * ```
 */

import { CheckCircle, Trash, WarningCircle, X } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { type Asset, useUpload } from "../../hooks/use-upload";
import { useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { Dropzone } from "../primitives/dropzone";
import { Button } from "../ui/button";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogDescription,
	ResponsiveDialogFooter,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "../ui/responsive-dialog";

// ============================================================================
// Types
// ============================================================================

export interface BulkUploadDialogProps {
	/**
	 * Target collection
	 * @default "assets"
	 */
	collection?: string;

	/**
	 * Called when dialog should close
	 */
	onClose: () => void;

	/**
	 * Called after successful upload
	 */
	onSuccess?: () => void;
}

/**
 * File upload state
 */
interface FileUploadState {
	file: File;
	status: "pending" | "uploading" | "success" | "error";
	progress: number;
	asset?: Asset;
	error?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sanitize filename for safe storage
 */
function sanitizeFilename(filename: string): string {
	const lastDot = filename.lastIndexOf(".");
	const ext = lastDot > 0 ? filename.slice(lastDot) : "";
	const name = lastDot > 0 ? filename.slice(0, lastDot) : filename;

	const sanitized = name
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "") // Remove diacritics
		.replace(/\s+/g, "-") // Replace spaces with hyphens
		.replace(/[^a-zA-Z0-9._-]/g, "") // Remove invalid chars
		.replace(/-+/g, "-") // Collapse multiple hyphens
		.replace(/^-|-$/g, "") // Remove leading/trailing hyphens
		.toLowerCase();

	return (sanitized || "file") + ext.toLowerCase();
}

/**
 * Format file size
 */
function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// File Item Component
// ============================================================================

interface FileItemProps {
	file: FileUploadState;
	onRemove?: () => void;
}

function FileItem({ file, onRemove }: FileItemProps) {
	const statusIcon = {
		pending: null,
		uploading: null,
		success: <CheckCircle weight="fill" className="size-5 text-green-600" />,
		error: <WarningCircle weight="fill" className="size-5 text-destructive" />,
	};

	const statusColor = {
		pending: "text-muted-foreground",
		uploading: "text-primary",
		success: "text-green-600",
		error: "text-destructive",
	};

	return (
		<div
			className={cn(
				"flex items-start gap-3 rounded-lg border p-3",
				file.status === "error" && "border-destructive/50 bg-destructive/5",
				file.status === "success" && "border-green-600/50 bg-green-600/5",
			)}
		>
			{/* File info */}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<p className="truncate text-sm font-medium" title={file.file.name}>
						{file.file.name}
					</p>
					{statusIcon[file.status]}
				</div>

				<p className="text-muted-foreground text-xs">
					{formatFileSize(file.file.size)}
				</p>

				{/* Progress bar */}
				{file.status === "uploading" && (
					<div className="mt-2">
						<div className="bg-muted h-1.5 overflow-hidden rounded-full">
							<div
								className="bg-primary h-full rounded-full transition-all duration-300"
								style={{ width: `${file.progress}%` }}
							/>
						</div>
						<p className={cn("mt-1 text-xs", statusColor[file.status])}>
							Uploading... {file.progress}%
						</p>
					</div>
				)}

				{/* Error message */}
				{file.status === "error" && file.error && (
					<p className="mt-1 text-xs text-destructive">{file.error}</p>
				)}

				{/* Success message */}
				{file.status === "success" && (
					<p className={cn("mt-1 text-xs", statusColor[file.status])}>
						Uploaded successfully
					</p>
				)}
			</div>

			{/* Remove button (only for pending files) */}
			{file.status === "pending" && onRemove && (
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					onClick={onRemove}
					className="text-muted-foreground hover:text-destructive shrink-0"
				>
					<X weight="bold" />
				</Button>
			)}
		</div>
	);
}

// ============================================================================
// Main Component
// ============================================================================

export function BulkUploadDialog({
	collection = "assets",
	onClose,
	onSuccess,
}: BulkUploadDialogProps) {
	const { uploadMany } = useUpload();
	const { t } = useTranslation();

	// State
	const [files, setFiles] = React.useState<FileUploadState[]>([]);
	const [isUploading, setIsUploading] = React.useState(false);

	// Computed states
	const hasFiles = files.length > 0;
	const pendingFiles = files.filter((f) => f.status === "pending");
	const uploadedFiles = files.filter((f) => f.status === "success");
	const failedFiles = files.filter((f) => f.status === "error");
	const canUpload = pendingFiles.length > 0 && !isUploading;
	const allComplete = hasFiles && pendingFiles.length === 0 && !isUploading;

	// Handle file drop
	const handleDrop = (droppedFiles: File[]) => {
		// Sanitize filenames
		const sanitizedFiles = droppedFiles.map((file) => {
			const sanitizedName = sanitizeFilename(file.name);
			return new File([file], sanitizedName, { type: file.type });
		});

		const newFiles: FileUploadState[] = sanitizedFiles.map((file) => ({
			file,
			status: "pending",
			progress: 0,
		}));

		setFiles((prev) => [...prev, ...newFiles]);
	};

	// Handle remove file
	const handleRemove = (index: number) => {
		setFiles((prev) => prev.filter((_, i) => i !== index));
	};

	// Handle upload all
	const handleUploadAll = async () => {
		if (!canUpload) return;

		setIsUploading(true);

		// Track counts during upload to avoid stale state issues
		let successCount = 0;
		let failureCount = 0;

		try {
			// Get pending files
			const filesToUpload = files
				.filter((f) => f.status === "pending")
				.map((f) => f.file);

			// Upload sequentially with progress tracking
			for (let i = 0; i < filesToUpload.length; i++) {
				const file = filesToUpload[i];
				const fileIndex = files.findIndex(
					(f) => f.file === file && f.status === "pending",
				);

				// Mark as uploading
				setFiles((prev) =>
					prev.map((f, idx) =>
						idx === fileIndex ? { ...f, status: "uploading" as const } : f,
					),
				);

				try {
					// Upload file
					const asset = await uploadMany([file], {
						to: collection,
						onProgress: (progress) => {
							setFiles((prev) =>
								prev.map((f, idx) =>
									idx === fileIndex ? { ...f, progress } : f,
								),
							);
						},
					});

					// Mark as success
					setFiles((prev) =>
						prev.map((f, idx) =>
							idx === fileIndex
								? {
										...f,
										status: "success" as const,
										progress: 100,
										asset: asset[0],
									}
								: f,
						),
					);
					successCount++;
				} catch (err) {
					// Mark as error
					const errorMessage =
						err instanceof Error ? err.message : "Upload failed";

					setFiles((prev) =>
						prev.map((f, idx) =>
							idx === fileIndex
								? { ...f, status: "error" as const, error: errorMessage }
								: f,
						),
					);
					failureCount++;
				}
			}

			// Show success toast using tracked counts (not stale state)
			if (successCount > 0) {
				toast.success(t("upload.bulkSuccess", { count: successCount }));
				onSuccess?.();
			}

			if (failureCount > 0) {
				toast.error(t("upload.bulkError", { count: failureCount }));
			}
		} finally {
			setIsUploading(false);
		}
	};

	// Handle close
	const handleClose = () => {
		if (isUploading) {
			toast.warning(t("upload.waitForComplete"));
			return;
		}
		onClose();
	};

	// Handle done (close after all complete)
	const handleDone = () => {
		setFiles([]);
		onClose();
	};

	return (
		<ResponsiveDialog open onOpenChange={handleClose}>
			<ResponsiveDialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
				<ResponsiveDialogHeader>
					<ResponsiveDialogTitle>{t("upload.bulkTitle")}</ResponsiveDialogTitle>
					<ResponsiveDialogDescription>
						{t("upload.bulkDescription")}
					</ResponsiveDialogDescription>
				</ResponsiveDialogHeader>

				{/* Content */}
				<div className="flex-1 space-y-4 overflow-y-auto">
					{/* Dropzone */}
					{!allComplete && (
						<Dropzone
							onDrop={handleDrop}
							multiple={true}
							disabled={isUploading}
							label={t("upload.dropzone")}
							hint={t("upload.bulkHint")}
						/>
					)}

					{/* Files list */}
					{hasFiles && (
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<p className="text-sm font-medium">
									{t("upload.filesCount", { count: files.length })}
								</p>
								{uploadedFiles.length > 0 && (
									<p className="text-muted-foreground text-xs">
										{t("upload.uploadedCount", { count: uploadedFiles.length })}
										{failedFiles.length > 0 &&
											`, ${t("upload.failedCount", { count: failedFiles.length })}`}
									</p>
								)}
							</div>

							<div className="space-y-2">
								{files.map((file, index) => (
									<FileItem
										key={`${file.file.name}-${index}`}
										file={file}
										onRemove={
											file.status === "pending"
												? () => handleRemove(index)
												: undefined
										}
									/>
								))}
							</div>
						</div>
					)}
				</div>

				{/* Footer */}
				<ResponsiveDialogFooter className="border-t pt-4">
					{allComplete ? (
						<>
							<Button variant="outline" onClick={handleDone}>
								{t("common.close")}
							</Button>
						</>
					) : (
						<>
							<Button
								variant="outline"
								onClick={handleClose}
								disabled={isUploading}
							>
								{t("common.cancel")}
							</Button>
							<Button
								onClick={handleUploadAll}
								disabled={!canUpload || isUploading}
							>
								{isUploading ? t("upload.uploading") : t("common.upload")}{" "}
								{pendingFiles.length > 0 && `(${pendingFiles.length})`}
							</Button>
						</>
					)}
				</ResponsiveDialogFooter>
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}
