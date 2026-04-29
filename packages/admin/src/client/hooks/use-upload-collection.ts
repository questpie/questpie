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

export function useUploadCollection(
	preferred?: string,
): UploadCollectionResolution {
	const { data: adminConfig } = useAdminConfig();

	const collections = adminConfig?.uploads?.collections ?? [];
	const collectionsKey = collections.join("|");

	return useMemo(
		() => ({
			collection: resolveUploadCollection(preferred, adminConfig?.uploads),
			collections,
		}),
		[preferred, collectionsKey, adminConfig?.uploads?.defaultCollection],
	);
}
