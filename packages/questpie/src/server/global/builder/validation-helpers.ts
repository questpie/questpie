/**
 * Validation helpers for globals
 * Creates validation schemas similar to collections
 */

import type { PgColumn } from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";
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
	const updateSchema = createUpdateSchema(validationTable, {
		exclude: _options?.exclude || {},
	});

	return {
		updateSchema,
	};
}
