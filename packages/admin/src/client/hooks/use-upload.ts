import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { selectClient, useAdminStore } from "../runtime";
import { useUploadCollection } from "./use-upload-collection";

class UploadError extends Error {
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

interface UploadOptions {
	to?: string;
	onProgress?: (progress: number) => void;
	signal?: AbortSignal;
}

interface UploadManyOptions extends UploadOptions {
	onProgress?: (progress: number, fileIndex?: number) => void;
}

interface UseUploadReturn {
	upload: (file: File, options?: UploadOptions) => Promise<Asset>;
	uploadMany: (files: File[], options?: UploadManyOptions) => Promise<Asset[]>;
	isUploading: boolean;
	progress: number;
	error: Error | null;
	reset: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useUpload(): UseUploadReturn {
	const client = useAdminStore(selectClient);
	const queryClient = useQueryClient();
	const {
		collection: defaultUploadCollection,
		collections: uploadCollections,
	} = useUploadCollection();

	const [progress, setProgress] = useState(0);

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

	const uploadMutation = useMutation({
		mutationFn: async ({
			file,
			options,
		}: {
			file: File;
			options?: UploadOptions;
		}) => {
			const { to, onProgress, signal } = options ?? {};
			const targetCollection = resolveTargetCollection(to);

			if (!targetCollection) {
				throw new Error(getMissingCollectionMessage());
			}

			const collectionApi = (client.collections as any)[targetCollection];

			if (!collectionApi?.upload) {
				throw new UploadError(
					`Collection "${targetCollection}" does not support uploads. Make sure .upload() is enabled on the collection.`,
				);
			}

			setProgress(0);

			const result = await collectionApi.upload(file, {
				signal,
				onProgress: (p: number) => {
					setProgress(p);
					onProgress?.(p);
				},
			});

			return { asset: result as Asset, targetCollection };
		},
		onSuccess: ({ targetCollection }) => {
			queryClient.invalidateQueries({
				queryKey: ["questpie", "collections", targetCollection],
			});
		},
	});

	const uploadManyMutation = useMutation({
		mutationFn: async ({
			files,
			options,
		}: {
			files: File[];
			options?: UploadManyOptions;
		}) => {
			const { to, onProgress, signal } = options ?? {};
			const targetCollection = resolveTargetCollection(to);

			if (!targetCollection) {
				throw new Error(getMissingCollectionMessage());
			}

			if (files.length === 0) {
				return { assets: [] as Asset[], targetCollection };
			}

			const collectionApi = (client.collections as any)[targetCollection];

			if (!collectionApi?.uploadMany) {
				throw new UploadError(
					`Collection "${targetCollection}" does not support uploads. Make sure .upload() is enabled on the collection.`,
				);
			}

			setProgress(0);

			const results = await collectionApi.uploadMany(files, {
				signal,
				onProgress: (p: number, fileIndex?: number) => {
					setProgress(p);
					onProgress?.(p, fileIndex);
				},
			});

			setProgress(100);
			return { assets: results as Asset[], targetCollection };
		},
		onSuccess: ({ targetCollection }) => {
			queryClient.invalidateQueries({
				queryKey: ["questpie", "collections", targetCollection],
			});
		},
	});

	return {
		upload: (file, options) =>
			uploadMutation.mutateAsync({ file, options }).then((r) => r.asset),
		uploadMany: (files, options) =>
			uploadManyMutation.mutateAsync({ files, options }).then((r) => r.assets),
		isUploading: uploadMutation.isPending || uploadManyMutation.isPending,
		progress,
		error: uploadMutation.error || uploadManyMutation.error || null,
		reset: () => {
			uploadMutation.reset();
			uploadManyMutation.reset();
			setProgress(0);
		},
	};
}
