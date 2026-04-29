/**
 * Auto Expand Fields Utility
 *
 * Automatically detects upload and relation fields that need to be expanded
 * when fetching data from the backend (e.g., for displaying in list views).
 */

import type { FieldDefinition } from "../builder/field/field";

type AutoExpandWithValue =
	| boolean
	| {
			with?: Record<string, boolean>;
	  };

type AutoExpandWith = Record<string, AutoExpandWithValue>;

interface AutoExpandFieldsConfig {
	/**
	 * Collection fields configuration
	 */
	fields?: Record<string, FieldDefinition>;

	/**
	 * List view configuration
	 */
	list?: {
		/**
		 * Explicit relations to include
		 */
		with?: string[];

		/**
		 * Columns to display
		 */
		columns?: Array<string | { field: string }>;
	};

	/**
	 * Known relation names from collection metadata
	 */
	relations?: string[];
}

function getNestedAvatarRelation(
	fieldDef: FieldDefinition,
): string | undefined {
	const avatarField = (fieldDef as any)?.["~options"]?.listCell?.avatarField as
		| string
		| undefined;

	if (!avatarField || typeof avatarField !== "string") {
		return undefined;
	}

	const [firstSegment, ...rest] = avatarField.split(".");
	if (!firstSegment || rest.length === 0) {
		return undefined;
	}

	return firstSegment;
}

function addRelationExpand(
	withFields: AutoExpandWith,
	relationName: string,
	nestedRelation?: string,
): void {
	if (!nestedRelation) {
		if (!withFields[relationName]) {
			withFields[relationName] = true;
		}
		return;
	}

	const existing = withFields[relationName];
	const nestedWith =
		existing && typeof existing === "object" && !Array.isArray(existing)
			? { ...(existing.with ?? {}) }
			: {};

	nestedWith[nestedRelation] = true;
	withFields[relationName] = { with: nestedWith };
}

/**
 * Auto-detect upload and relation fields that need to be expanded.
 *
 * This analyzes the collection config to determine which fields require
 * data expansion when fetching from the backend:
 * - Upload fields need their asset data expanded
 * - Relation fields need their related record data expanded
 * - Relation avatar chips can request nested relation expansion (e.g. avatar)
 *
 * @param config - Collection configuration with fields and list view settings
 * @returns Object mapping relation names to `true` or nested `with` config
 *
 * @example
 * ```tsx
 * const expandedFields = autoExpandFields({
 *   fields: config?.fields,
 *   list: config?.list,
 * });
 *
 * // Use with query
 * const { data } = useCollectionList(collection, {
 *   with: expandedFields,
 * });
 * ```
 */
export function autoExpandFields(
	config: AutoExpandFieldsConfig,
): AutoExpandWith {
	const withFields: AutoExpandWith = {};

	// Add explicitly configured relations
	if (config.list?.with) {
		for (const rel of config.list.with) {
			withFields[rel] = true;
		}
	}

	// Determine which columns are displayed
	// TODO: this should adhere to visible columns based on adminPrefs
	const columnFields = config.list?.columns ?? [];
	const fieldsToCheck: string[] = [];

	if (columnFields.length > 0) {
		// Use explicitly configured columns
		for (const col of columnFields) {
			const fieldName = typeof col === "string" ? col : col.field;
			if (fieldName === "_title") continue;
			fieldsToCheck.push(fieldName);
		}
	} else if (config.fields) {
		// When columns not set, check all fields (buildColumns auto-generates from them)
		fieldsToCheck.push(...Object.keys(config.fields));
	}

	// Auto-detect upload and relation fields from columns
	for (const fieldName of fieldsToCheck) {
		const fieldDef = config.fields?.[fieldName] as any;
		if (fieldDef) {
			// fieldDef.name contains the field type (e.g., "upload", "relation")
			const fieldType = fieldDef.name;

			// Auto-expand upload and uploadMany fields
			if (fieldType === "upload" || fieldType === "uploadMany") {
				const relationName =
					fieldDef["~options"]?.relationName ?? (fieldName as string);
				if (relationName) {
					withFields[relationName] = true;
				}
			}
			// For relation fields, only expand if relationName is explicitly specified
			// This ensures we don't try to expand relations that don't exist on the backend
			else if (fieldType === "relation") {
				const relationName =
					fieldDef["~options"]?.relationName ?? (fieldName as string);
				const nestedAvatarRelation = getNestedAvatarRelation(fieldDef);
				const knownRelations = config.relations;
				if (!relationName) continue;
				if (!knownRelations || knownRelations.length === 0) {
					addRelationExpand(withFields, relationName, nestedAvatarRelation);
					continue;
				}
				if (knownRelations.includes(relationName)) {
					addRelationExpand(withFields, relationName, nestedAvatarRelation);
				}
			}
		}
	}

	return withFields;
}

/**
 * Check if there are any fields to expand
 */
export function hasFieldsToExpand(expandedFields: AutoExpandWith): boolean {
	return Object.keys(expandedFields).length > 0;
}
