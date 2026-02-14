/**
 * Text Field Type
 *
 * String field with varchar or text storage mode.
 * Supports validation, transforms, and search operators.
 */

import { text, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
	stringColumnOperators,
	stringJsonbOperators,
} from "../common-operators.js";
import { field } from "../field.js";
import type { FieldMetadataBase } from "../types.js";

// ============================================================================
// Text Field Meta (augmentable by admin)
// ============================================================================

/**
 * Text field metadata - augmentable by external packages.
 *
 * @example Admin augmentation:
 * ```ts
 * declare module "questpie" {
 *   interface TextFieldMeta {
 *     admin?: {
 *       placeholder?: string;
 *       showCounter?: boolean;
 *       prefix?: string;
 *       suffix?: string;
 *     }
 *   }
 * }
 * ```
 */

// biome-ignore lint/suspicious/noEmptyInterface: we need interface for module augmentation
export interface TextFieldMeta {
	/** Phantom property to prevent interface collapse - enables module augmentation */
	_?: never;
}

// ============================================================================
// Text Field Configuration
// ============================================================================

/**
 * Text field configuration options.
 */
export interface TextFieldConfig extends BaseFieldConfig {
	/**
	 * Field-specific metadata, augmentable by external packages.
	 */
	meta?: TextFieldMeta;
	/**
	 * Storage mode: varchar (default) or text.
	 * - varchar: Fixed max length, slightly more efficient for short strings
	 * - text: Unlimited length, use for potentially long content
	 * @default "varchar"
	 */
	mode?: "varchar" | "text";

	/**
	 * Maximum character length.
	 * Applied to varchar mode and Zod validation.
	 * @default 255
	 */
	maxLength?: number;

	/**
	 * Minimum character length for validation.
	 */
	minLength?: number;

	/**
	 * Regex pattern for validation.
	 * Can be a RegExp or string pattern.
	 */
	pattern?: RegExp | string;

	/**
	 * Trim whitespace from input.
	 * Applied as Zod transform.
	 */
	trim?: boolean;

	/**
	 * Convert to lowercase.
	 * Applied as Zod transform.
	 */
	lowercase?: boolean;

	/**
	 * Convert to uppercase.
	 * Applied as Zod transform.
	 */
	uppercase?: boolean;
}

import type { BaseFieldConfig } from "../types.js";

// ============================================================================
// Text Field Operators
// ============================================================================

/**
 * Get operators for text fields.
 * Provides rich text search and comparison.
 */
function getTextOperators(_config: TextFieldConfig) {
	return {
		column: stringColumnOperators,
		jsonb: stringJsonbOperators,
	};
}

// ============================================================================
// Text Field Definition
// ============================================================================

/**
 * Text field definition.
 * Plain object with generic methods — concrete operator types are preserved.
 *
 * @example
 * ```ts
 * const title = f.text({ required: true, maxLength: 255 });
 * const slug = f.text({ required: true, pattern: /^[a-z0-9-]+$/, lowercase: true });
 * const content = f.text({ mode: "text" });
 * ```
 */
export const textField = field<TextFieldConfig, string>()({
	type: "text" as const,
	_value: undefined as unknown as string,

	toColumn(name: string, config: TextFieldConfig) {
		const { mode = "varchar", maxLength = 255 } = config;

		let column: any =
			mode === "text" ? text(name) : varchar(name, { length: maxLength });

		// Apply constraints
		if (config.required && config.nullable !== true) {
			column = column.notNull();
		}
		if (config.default !== undefined) {
			const defaultValue =
				typeof config.default === "function"
					? config.default()
					: config.default;
			column = column.default(defaultValue as string);
		}

		return column;
	},

	toZodSchema(config: TextFieldConfig) {
		let schema = z.string();

		// Validation rules
		if (config.maxLength !== undefined) {
			schema = schema.max(config.maxLength);
		}
		if (config.minLength !== undefined) {
			schema = schema.min(config.minLength);
		}
		if (config.pattern) {
			const regex =
				typeof config.pattern === "string"
					? new RegExp(config.pattern)
					: config.pattern;
			schema = schema.regex(regex);
		}

		// Transforms
		if (config.trim) {
			schema = schema.trim();
		}
		if (config.lowercase) {
			schema = schema.toLowerCase();
		}
		if (config.uppercase) {
			schema = schema.toUpperCase();
		}

		// Nullability
		if (!config.required && config.nullable !== false) {
			return schema.nullish();
		}

		return schema;
	},

	getOperators<TApp>(config: TextFieldConfig) {
		return getTextOperators(config);
	},

	getMetadata(config: TextFieldConfig): FieldMetadataBase {
		return {
			type: "text",
			label: config.label,
			description: config.description,
			required: config.required ?? false,
			localized: config.localized ?? false,
			readOnly: config.input === false,
			writeOnly: config.output === false,
			validation: {
				maxLength: config.maxLength,
				minLength: config.minLength,
				pattern: config.pattern?.toString(),
			},
			meta: config.meta,
		};
	},
});

// Register in default registry
