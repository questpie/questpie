/**
 * Shared types for relation display components
 */

import type * as React from "react";

import type { ComponentReference } from "#questpie/admin/server/augmentation.js";

import type { FieldInstance } from "../../../../builder/field/field";
import { formatLabel } from "../../../../lib/utils";
import { DefaultCell } from "../../../../views/collection/cells";

/**
 * Icon type that can be a React component or a server-defined ComponentReference
 */
export type IconType =
	| React.ComponentType<{ className?: string }>
	| ComponentReference
	| undefined;

/**
 * Display mode for relation items
 */
export type RelationDisplayMode = "chips" | "list" | "table" | "cards" | "grid";

/**
 * Action handlers for relation items
 */
export interface RelationItemActions {
	onEdit?: (item: any) => void;
	onRemove?: (item: any) => void;
	onNavigate?: (item: any) => void;
}

/**
 * Field mapping for cards/grid display
 */
export interface RelationDisplayFields {
	title?: string;
	subtitle?: string;
	image?: string;
	meta?: string[];
}

/**
 * Collection field definitions for cell rendering
 */
export interface CollectionFieldsConfig {
	fields?: Record<string, FieldInstance>;
}

/**
 * Common props for all display components
 */
export interface RelationDisplayProps {
	/**
	 * Items to display
	 */
	items: any[];

	/**
	 * Collection name for navigation links
	 */
	collection: string;

	/**
	 * Collection icon (React component or server ComponentReference)
	 */
	collectionIcon?: IconType;

	/**
	 * Action handlers
	 */
	actions?: RelationItemActions;

	/**
	 * Whether items are editable (shows edit/remove buttons)
	 */
	editable?: boolean;

	/**
	 * Whether items are orderable (shows drag handle)
	 */
	orderable?: boolean;

	/**
	 * Columns to show in table display
	 */
	columns?: string[];

	/**
	 * Field mapping for cards/grid display
	 */
	fields?: RelationDisplayFields;

	/**
	 * Number of columns for grid/cards layout
	 */
	gridColumns?: 1 | 2 | 3 | 4;

	/**
	 * Whether to show navigation link to detail page
	 */
	linkToDetail?: boolean;

	/**
	 * Custom render function for items
	 */
	renderItem?: (item: any, index: number) => React.ReactNode;

	/**
	 * Collection config for cell rendering (enables proper cell components)
	 */
	collectionConfig?: CollectionFieldsConfig;

	/**
	 * Whether items are being loaded
	 */
	isLoading?: boolean;

	/**
	 * Number of skeleton items to show when loading
	 */
	loadingCount?: number;
}

/**
 * Get display value from item (_title fallback chain)
 */
export function getItemDisplayValue(item: any): string {
	return item?._title || item?.name || item?.title || item?.id || "";
}

/**
 * Format column header (camelCase to Title Case)
 */
export function formatColumnHeader(column: string): string {
	if (column === "_title") return "Name";
	return formatLabel(column);
}

/**
 * Format cell value for display
 */
export function formatCellValue(value: unknown): string {
	if (value === null || value === undefined) return "-";
	if (typeof value === "boolean") return value ? "Yes" : "No";
	if (value instanceof Date) return value.toLocaleDateString();
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

/**
 * Get image URL from item field
 */
export function getImageUrl(item: any, imageField?: string): string | null {
	if (!imageField) return null;
	const imageValue = item[imageField];
	if (typeof imageValue === "string") return imageValue;
	if (imageValue?.url) return imageValue.url;
	if (imageValue?.key) return imageValue.key;
	return null;
}

/**
 * Field types that need fieldDef passed to their cell component
 */
const FIELD_TYPES_NEEDING_FIELD_DEF = new Set([
	"object",
	"array",
	"relation",
	"reverseRelation",
]);

/**
 * Resolved cell info for rendering
 */
interface ResolvedCell {
	component: React.ComponentType<{
		value: unknown;
		row?: unknown;
		fieldDef?: FieldInstance;
	}>;
	fieldDef?: FieldInstance;
	needsFieldDef: boolean;
	accessorKey: string;
}

/**
 * Resolve cell component for a column based on field config
 * Uses the same priority as buildColumns:
 * 1. Cell from field registry (fieldDef.cell.component)
 * 2. DefaultCell fallback
 */
export function resolveCellForColumn(
	column: string,
	collectionConfig?: CollectionFieldsConfig,
): ResolvedCell {
	const fieldDef = collectionConfig?.fields?.[column];
	const fieldType = fieldDef?.name ?? "text";
	const fieldOptions = (fieldDef as any)?.["~options"] ?? {};

	// Resolve cell component
	let component: React.ComponentType<{
		value: unknown;
		row?: unknown;
		fieldDef?: FieldInstance;
	}>;

	if (fieldDef?.cell) {
		// Cell from field registry
		component = fieldDef.cell as React.ComponentType<{
			value: unknown;
			row?: unknown;
			fieldDef?: FieldInstance;
		}>;
	} else {
		// DefaultCell fallback
		component = DefaultCell;
	}

	const needsFieldDef = FIELD_TYPES_NEEDING_FIELD_DEF.has(fieldType);

	// For relation fields, use relationName as accessor if specified
	const accessorKey: string =
		fieldType === "relation" && fieldOptions.relationName
			? fieldOptions.relationName
			: column;

	return {
		component,
		fieldDef,
		needsFieldDef,
		accessorKey,
	};
}
