/**
 * Validation helpers for collections
 * Creates merged field definitions for validation purposes
 */

import type { PgColumn } from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import type { Field } from "#questpie/server/fields/field-class.js";
import {
	createInsertSchema,
	createUpdateSchema,
} from "#questpie/server/utils/drizzle-to-zod.js";

/**
 * Merge main table fields with localized fields into a single flat structure
 * This is used for validation where we receive all fields together in the input
 *
 * @example
 * ```ts
 * const mainFields = { name: varchar('name', { length: 255 }), price: integer('price') }
 * const localizedFields = { title: varchar('title', { length: 255 }), description: text('description') }
 *
 * const merged = mergeFi eldsForValidation('products', mainFields, localizedFields)
 * // Result: pgTable with all fields: { name, price, title, description }
 * ```
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
 * Validation schemas for a collection
 */
export interface ValidationSchemas {
	/** Schema for insert operations (create) - may include preprocessing for relation fields */
	insertSchema: z.ZodTypeAny;
	/** Schema for update operations (partial) - may include preprocessing for relation fields */
	updateSchema: z.ZodTypeAny;
}

/**
 * Extract relation field mappings from field definitions.
 *
 * With the unified field API, the FK column key is the same as the field name.
 * This function now returns an empty map since no transformation is needed.
 *
 * @param fieldDefinitions - Collection field definitions
 * @returns Empty map (no transformation needed with unified field API)
 */
export function extractRelationFieldMappings(
	_fieldDefinitions: Record<string, Field<FieldState>>,
): Record<string, string> {
	// With unified field API, field name = column key
	// No transformation needed
	return {};
}

/**
 * Create a Zod preprocessor that normalizes relation field names to FK column names.
 *
 * This allows users to use either:
 * - `{ author: "user-uuid" }` (field name - preferred, matches TypeScript types)
 * - `{ authorId: "user-uuid" }` (FK column name - also accepted)
 *
 * The preprocessor transforms field names to FK column names before validation.
 *
 * @param relationMappings - Map of relation field names to FK column names
 * @returns Zod preprocessor function
 */
function createRelationFieldPreprocessor(
	relationMappings: Record<string, string>,
): (input: unknown) => unknown {
	return (input: unknown) => {
		if (typeof input !== "object" || input === null) {
			return input;
		}

		const result = { ...input } as Record<string, unknown>;

		for (const [fieldName, fkColumnName] of Object.entries(relationMappings)) {
			// If the field name exists with a simple value (string/null)
			if (fieldName in result) {
				const value = result[fieldName];

				// Only transform simple values (string IDs or null), not nested mutation objects
				if (typeof value === "string" || value === null) {
					// Transform: author → authorId
					result[fkColumnName] = value;
					delete result[fieldName];
				}
				// If it's an object (nested mutation), leave it for later processing
				// It will be stripped by passthrough and handled by separateNestedRelations
			}
		}

		return result;
	};
}

/**
 * Create validation schemas for a collection
 *
 * @param tableName - Name of the collection
 * @param mainFields - Non-localized fields from main table
 * @param localizedFields - Localized fields from i18n table
 * @param options - Schema generation options
 */
export function createCollectionValidationSchemas<
	TMainFields extends Record<string, PgColumn>,
	TLocalizedFields extends Record<string, PgColumn>,
>(
	tableName: string,
	mainFields: TMainFields,
	localizedFields: TLocalizedFields,
	options?: {
		/** Fields to exclude from validation (e.g., id, createdAt, updatedAt) */
		exclude?: Record<string, true>;
		/** Custom refinements per field */
		refine?: Record<string, (schema: z.ZodTypeAny) => z.ZodTypeAny>;
		/** Field definitions for relation field name normalization */
		fieldDefinitions?: Record<string, Field<FieldState>>;
	},
): ValidationSchemas {
	// Create merged table for validation
	const validationTable = mergeFieldsForValidation(
		tableName,
		mainFields,
		localizedFields,
	);

	// Generate base schemas using drizzle-to-zod utilities
	const baseInsertSchema = createInsertSchema(validationTable, {
		exclude: options?.exclude || {},
		refine: options?.refine as any,
	});

	const baseUpdateSchema = createUpdateSchema(validationTable, {
		exclude: options?.exclude || {},
		refine: options?.refine as any,
	});

	// If field definitions are provided, add relation field name normalization
	if (options?.fieldDefinitions) {
		const relationMappings = extractRelationFieldMappings(
			options.fieldDefinitions,
		);

		if (Object.keys(relationMappings).length > 0) {
			const preprocessor = createRelationFieldPreprocessor(relationMappings);

			// Wrap schemas with preprocessor to normalize relation field names
			// Use passthrough() to allow extra keys (nested mutations will be stripped later)
			return {
				insertSchema: z.preprocess(
					preprocessor,
					baseInsertSchema.passthrough(),
				),
				updateSchema: z.preprocess(
					preprocessor,
					baseUpdateSchema.passthrough(),
				),
			};
		}
	}

	// Overlay field-level schemas — the field definition is the validation
	// source of truth wherever one exists (.zod() transforms, email format,
	// select enums, array shapes). Column-derived schemas remain for system
	// fields (id, timestamps), legacy raw columns, and the carve-outs below,
	// preserving DB-shape semantics (date coercion, defaults).
	const insertOverrides: Record<string, z.ZodTypeAny> = {};
	const updateOverrides: Record<string, z.ZodTypeAny> = {};

	if (options?.fieldDefinitions) {
		const columnKeys = new Set([
			...Object.keys(mainFields),
			...Object.keys(localizedFields),
		]);

		for (const [key, fieldDef] of Object.entries(options.fieldDefinitions)) {
			// Only keys that actually have a column (skips virtual/hasMany)
			if (!columnKeys.has(key)) continue;
			// Excluded keys stay excluded
			if (options.exclude?.[key]) continue;
			// input:false fields are system-written — keep column semantics
			if (fieldDef._state?.input === false) continue;
			// Relation/upload FK formats are app-defined (custom ids, auth
			// providers) — the field schema's uuid check would reject them.
			const meta = fieldDef.getMetadata?.() as
				| { type?: string; isUpload?: boolean }
				| undefined;
			if (meta?.type === "relation" || meta?.type === "upload") continue;

			let schema: z.ZodTypeAny = fieldDef.toZodSchema();

			// .validation({ refine }) applies on top of the field schema too
			const refineFn = options.refine?.[key];
			if (refineFn) {
				schema = refineFn(schema);
			}

			// inputOptional fields are always optional in input
			insertOverrides[key] =
				fieldDef._state?.input === "optional" &&
				!(schema instanceof z.ZodOptional)
					? schema.optional()
					: schema;
			updateOverrides[key] =
				schema instanceof z.ZodOptional ? schema : schema.optional();
		}
	}

	return {
		insertSchema:
			Object.keys(insertOverrides).length > 0
				? baseInsertSchema.extend(insertOverrides)
				: baseInsertSchema,
		updateSchema:
			Object.keys(updateOverrides).length > 0
				? baseUpdateSchema.extend(updateOverrides)
				: baseUpdateSchema,
	};
}
