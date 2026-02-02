/**
 * Email Field Type
 *
 * Email field with RFC 5322 validation.
 * Extends text field with email-specific validation and operators.
 */

import {
	eq,
	ilike,
	inArray,
	isNotNull,
	isNull,
	like,
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
	FieldMetadataBase,
} from "../types.js";

// ============================================================================
// Email Field Meta (augmentable by admin)
// ============================================================================

/**
 * Email field metadata - augmentable by external packages.
 */
export type EmailFieldMeta = {};

// ============================================================================
// Email Field Configuration
// ============================================================================

/**
 * Email field configuration options.
 */
export interface EmailFieldConfig extends BaseFieldConfig {
	/** Field-specific metadata, augmentable by external packages. */
	meta?: EmailFieldMeta;
	/**
	 * Maximum character length.
	 * @default 255
	 */
	maxLength?: number;

	/**
	 * Normalize email to lowercase.
	 * @default true
	 */
	lowercase?: boolean;

	/**
	 * Allowed domains (whitelist).
	 * If provided, only emails from these domains are valid.
	 */
	allowedDomains?: string[];

	/**
	 * Blocked domains (blacklist).
	 * Emails from these domains are rejected.
	 */
	blockedDomains?: string[];
}

// ============================================================================
// Email Field Operators
// ============================================================================

/**
 * Get operators for email field.
 * Includes email-specific operators like domain matching.
 */
function getEmailOperators(): ContextualOperators {
	return {
		column: {
			eq: (col, value) => eq(col, value as string),
			ne: (col, value) => ne(col, value as string),
			like: (col, value) => like(col, value as string),
			ilike: (col, value) => ilike(col, value as string),
			in: (col, values) => inArray(col, values as string[]),
			notIn: (col, values) => notInArray(col, values as string[]),
			// Email-specific operators
			domain: (col, value) => ilike(col, `%@${value}`),
			domainIn: (col, values) => {
				const domains = values as string[];
				if (domains.length === 0) return sql`FALSE`;
				if (domains.length === 1) return ilike(col, `%@${domains[0]}`);
				return sql`(${sql.join(
					domains.map((d) => ilike(col, `%@${d}`)),
					sql` OR `,
				)})`;
			},
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
			like: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' LIKE ${value}`;
			},
			ilike: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${value}`;
			},
			domain: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%" + "@" + value}`;
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

// ============================================================================
// Email Field Definition
// ============================================================================

/**
 * Email field factory.
 * Creates an email field with the given configuration.
 *
 * @example
 * ```ts
 * const email = emailField({ required: true, unique: true });
 * const workEmail = emailField({ allowedDomains: ["company.com", "corp.com"] });
 * const contactEmail = emailField({ blockedDomains: ["spam.com"] });
 * ```
 */
export const emailField = defineField<"email", EmailFieldConfig, string>(
	"email",
	{
		toColumn(_name, config) {
			const { maxLength = 255 } = config;

			// Don't specify column name - Drizzle uses the key name
			let column: any = varchar({ length: maxLength });

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
			// NOTE: unique constraint removed from field level
			// Use .indexes() on collection builder instead

			return column;
		},

		toZodSchema(config) {
			const { lowercase = true } = config;

			let schema = z.string().email();

			// Max length
			if (config.maxLength) {
				schema = schema.max(config.maxLength);
			}

			// Lowercase transform
			if (lowercase) {
				schema = schema.toLowerCase();
			}

			// Domain validation
			if (config.allowedDomains && config.allowedDomains.length > 0) {
				const domains = config.allowedDomains.map((d) => d.toLowerCase());
				schema = schema.refine(
					(email) => {
						const domain = email.split("@")[1]?.toLowerCase();
						return domain && domains.includes(domain);
					},
					{
						message: `Email domain must be one of: ${config.allowedDomains.join(", ")}`,
					},
				);
			}

			if (config.blockedDomains && config.blockedDomains.length > 0) {
				const domains = config.blockedDomains.map((d) => d.toLowerCase());
				schema = schema.refine(
					(email) => {
						const domain = email.split("@")[1]?.toLowerCase();
						return !domain || !domains.includes(domain);
					},
					{
						message: `Email domain is not allowed: ${config.blockedDomains.join(", ")}`,
					},
				);
			}

			// Nullability
			if (!config.required && config.nullable !== false) {
				return schema.nullish();
			}

			return schema;
		},

		getOperators() {
			return getEmailOperators();
		},

		getMetadata(config): FieldMetadataBase {
			return {
				type: "email",
				label: config.label,
				description: config.description,
				required: config.required ?? false,
				localized: config.localized ?? false,
				readOnly: config.input === false,
				writeOnly: config.output === false,
				validation: {
					maxLength: config.maxLength ?? 255,
				},
				meta: config.meta,
			};
		},
	},
);

// Register in default registry
getDefaultRegistry().register("email", emailField);
