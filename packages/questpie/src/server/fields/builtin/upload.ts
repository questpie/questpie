/**
 * Upload Field Type
 *
 * File upload field that references assets collection.
 * Supports single uploads and many-to-many relations with mime type and size validation.
 */

import { sql } from "drizzle-orm";
import { varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
	stringColumnOperators,
	stringJsonbOperators,
} from "../common-operators.js";
import { field } from "../field.js";
import {
	type BaseFieldConfig,
	operator,
	type RelationFieldMetadata,
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
export interface UploadFieldMeta {
	/** Phantom property to prevent interface collapse - enables module augmentation */
	_?: never;
}

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
function getSingleUploadOperators() {
	return {
		column: stringColumnOperators,
		jsonb: stringJsonbOperators,
	};
}

/**
 * Get operators for many-to-many upload field.
 */
function getToManyUploadOperators() {
	const toManyOps = {
		// Placeholder operators - actual implementation in query builder
		some: operator<boolean, unknown>(() => sql`TRUE`),
		none: operator<boolean, unknown>(() => sql`TRUE`),
		every: operator<boolean, unknown>(() => sql`TRUE`),
		count: operator<number, unknown>(() => sql`0`),
	} as const;
	return {
		column: toManyOps,
		jsonb: toManyOps,
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
export const uploadField = field<UploadFieldConfig, string | string[]>()({
	type: "upload" as const,
	_value: undefined as unknown as string | string[],
	toColumn(name: string, config: UploadFieldConfig) {
		if (config.through) {
			return null as any;
		}

		let column: any = varchar(name, { length: 36 }); // UUID length

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

	toZodSchema(config: UploadFieldConfig) {
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

	getOperators<TApp>(config: UploadFieldConfig) {
		return config.through
			? getToManyUploadOperators()
			: getSingleUploadOperators();
	},

	getMetadata(config: UploadFieldConfig): RelationFieldMetadata {
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
			// Mark as upload field for reliable detection in admin UI
			// This avoids fragile detection based on targetCollection name
			isUpload: true,
			meta: config.meta,
		};
	},
});

// Register in default registry
