/**
 * Upload Field Type
 *
 * File upload field that references assets collection.
 * Supports single uploads and many-to-many relations with mime type and size validation.
 */

import {
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	notInArray,
	sql,
} from "drizzle-orm";
import { varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import { defineField } from "../define-field.js";
import { getDefaultRegistry } from "../registry.js";
import type {
	BaseFieldConfig,
	ContextualOperators,
	RelationFieldMetadata,
} from "../types.js";

// ============================================================================
// Upload Field Meta (augmentable by admin)
// ============================================================================

/**
 * Upload field metadata - augmentable by external packages.
 *
 * @example Admin augmentation:
 * ```ts
 * declare module "questpie" {
 *   interface UploadFieldMeta {
 *     admin?: {
 *       accept?: string;
 *       dropzoneText?: string;
 *     }
 *   }
 * }
 * ```
 */
export interface UploadFieldMeta {}

// ============================================================================
// Upload Field Configuration
// ============================================================================

/**
 * Upload field configuration options.
 */
export interface UploadFieldConfig extends BaseFieldConfig {
	/** Field-specific metadata, augmentable by external packages. */
	meta?: UploadFieldMeta;
	/**
	 * Allowed MIME types.
	 * If not provided, all types are allowed.
	 * @example ["image/png", "image/jpeg", "image/gif"]
	 * @example ["image/*"] // Wildcard for all images
	 * @example ["application/pdf", "application/msword"]
	 */
	mimeTypes?: string[];

	/**
	 * Maximum file size in bytes.
	 * Applied during upload validation.
	 */
	maxSize?: number;

	/**
	 * Target upload collection name.
	 * @default "assets"
	 * @example "assets"
	 * @example "media"
	 */
	to?: string;

	/**
	 * Junction collection name for many-to-many uploads.
	 * @example "post_assets"
	 */
	through?: string;

	/**
	 * Source field on junction table (points to this collection).
	 */
	sourceField?: string;

	/**
	 * Target field on junction table (points to upload collection).
	 */
	targetField?: string;
}

// ============================================================================
// Upload Field Operators
// ============================================================================

/**
 * Get operators for single upload field.
 */
function getSingleUploadOperators(): ContextualOperators {
	return {
		column: {
			eq: (col, value) => eq(col, value as string),
			ne: (col, value) => ne(col, value as string),
			in: (col, values) => inArray(col, values as string[]),
			notIn: (col, values) => notInArray(col, values as string[]),
			isNull: (col) => isNull(col),
			isNotNull: (col) => isNotNull(col),
		},
		jsonb: {
			eq: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' = ${value}`;
			},
			ne: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' != ${value}`;
			},
			in: (col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' = ANY(${values}::text[])`;
			},
			notIn: (col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`NOT (${col}#>>'{${sql.raw(path)}}' = ANY(${values}::text[]))`;
			},
			isNull: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
			},
			isNotNull: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
			},
		},
	};
}

/**
 * Get operators for many-to-many upload field.
 */
function getToManyUploadOperators(): ContextualOperators {
	return {
		column: {
			// Placeholder operators - actual implementation in query builder
			some: () => sql`TRUE`,
			none: () => sql`TRUE`,
			every: () => sql`TRUE`,
			count: () => sql`0`,
		},
		jsonb: {
			some: () => sql`TRUE`,
			none: () => sql`TRUE`,
			every: () => sql`TRUE`,
			count: () => sql`0`,
		},
	};
}

// ============================================================================
// Upload Field Definition
// ============================================================================

/**
 * Upload field factory.
 * Creates a file upload field with the given configuration.
 *
 * @example
 * ```ts
 * const avatar = uploadField({ mimeTypes: ["image/*"], maxSize: 5_000_000 });
 * const documents = uploadField({ to: "media" });
 * const gallery = uploadField({
 *   to: "assets",
 *   through: "post_assets",
 *   sourceField: "post",
 *   targetField: "asset",
 * });
 * ```
 */
export const uploadField = defineField<
	"upload",
	UploadFieldConfig,
	string | string[]
>("upload", {
	toColumn(name, config) {
		if (config.through) {
			return null as any;
		}

		// Don't specify column name - Drizzle uses the key name
		let column: any = varchar({ length: 36 }); // UUID length

		// Apply constraints
		if (config.required && config.nullable !== true) {
			column = column.notNull();
		}
		if (config.default !== undefined) {
			const defaultValue =
				typeof config.default === "function"
					? config.default()
					: config.default;
			column = column.default(defaultValue);
		}
		// NOTE: unique constraint removed from field level
		// Use .indexes() on collection builder instead

		return column;
	},

	toZodSchema(config) {
		if (config.through) {
			const schema = z.array(z.string().uuid());

			if (!config.required && config.nullable !== false) {
				return schema.nullish();
			}

			return schema;
		}

		const schema = z.string().uuid();

		if (!config.required && config.nullable !== false) {
			return schema.nullish();
		}

		return schema;
	},

	getOperators(config) {
		return config.through
			? getToManyUploadOperators()
			: getSingleUploadOperators();
	},

	getMetadata(config): RelationFieldMetadata {
		return {
			type: "relation",
			label: config.label,
			description: config.description,
			required: config.required ?? false,
			localized: config.localized ?? false,
			readOnly: config.input === false,
			writeOnly: config.output === false,
			targetCollection: config.to ?? "assets",
			relationType: config.through ? "manyToMany" : "belongsTo",
			through: config.through,
			sourceField: config.sourceField,
			targetField: config.targetField,
			meta: config.meta,
		};
	},
});

// Register in default registry
getDefaultRegistry().register("upload", uploadField);
