/**
 * Email Field Type
 *
 * Email field with RFC 5322 validation.
 * Extends text field with email-specific validation and operators.
 */

import { ilike, inArray, sql } from "drizzle-orm";
import { varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
	stringColumnOperators,
	stringJsonbOperators,
} from "../common-operators.js";
import { field } from "../field.js";
import type { BaseFieldConfig, FieldMetadataBase } from "../types.js";
import { operator } from "../types.js";

// ============================================================================
// Email Field Meta (augmentable by admin)
// ============================================================================

/**
 * Email field metadata - augmentable by external packages.
 */
export interface EmailFieldMeta {
	/** Phantom property to prevent interface collapse - enables module augmentation */
	_?: never;
}

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
function getEmailOperators() {
	return {
		column: {
			...stringColumnOperators,
			in: operator<string[], unknown>((col, values) => inArray(col, values)),
			// Email-specific operators
			domain: operator<string, unknown>((col, value) =>
				ilike(col, `%@${value}`),
			),
			domainIn: operator<string[], unknown>((col, values) => {
				if (values.length === 0) return sql`FALSE`;
				if (values.length === 1) return ilike(col, `%@${values[0]}`);
				return sql`(${sql.join(
					values.map((d) => ilike(col, `%@${d}`)),
					sql` OR `,
				)})`;
			}),
		},
		jsonb: {
			...stringJsonbOperators,
			domain: operator<string, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%" + "@" + value}`;
			}),
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
export const emailField = field<EmailFieldConfig, string>()({
	type: "email" as const,
	_value: undefined as unknown as string,

	toColumn(name: string, config: EmailFieldConfig) {
		const { maxLength = 255 } = config;

		let column: any = varchar(name, { length: maxLength });

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

	toZodSchema(config: EmailFieldConfig) {
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

	getOperators<TApp>(config: EmailFieldConfig) {
		return getEmailOperators();
	},

	getMetadata(config: EmailFieldConfig): FieldMetadataBase {
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
});

// Register in default registry
