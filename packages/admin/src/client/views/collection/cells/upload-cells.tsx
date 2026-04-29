/**
 * Upload Cell Components
 *
 * Cells for displaying asset/upload fields:
 * - UploadCell - single asset
 * - UploadManyCell - multiple assets
 *
 * Uses unified AssetThumbnail component
 */

import * as React from "react";

import type { FieldInstance } from "../../../builder/field/field";
import { Badge } from "../../../components/ui/badge";
import { useCollectionItem } from "../../../hooks/use-collection";
import { useTranslation } from "../../../i18n/hooks";
import { AssetThumbnail } from "./shared/asset-thumbnail";

// ============================================================================
// Upload Cell
// ============================================================================

/**
 * Upload cell - displays single asset thumbnail or file info
 * Uses AssetThumbnail with size="sm"
 */
export function UploadCell({
	value,
	fieldDef,
}: {
	value: unknown;
	row?: unknown;
	fieldDef?: FieldInstance;
}) {
	if (Array.isArray(value)) {
		return <UploadManyCell value={value} fieldDef={fieldDef} />;
	}

	return <UploadSingleCell value={value} fieldDef={fieldDef} />;
}

// ============================================================================
// Upload Many Cell
// ============================================================================

function getUploadCollection(fieldDef?: FieldInstance): string {
	const options = fieldDef?.["~options"] ?? {};
	const target = options.to ?? options.targetCollection;

	if (typeof target === "string" && target.length > 0) {
		return target;
	}

	return "assets";
}

function getAssetId(value: unknown): string | undefined {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}

	if (typeof value === "object" && value !== null) {
		const id = (value as Record<string, unknown>).id;
		return typeof id === "string" && id.length > 0 ? id : undefined;
	}

	return undefined;
}

function hasAssetDisplayData(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const asset = value as Record<string, unknown>;
	return !!(asset.url || asset.filename || asset.mimeType);
}

function UploadSingleCell({
	value,
	fieldDef,
}: {
	value: unknown;
	fieldDef?: FieldInstance;
}) {
	const collection = getUploadCollection(fieldDef);
	const assetId = getAssetId(value);
	const shouldFetch = !!assetId && !hasAssetDisplayData(value);
	const { data: fetchedAsset } = useCollectionItem(
		collection,
		assetId || "",
		undefined,
		{
			enabled: shouldFetch,
			staleTime: 30_000,
		},
	);

	return (
		<AssetThumbnail asset={fetchedAsset || value} size="sm" showFilename />
	);
}

/**
 * Upload many cell - displays multiple assets count or thumbnails
 */
export function UploadManyCell({
	value,
}: {
	value: unknown;
	fieldDef?: FieldInstance;
}) {
	const { t } = useTranslation();
	if (value === null || value === undefined) {
		return <span className="text-muted-foreground">-</span>;
	}

	if (!Array.isArray(value)) {
		return <span className="text-muted-foreground">-</span>;
	}

	if (value.length === 0) {
		return <span className="text-muted-foreground">-</span>;
	}

	// Get image assets for preview
	const imageAssets = value
		.filter((item): item is Record<string, unknown> => {
			if (typeof item !== "object" || item === null) return false;
			const mimeType = (item as Record<string, unknown>).mimeType;
			return typeof mimeType === "string" && mimeType.startsWith("image/");
		})
		.slice(0, 3);

	// Show mini grid of thumbnails for images
	if (imageAssets.length > 0) {
		const remaining = value.length - imageAssets.length;
		return (
			<div className="flex items-center gap-1">
				<div className="flex -space-x-2">
					{imageAssets.map((asset, index) => (
						<img
							key={(asset.id as string) || index}
							src={asset.url as string}
							alt={(asset.filename as string) || "Asset"}
							className="image-outline bg-background size-6 rounded object-cover"
						/>
					))}
				</div>
				{remaining > 0 && (
					<span className="text-muted-foreground ml-1 text-xs tabular-nums">
						+{remaining}
					</span>
				)}
			</div>
		);
	}

	// Show count badge for non-images
	return (
		<Badge variant="secondary">{t("cell.file", { count: value.length })}</Badge>
	);
}
