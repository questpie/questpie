import { useMemo } from "react";

import type { AdminConfigResponse } from "../types/admin-config";
import { useAdminConfig } from "./use-admin-config";

type UploadConfig = AdminConfigResponse["uploads"];

type UploadCollectionResolution = {
	collection?: string;
	collections: string[];
};

function normalizeCollectionName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function resolveUploadCollection(
	preferred?: string,
	uploads?: UploadConfig,
): string | undefined {
	const preferredCollection = normalizeCollectionName(preferred);
	if (preferredCollection) {
		return preferredCollection;
	}

	const defaultCollection = normalizeCollectionName(uploads?.defaultCollection);
	if (defaultCollection) {
		return defaultCollection;
	}

	if (uploads?.collections?.length === 1) {
		return uploads.collections[0];
	}

	return undefined;
}

/**
 * Stable identity for the "no upload collections" case. Inlining `?? []` would
 * mint a new array every render and defeat the memo below — that fallback, not
 * the query data, was the only unstable input here: `useAdminConfig` is backed
 * by React Query, so `adminConfig.uploads` keeps its identity between renders.
 */
const NO_COLLECTIONS: string[] = [];

export function useUploadCollection(
	preferred?: string,
): UploadCollectionResolution {
	const { data: adminConfig } = useAdminConfig();

	const uploads = adminConfig?.uploads;
	const collections = uploads?.collections ?? NO_COLLECTIONS;

	return useMemo(
		() => ({
			collection: resolveUploadCollection(preferred, uploads),
			collections,
		}),
		[preferred, uploads, collections],
	);
}
