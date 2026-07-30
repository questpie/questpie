/**
 * Validation helpers for globals
 * Creates validation schemas similar to collections
 */

import type { PgColumn } from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import type { Field } from "#questpie/server/fields/field-class.js";
import { createUpdateSchema } from "#questpie/server/utils/drizzle-to-zod.js";

import type { GlobalValidationSchemas } from "./types.js";

/**
 * Merge main table fields with localized fields into a single flat structure
 * This is used for validation where we receive all fields together in the input
 */
export function mergeFieldsForValidation<
	TMainFields extends Record<string, PgColumn>,
	TLocalizedFields extends Record<string, PgColumn>,
>(
	tableName: string,
	mainFields: TMainFields,
	localizedFields: TLocalizedFields,
): ReturnType<
	typeof pgTable<
		string,
		TMainFields & TLocalizedFields extends infer R
			? R extends Record<string, PgColumn>
				? R
				: never
			: never
	>
> {
	// Merge fields into single object
	const mergedFields = {
		...mainFields,
		...localizedFields,
	} as TMainFields & TLocalizedFields;

	// Create a virtual table for validation purposes
	// This table is never actually used in the database
	return pgTable(`${tableName}_validation`, mergedFields) as any;
}

/**
 * Create validation schema for a global
 *
 * @param tableName - Name of the global
 * @param mainFields - Non-localized fields from main table
 * @param localizedFields - Localized fields from i18n table
 * @param options - Schema generation options
 */
export function createGlobalValidationSchema<
	TMainFields extends Record<string, PgColumn>,
	TLocalizedFields extends Record<string, PgColumn>,
>(
	tableName: string,
	mainFields: TMainFields,
	localizedFields: TLocalizedFields,
	_options?: {
		/** Fields to exclude from validation (e.g., id, createdAt, updatedAt) */
		exclude?: Record<string, true>;
		/** Field definitions, for the field-schema overlay below */
		fieldDefinitions?: Record<string, Field<FieldState>>;
	},
): GlobalValidationSchemas {
	// Create merged table for validation
	const validationTable = mergeFieldsForValidation(
		tableName,
		mainFields,
		localizedFields,
	);

	// Generate update schema using drizzle-to-zod utilities
	// Globals only have update operations (no create since they are singletons)
	const baseUpdateSchema = createUpdateSchema(validationTable, {
		exclude: _options?.exclude || {},
	});

	// Overlay field-level schemas, exactly as collections do. Without this a
	// global's published schema is column-derived only, so an f.email() on a
	// global loses its format and an f.select() loses its enum while the
	// identical field on a collection keeps both. The carve-outs match
	// collection/builder/validation-helpers.ts — diverging here is what
	// produced the gap in the first place.
	const updateOverrides: Record<string, z.ZodTypeAny> = {};

	if (_options?.fieldDefinitions) {
		const columnKeys = new Set([
			...Object.keys(mainFields),
			...Object.keys(localizedFields),
		]);

		for (const [key, fieldDef] of Object.entries(_options.fieldDefinitions)) {
			const meta = fieldDef.getMetadata?.() as
				| { type?: string; relationType?: string }
				| undefined;
			const isPolymorphicRelation =
				meta?.type === "relation" && meta.relationType === "morphTo";
			// Only keys backed by a column (skips virtual/hasMany). Morph fields
			// are one logical input over two physical columns.
			if (!columnKeys.has(key) && !isPolymorphicRelation) continue;
			if (_options.exclude?.[key]) continue;
			// input:false fields are system-written — keep column semantics
			if (fieldDef._state?.input === false) continue;
			// Relation/upload FK formats are app-defined (custom ids, auth
			// providers); the field schema's uuid check would reject them.
			if (
				(meta?.type === "relation" && !isPolymorphicRelation) ||
				meta?.type === "upload"
			) {
				continue;
			}

			const schema: z.ZodTypeAny = fieldDef.toZodSchema();
			updateOverrides[key] =
				schema instanceof z.ZodOptional ? schema : schema.optional();
		}
	}

	return {
		updateSchema:
			Object.keys(updateOverrides).length > 0
				? baseUpdateSchema.extend(updateOverrides)
				: baseUpdateSchema,
	};
}
