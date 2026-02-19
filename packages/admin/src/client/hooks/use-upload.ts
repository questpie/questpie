/**
 * useUpload Hook
 *
 * Handles file uploads to the app with progress tracking.
 * Uses the QuestpieClient's upload method which uses XMLHttpRequest for progress.
 *
 * @example
 * ```tsx
 * const { upload, uploadMany, isUploading, progress } = useUpload();
 *
 * // Single file upload
 * const asset = await upload(file);
 *
 * // Multiple files upload
 * const assets = await uploadMany(files, {
 *   onProgress: (p) => console.log(`${p}%`),
 * });
 * ```
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { selectClient, useAdminStore } from "../runtime";
import { useUploadCollection } from "./use-upload-collection";

/**
 * Upload error with additional context
 */
export class UploadError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly response?: unknown,
	) {
		super(message);
		this.name = "UploadError";
	}
}

// ============================================================================
// Types
// ============================================================================

/**
 * Asset record returned from upload
 */
export interface Asset {
	id: string;
	key: string;
	filename: string;
	mimeType: string;
	size: number;
	visibility: "public" | "private";
	url?: string;
	width?: number | null;
	height?: number | null;
	alt?: string | null;
	caption?: string | null;
	createdAt?: string;
	updatedAt?: string;
}

/**
 * Options for upload operations
 */
export interface UploadOptions {
	/**
	 * Target collection for upload (must have .upload() enabled)
	 */
	to?: string;

	/**
	 * Progress callback (0-100)
	 */
	onProgress?: (progress: number) => void;

	/**
	 * Abort signal for cancellation
	 */
	signal?: AbortSignal;
}

/**
 * Options for uploadMany operation
 */
export interface UploadManyOptions extends UploadOptions {
	/**
	 * Progress callback receives overall progress (0-100)
	 * and optionally individual file progress
	 */
	onProgress?: (progress: number, fileIndex?: number) => void;
}

/**
 * Return type for useUpload hook
 */
export interface UseUploadReturn {
	/**
	 * Upload a single file
	 */
	upload: (file: File, options?: UploadOptions) => Promise<Asset>;

	/**
	 * Upload multiple files sequentially
	 */
	uploadMany: (files: File[], options?: UploadManyOptions) => Promise<Asset[]>;

	/**
	 * Whether an upload is currently in progress
	 */
	isUploading: boolean;

	/**
	 * Current upload progress (0-100)
	 */
	progress: number;

	/**
	 * Current error, if any
	 */
	error: Error | null;

	/**
	 * Reset state (clear error, progress)
	 */
	reset: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for uploading files to the app
 *
 * Uses the QuestpieClient's built-in upload method which provides
 * progress tracking via XMLHttpRequest.
 */
export function useUpload(): UseUploadReturn {
	const client = useAdminStore(selectClient);
	const queryClient = useQueryClient();
	const {
		collection: defaultUploadCollection,
		collections: uploadCollections,
	} = useUploadCollection();

	const [isUploading, setIsUploading] = useState(false);
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<Error | null>(null);

	const resolveTargetCollection = useCallback(
		(to?: string): string | undefined => {
			const explicit = typeof to === "string" ? to.trim() : "";
			if (explicit.length > 0) {
				return explicit;
			}

			return defaultUploadCollection;
		},
		[defaultUploadCollection],
	);

	const getMissingCollectionMessage = useCallback((): string => {
		if (uploadCollections.length === 0) {
			return "No upload-enabled collection is registered. Configure a collection with .upload() and ensure it is accessible in admin config.";
		}

		if (uploadCollections.length > 1) {
			return `Multiple upload collections are available (${uploadCollections.join(", ")}). Pass UploadOptions.to to select one.`;
		}

		return "Upload collection is not configured.";
	}, [uploadCollections]);

	/**
	 * Upload a single file
	 */
	const upload = useCallback(
		async (file: File, options: UploadOptions = {}): Promise<Asset> => {
			const { to, onProgress, signal } = options;
			const targetCollection = resolveTargetCollection(to);

			if (!targetCollection) {
				const missingCollectionError = new Error(getMissingCollectionMessage());
				setError(missingCollectionError);
				throw missingCollectionError;
			}

			setIsUploading(true);
			setProgress(0);
			setError(null);

			try {
				// Get the collection API from client
				const collectionApi = (client.collections as any)[targetCollection];

				if (!collectionApi?.upload) {
					throw new Error(
						`Collection "${targetCollection}" does not support uploads. Make sure .upload() is enabled on the collection.`,
					);
				}

				const result = await collectionApi.upload(file, {
					signal,
					onProgress: (p: number) => {
						setProgress(p);
						onProgress?.(p);
					},
				});

				// Invalidate collection queries to refresh lists
				queryClient.invalidateQueries({
					queryKey: ["questpie", "collections", targetCollection],
				});

				return result as Asset;
			} catch (err) {
				const uploadError =
					err instanceof Error ? err : new Error("Upload failed");
				setError(uploadError);
				throw uploadError;
			} finally {
				setIsUploading(false);
			}
		},
		[client, queryClient, resolveTargetCollection, getMissingCollectionMessage],
	);

	/**
	 * Upload multiple files sequentially
	 */
	const uploadMany = useCallback(
		async (
			files: File[],
			options: UploadManyOptions = {},
		): Promise<Asset[]> => {
			const { to, onProgress, signal } = options;
			const targetCollection = resolveTargetCollection(to);

			if (!targetCollection) {
				const missingCollectionError = new Error(getMissingCollectionMessage());
				setError(missingCollectionError);
				throw missingCollectionError;
			}

			if (files.length === 0) {
				return [];
			}

			setIsUploading(true);
			setProgress(0);
			setError(null);

			try {
				// Get the collection API from client
				const collectionApi = (client.collections as any)[targetCollection];

				if (!collectionApi?.uploadMany) {
					throw new Error(
						`Collection "${targetCollection}" does not support uploads. Make sure .upload() is enabled on the collection.`,
					);
				}

				const results = await collectionApi.uploadMany(files, {
					signal,
					onProgress: (p: number, fileIndex?: number) => {
						setProgress(p);
						onProgress?.(p, fileIndex);
					},
				});

				// Invalidate collection queries
				queryClient.invalidateQueries({
					queryKey: ["questpie", "collections", targetCollection],
				});

				setProgress(100);
				return results as Asset[];
			} catch (err) {
				const uploadError =
					err instanceof Error ? err : new Error("Upload failed");
				setError(uploadError);
				throw uploadError;
			} finally {
				setIsUploading(false);
			}
		},
		[client, queryClient, resolveTargetCollection, getMissingCollectionMessage],
	);

	/**
	 * Reset hook state
	 */
	const reset = useCallback(() => {
		setIsUploading(false);
		setProgress(0);
		setError(null);
	}, []);

	return {
		upload,
		uploadMany,
		isUploading,
		progress,
		error,
		reset,
	};
}
