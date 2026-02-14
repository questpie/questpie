/**
 * URL Field Type
 *
 * URL field with protocol and format validation.
 * Supports allowed protocols and host-based operators.
 */

import { ilike, like, sql } from "drizzle-orm";
import { text, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
	stringColumnOperators,
	stringJsonbOperators,
} from "../common-operators.js";
import { field } from "../field.js";
import type { BaseFieldConfig, FieldMetadataBase } from "../types.js";
import { operator } from "../types.js";

// ============================================================================
// URL Field Meta (augmentable by admin)
// ============================================================================

/**
 * URL field metadata - augmentable by external packages.
 */
export interface UrlFieldMeta {
	/** Phantom property to prevent interface collapse - enables module augmentation */
	_?: never;
}

// ============================================================================
// URL Field Configuration
// ============================================================================

/**
 * URL field configuration options.
 */
export interface UrlFieldConfig extends BaseFieldConfig {
	/** Field-specific metadata, augmentable by external packages. */
	meta?: UrlFieldMeta;
	/**
	 * Allowed protocols.
	 * @default ["http", "https"]
	 */
	protocols?: string[];

	/**
	 * Maximum character length.
	 * @default 2048
	 */
	maxLength?: number;

	/**
	 * Use text storage mode instead of varchar.
	 * Use for potentially very long URLs.
	 * @default false
	 */
	textMode?: boolean;

	/**
	 * Allowed hosts (whitelist).
	 * If provided, only URLs with these hosts are valid.
	 */
	allowedHosts?: string[];

	/**
	 * Blocked hosts (blacklist).
	 * URLs with these hosts are rejected.
	 */
	blockedHosts?: string[];
}

// ============================================================================
// URL Field Operators
// ============================================================================

/**
 * Get operators for URL field.
 * Includes URL-specific operators like host matching.
 */
function getUrlOperators() {
	return {
		column: {
			...stringColumnOperators,
			// URL-specific operators
			host: operator<string, unknown>((col, value) =>
				ilike(col, `%://${value}%`),
			),
			hostIn: operator<string[], unknown>((col, values) => {
				if (values.length === 0) return sql`FALSE`;
				if (values.length === 1) return ilike(col, `%://${values[0]}%`);
				return sql`(${sql.join(
					values.map((h) => ilike(col, `%://${h}%`)),
					sql` OR `,
				)})`;
			}),
			protocol: operator<string, unknown>((col, value) =>
				like(col, `${value}://%`),
			),
		},
		jsonb: {
			...stringJsonbOperators,
			host: operator<string, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%://" + value + "%"}`;
			}),
			protocol: operator<string, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' LIKE ${value + "://%"}`;
			}),
		},
	};
}

// ============================================================================
// URL Field Definition
// ============================================================================

/**
 * URL field factory.
 * Creates a URL field with the given configuration.
 *
 * @example
 * ```ts
 * const website = urlField({ required: true });
 * const socialLink = urlField({ protocols: ["https"], maxLength: 500 });
 * const internalLink = urlField({ allowedHosts: ["example.com", "app.example.com"] });
 * ```
 */
export const urlField = field<UrlFieldConfig, string>()({
	type: "url" as const,
	_value: undefined as unknown as string,

	toColumn(name: string, config: UrlFieldConfig) {
		const { maxLength = 2048, textMode = false } = config;

		let column: any = textMode
			? text(name)
			: varchar(name, { length: maxLength });

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

	toZodSchema(config: UrlFieldConfig) {
		const { protocols = ["http", "https"], maxLength = 2048 } = config;

		let schema = z.string().url();

		// Max length
		schema = schema.max(maxLength);

		// Protocol validation
		if (protocols.length > 0) {
			const protocolPattern = new RegExp(`^(${protocols.join("|")})://`, "i");
			schema = schema.refine((url) => protocolPattern.test(url), {
				message: `URL must use one of these protocols: ${protocols.join(", ")}`,
			});
		}

		// Host validation
		if (config.allowedHosts && config.allowedHosts.length > 0) {
			const hosts = config.allowedHosts.map((h) => h.toLowerCase());
			schema = schema.refine(
				(url) => {
					try {
						const host = new URL(url).host.toLowerCase();
						return hosts.some((h) => host === h || host.endsWith(`.${h}`));
					} catch {
						return false;
					}
				},
				{
					message: `URL host must be one of: ${config.allowedHosts.join(", ")}`,
				},
			);
		}

		if (config.blockedHosts && config.blockedHosts.length > 0) {
			const hosts = config.blockedHosts.map((h) => h.toLowerCase());
			schema = schema.refine(
				(url) => {
					try {
						const host = new URL(url).host.toLowerCase();
						return !hosts.some((h) => host === h || host.endsWith(`.${h}`));
					} catch {
						return true;
					}
				},
				{
					message: `URL host is not allowed: ${config.blockedHosts.join(", ")}`,
				},
			);
		}

		// Nullability
		if (!config.required && config.nullable !== false) {
			return schema.nullish();
		}

		return schema;
	},

	getOperators<TApp>(config: UrlFieldConfig) {
		return getUrlOperators();
	},

	getMetadata(config: UrlFieldConfig): FieldMetadataBase {
		return {
			type: "url",
			label: config.label,
			description: config.description,
			required: config.required ?? false,
			localized: config.localized ?? false,
			readOnly: config.input === false,
			writeOnly: config.output === false,
			validation: {
				maxLength: config.maxLength ?? 2048,
			},
			meta: config.meta,
		};
	},
});

// Register in default registry
