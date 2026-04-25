/**
 * Column Defaults Computation
 *
 * Functions for computing default visible columns and available fields
 * Extracted from build-columns.tsx
 */

import type { FieldInstance } from "../../../builder/field/field";
import { formatFieldLabel } from "../cells/shared/cell-helpers";
import type { ColumnField, ComputeDefaultColumnsOptions } from "./types";

// ============================================================================
// Constants
// ============================================================================

/**
 * System fields that are typically auto-generated and not user-editable
 */
const SYSTEM_FIELDS = new Set([
	"id",
	"createdAt",
	"updatedAt",
	"deletedAt",
	"createdBy",
	"updatedBy",
]);

// ============================================================================
// Default Column Computation
// ============================================================================

/**
 * Compute sane default visible columns for a collection
 *
 * Default columns are selected with the following logic:
 * 1. If configuredColumns is provided (from .list()), use those + title
 * 2. Otherwise, auto-detect:
 *    - Title field first
 *    - Up to 4 content fields (non-system, non-relation, non-upload)
 *    - `createdAt` at the end (if timestamps enabled)
 *
 * @param fields - Field definitions from collection config
 * @param options - Optional metadata and configured columns
 * @returns Array of field names for default visible columns
 */
export function computeDefaultColumns(
	fields?: Record<string, FieldInstance>,
	options?: ComputeDefaultColumnsOptions,
): string[] {
	// Determine the title column to use
	const titleFieldName = options?.meta?.title?.fieldName;
	const titleType = options?.meta?.title?.type;
	const useTitleField = titleType === "field" && titleFieldName;
	const titleColumn = useTitleField ? titleFieldName : "_title";

	// If columns are explicitly configured in .list(), use those
	if (options?.configuredColumns && options.configuredColumns.length > 0) {
		const configuredNames = options.configuredColumns.map((col) =>
			typeof col === "string" ? col : col.field,
		);

		// Always include title column first, then configured columns (excluding title to avoid dupe)
		const defaultCols: string[] = [titleColumn];
		for (const colName of configuredNames) {
			if (colName !== titleColumn) {
				defaultCols.push(colName);
			}
		}
		return defaultCols;
	}

	// No configured columns - show ALL fields by default
	// This ensures users see everything when no explicit column config is provided
	const defaultCols: string[] = [titleColumn];

	if (!fields || Object.keys(fields).length === 0) {
		return defaultCols;
	}

	// Add all content fields (non-system fields first, then system fields)
	const contentFields: string[] = [];
	const systemFields: string[] = [];

	for (const key of Object.keys(fields)) {
		// Skip the title field if we're already showing it
		if (useTitleField && key === titleFieldName) continue;

		if (SYSTEM_FIELDS.has(key)) {
			systemFields.push(key);
		} else {
			contentFields.push(key);
		}
	}

	// Add all content fields
	defaultCols.push(...contentFields);

	// Add createdAt at the end if timestamps enabled (from meta or field existence)
	const hasTimestamps = options?.meta?.timestamps ?? !!fields.createdAt;
	if (hasTimestamps && !defaultCols.includes("createdAt")) {
		defaultCols.push("createdAt");
	}

	return defaultCols;
}

// ============================================================================
// Available Fields
// ============================================================================

/**
 * Get all available fields for the column picker
 *
 * Includes all fields (both content and system fields) so users can
 * choose to display any field in their view.
 *
 * @param fields - Field definitions from collection config
 * @param options - Optional metadata from backend
 * @returns Array of available field info for the column picker
 */
export function getAllAvailableFields(
	fields?: Record<string, FieldInstance>,
	options?: ComputeDefaultColumnsOptions,
): ColumnField[] {
	const availableFields: ColumnField[] = [];

	// Determine title field from meta
	const titleFieldName = options?.meta?.title?.fieldName;
	const titleType = options?.meta?.title?.type;
	const useTitleField = titleType === "field" && titleFieldName;

	// Only add _title as an option if title is NOT a real field
	// (i.e., title is virtual/computed, so _title is the way to access it)
	if (!useTitleField) {
		// For virtual titles, show the virtual field's label instead of generic "Title"
		if (titleType === "virtual" && titleFieldName && fields?.[titleFieldName]) {
			const titleFieldDef = fields[titleFieldName];
			const titleFieldOptions = (titleFieldDef?.["~options"] ?? {}) as Record<
				string,
				any
			>;
			const titleLabel =
				titleFieldOptions.label ?? formatFieldLabel(titleFieldName);
			availableFields.push({
				name: "_title",
				label: titleLabel,
				type: "text",
				isSystem: false,
				options: undefined,
			});
		} else {
			// Fallback to generic "Title" when no title defined or field not found
			availableFields.push({
				name: "_title",
				label: "Title",
				type: "text",
				isSystem: false,
				options: undefined,
			});
		}
	}

	if (!fields) return availableFields;

	// Add all fields from config (except virtual title field to avoid duplication)
	for (const [key, fieldDef] of Object.entries(fields)) {
		// Skip the virtual title field since we already added _title for it
		if (titleType === "virtual" && key === titleFieldName) continue;

		const fieldType = fieldDef?.name ?? "text";
		const fieldOptions = (fieldDef?.["~options"] ?? {}) as Record<string, any>;
		const label = fieldOptions.label ?? formatFieldLabel(key);
		const isSystem = SYSTEM_FIELDS.has(key);

		availableFields.push({
			name: key,
			label,
			type: fieldType,
			isSystem,
			options: fieldOptions,
		});
	}

	// Include timestamp system fields when collection has timestamps enabled
	if (options?.meta?.timestamps) {
		if (!fields?.createdAt) {
			availableFields.push({
				name: "createdAt",
				label: "Created At",
				type: "date",
				isSystem: true,
				options: undefined,
			});
		}
		if (!fields?.updatedAt) {
			availableFields.push({
				name: "updatedAt",
				label: "Updated At",
				type: "date",
				isSystem: true,
				options: undefined,
			});
		}
	}

	return availableFields;
}

/**
 * Format field name as header (camelCase to Title Case)
 */
export function formatHeader(fieldName: string): string {
	return formatFieldLabel(fieldName);
}
