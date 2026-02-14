/**
 * Relation Field Type
 *
 * Unified field for defining all types of relationships between collections:
 * - belongsTo: FK column on this table (default)
 * - hasMany: FK on target table
 * - manyToMany: Junction table
 * - multiple: Inline array of FKs (jsonb)
 * - morphTo: Polymorphic relation (type + id columns)
 * - morphMany: Reverse polymorphic
 *
 * Replaces legacy .relations() method - all relations are now defined in .fields()
 */

import { eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { jsonb, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import { field } from "../field.js";
import type { OptionsConfig } from "../reactive.js";
import type {
	BaseFieldConfig,
	FieldMetadataBase,
	RelationFieldMetadata,
} from "../types.js";
import { operator } from "../types.js";

// ============================================================================
// Relation Field Meta (augmentable by admin)
// ============================================================================

/**
 * Relation field metadata - augmentable by external packages.
 *
 * @example Admin augmentation:
 * ```ts
 * declare module "questpie" {
 *   interface RelationFieldMeta {
 *     admin?: {
 *       displayAs?: "select" | "table" | "cards" | "list";
 *       displayFields?: string[];
 *       titleField?: string;
 *       allowCreate?: boolean;
 *       allowEdit?: boolean;
 *       preload?: boolean;
 *       maxItems?: number;
 *     }
 *   }
 * }
 * ```
 */
export interface RelationFieldMeta {
	/** Phantom property to prevent interface collapse - enables module augmentation */
	_?: never;
}

// ============================================================================
// Relation Field Configuration
// ============================================================================

/**
 * Referential action options for FK constraints.
 */
export type ReferentialAction =
	| "cascade"
	| "set null"
	| "restrict"
	| "no action";

/**
 * Inferred relation type based on config.
 */
export type InferredRelationType =
	| "belongsTo"
	| "hasMany"
	| "manyToMany"
	| "multiple"
	| "morphTo"
	| "morphMany";

/**
 * Target collection specification.
 * Supports multiple formats:
 * - String literal: `"users"` - collection name (handles circular refs, type-safe via QuestpieApp)
 * - Callback: `() => users` - lazy reference to collection
 * - Polymorphic object: `{ users: "users", posts: "posts" }` - multiple possible targets
 */
export type RelationTarget =
	| string
	| (() => { name: string; table?: { id: AnyPgColumn } })
	| Record<string, string | (() => { name: string })>;

/**
 * Junction table specification for manyToMany relations.
 * - String literal: `"post_tags"` - junction collection name
 * - Callback: `() => postTags` - lazy reference
 */
export type JunctionTarget = string | (() => { name: string });

/**
 * Relation field configuration options.
 */
export interface RelationFieldConfig extends BaseFieldConfig {
	/** Field-specific metadata, augmentable by external packages. */
	meta?: RelationFieldMeta;

	/**
	 * Target collection(s).
	 * - String: `"users"` - collection name (recommended for most cases)
	 * - Callback: `() => users` - lazy reference with FK constraint
	 * - Object: `{ users: "users", posts: "posts" }` for polymorphic
	 */
	to: RelationTarget;

	/**
	 * Makes this a "to-many" relation (hasMany or manyToMany).
	 * - false (default): belongsTo - FK stored on this table
	 * - true: hasMany/manyToMany - FK on target or junction table
	 * @default false
	 */
	hasMany?: boolean;

	/**
	 * Stores array of FKs inline (jsonb column).
	 * Use for embedded arrays without junction table.
	 * @default false
	 */
	multiple?: boolean;

	/**
	 * Foreign key column name on TARGET collection.
	 * Required for hasMany relations.
	 * @example "authorId" - FK column on posts that references this collection
	 */
	foreignKey?: string;

	/**
	 * Junction collection for manyToMany relations.
	 * When provided, relation becomes manyToMany.
	 * - String: `"post_tags"` - junction collection name
	 * - Callback: `() => postTags` - lazy reference
	 */
	through?: JunctionTarget;

	/**
	 * Source field on junction table (points to this collection).
	 * @default "{thisCollection}Id"
	 */
	sourceField?: string;

	/**
	 * Target field on junction table (points to target collection).
	 * @default "{targetCollection}Id"
	 */
	targetField?: string;

	/**
	 * For reverse polymorphic (morphMany).
	 * Name of the morphTo field on target collection.
	 */
	morphName?: string;

	/**
	 * For reverse polymorphic (morphMany).
	 * Value to match in the type column.
	 */
	morphType?: string;

	/**
	 * Action on delete of referenced record.
	 * - For belongsTo: DB-level FK constraint
	 * - For hasMany/manyToMany: Application-level cascade (hooks)
	 * @default "no action"
	 */
	onDelete?: ReferentialAction;

	/**
	 * Action on update of referenced record's ID.
	 * @default "no action"
	 */
	onUpdate?: ReferentialAction;

	/**
	 * Drizzle relation name for disambiguation.
	 * Use when multiple relations point to same collection.
	 */
	relationName?: string;

	/**
	 * Default ordering for hasMany/manyToMany results.
	 */
	orderBy?: Record<string, "asc" | "desc">;

	/**
	 * Limit number of related records.
	 */
	limit?: number;

	/**
	 * Default filter conditions for relation.
	 */
	where?: Record<string, unknown>;

	/**
	 * Dynamic options configuration for relation picker.
	 * Allows filtering related records based on form data.
	 *
	 * By default, relations use the target collection's records as options.
	 * Use this to add custom filtering, search, and pagination.
	 *
	 * @example Cascading city → country filter
	 * ```ts
	 * city: f.relation({
	 *   to: 'cities',
	 *   options: {
	 *     handler: async ({ data, search, page, limit, ctx }) => {
	 *       if (!data.country) {
	 *         return { options: [], hasMore: false };
	 *       }
	 *       const cities = await ctx.db.query.cities.findMany({
	 *         where: {
	 *           countryId: data.country,
	 *           ...(search && { name: { ilike: `%${search}%` } }),
	 *         },
	 *         limit,
	 *         offset: page * limit,
	 *       });
	 *       return {
	 *         options: cities.map(c => ({ value: c.id, label: c.name })),
	 *         hasMore: cities.length === limit,
	 *       };
	 *     },
	 *     deps: ({ data }) => [data.country],
	 *   },
	 * })
	 * ```
	 */
	options?: OptionsConfig;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve target name from RelationTarget.
 * Works with both strings and callbacks.
 */
export function resolveTargetName(
	target: RelationTarget,
): string | string[] | undefined {
	if (typeof target === "string") {
		return target;
	}
	if (typeof target === "function") {
		try {
			return target().name;
		} catch {
			return undefined; // Circular reference, will be resolved later
		}
	}
	if (typeof target === "object") {
		// Polymorphic - return array of type names
		return Object.keys(target);
	}
	return undefined;
}

/**
 * Resolve junction name from JunctionTarget.
 */
export function resolveJunctionName(
	target: JunctionTarget | undefined,
): string | undefined {
	if (!target) return undefined;
	if (typeof target === "string") {
		return target;
	}
	if (typeof target === "function") {
		try {
			return target().name;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/**
 * Check if target is polymorphic (object with multiple targets).
 */
function isPolymorphicTarget(target: RelationTarget): boolean {
	return (
		typeof target === "object" &&
		target !== null &&
		typeof target !== "function"
	);
}

// ============================================================================
// Relation Type Inference
// ============================================================================

/**
 * Infer relation type from config.
 */
export function inferRelationType(
	config: RelationFieldConfig,
): InferredRelationType {
	const isPolymorphic = isPolymorphicTarget(config.to);

	// Polymorphic relations
	if (isPolymorphic) {
		if (config.hasMany && config.morphName) {
			return "morphMany";
		}
		return "morphTo";
	}

	// Multiple (inline array)
	if (config.multiple) {
		return "multiple";
	}

	// ManyToMany (has junction table)
	if (config.hasMany && config.through) {
		return "manyToMany";
	}

	// HasMany (FK on target)
	if (config.hasMany) {
		return "hasMany";
	}

	// Default: BelongsTo
	return "belongsTo";
}

// ============================================================================
// Relation Field Operators
// ============================================================================

/**
 * Operators for belongsTo relation (FK field).
 */
function getBelongsToOperators() {
	return {
		column: {
			eq: operator<string, unknown>((col, value) => eq(col, value)),
			ne: operator<string, unknown>((col, value) => ne(col, value)),
			in: operator<string[], unknown>((col, values) => inArray(col, values)),
			notIn: operator<string[], unknown>((col, values) =>
				notInArray(col, values),
			),
			isNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NULL` : sql`${col} IS NOT NULL`,
			),
			isNotNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NOT NULL` : sql`${col} IS NULL`,
			),
		},
		jsonb: {
			eq: operator<string, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' = ${value}`;
			}),
			ne: operator<string, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' != ${value}`;
			}),
			in: operator<string[], unknown>((col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>>'{${sql.raw(path)}}' = ANY(${values}::text[])`;
			}),
			notIn: operator<string[], unknown>((col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`NOT (${col}#>>'{${sql.raw(path)}}' = ANY(${values}::text[]))`;
			}),
			isNull: operator<boolean, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return value
					? sql`${col}#>'{${sql.raw(path)}}' IS NULL`
					: sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
			}),
			isNotNull: operator<boolean, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return value
					? sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`
					: sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
			}),
		},
	};
}

/**
 * Operators for multiple (jsonb array of FKs).
 */
function getMultipleOperators() {
	return {
		column: {
			contains: operator<string, unknown>(
				(col, value) => sql`${col} @> ${JSON.stringify([value])}::jsonb`,
			),
			containsAll: operator<string[], unknown>(
				(col, values) => sql`${col} @> ${JSON.stringify(values)}::jsonb`,
			),
			containsAny: operator<string[], unknown>(
				(col, values) =>
					sql`${col} ?| ARRAY[${sql.join(
						values.map((v) => sql`${v}`),
						sql`, `,
					)}]::text[]`,
			),
			isEmpty: operator<boolean, unknown>(
				(col) => sql`(${col} = '[]'::jsonb OR ${col} IS NULL)`,
			),
			isNotEmpty: operator<boolean, unknown>(
				(col) => sql`(${col} != '[]'::jsonb AND ${col} IS NOT NULL)`,
			),
			count: operator<number, unknown>(
				(col, value) =>
					sql`jsonb_array_length(COALESCE(${col}, '[]'::jsonb)) = ${value}`,
			),
			isNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NULL` : sql`${col} IS NOT NULL`,
			),
			isNotNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NOT NULL` : sql`${col} IS NULL`,
			),
		},
		jsonb: {
			contains: operator<string, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify([value])}::jsonb`;
			}),
			containsAll: operator<string[], unknown>((col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify(values)}::jsonb`;
			}),
			containsAny: operator<string[], unknown>((col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' ?| ARRAY[${sql.join(
					values.map((v) => sql`${v}`),
					sql`, `,
				)}]::text[]`;
			}),
			isEmpty: operator<boolean, unknown>((col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' = '[]'::jsonb OR ${col}#>'{${sql.raw(path)}}' IS NULL)`;
			}),
			isNotEmpty: operator<boolean, unknown>((col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' != '[]'::jsonb AND ${col}#>'{${sql.raw(path)}}' IS NOT NULL)`;
			}),
			count: operator<number, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`jsonb_array_length(COALESCE(${col}#>'{${sql.raw(path)}}', '[]'::jsonb)) = ${value}`;
			}),
			isNull: operator<boolean, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return value
					? sql`${col}#>'{${sql.raw(path)}}' IS NULL`
					: sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
			}),
			isNotNull: operator<boolean, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return value
					? sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`
					: sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
			}),
		},
	};
}

/**
 * Operators for hasMany/manyToMany/morphMany.
 * These require subqueries built at query time.
 */
function getToManyOperators() {
	return {
		column: {
			// Placeholder operators - actual implementation in query builder
			some: operator<unknown, unknown>(() => sql`TRUE`),
			none: operator<unknown, unknown>(() => sql`TRUE`),
			every: operator<unknown, unknown>(() => sql`TRUE`),
			count: operator<number, unknown>(() => sql`0`),
		},
		jsonb: {
			some: operator<unknown, unknown>(() => sql`TRUE`),
			none: operator<unknown, unknown>(() => sql`TRUE`),
			every: operator<unknown, unknown>(() => sql`TRUE`),
			count: operator<number, unknown>(() => sql`0`),
		},
	};
}

// ============================================================================
// Relation Field Metadata
// ============================================================================

// RelationFieldMetadata is imported from ../types.js (single source of truth)
// This prevents TS4023 errors during declaration generation when the bundler
// creates internal chunks with non-deterministic names.

// ============================================================================
// Relation Field Definition
// ============================================================================

/**
 * Relation field factory.
 * Creates a relation field with the given configuration.
 *
 * @example
 * ```ts
 * // BelongsTo - creates FK column (string target - recommended)
 * author: f.relation({
 *   to: "users",
 *   required: true,
 *   onDelete: "cascade",
 * })
 *
 * // HasMany - no column, FK on target
 * posts: f.relation({
 *   to: "posts",
 *   hasMany: true,
 *   foreignKey: "authorId",
 *   onDelete: "cascade",
 * })
 *
 * // ManyToMany - no column, uses junction
 * tags: f.relation({
 *   to: "tags",
 *   hasMany: true,
 *   through: "post_tags",
 *   sourceField: "postId",
 *   targetField: "tagId",
 * })
 *
 * // Multiple - jsonb array of FKs
 * images: f.relation({
 *   to: "assets",
 *   multiple: true,
 * })
 *
 * // Polymorphic (morphTo)
 * subject: f.relation({
 *   to: { users: "users", posts: "posts" },
 *   required: true,
 * })
 * ```
 */
export const relationField = field<
	RelationFieldConfig,
	string | string[] | { type: string; id: string } | null
>()({
	type: "relation" as const,
	_value: undefined as unknown as
		| string
		| string[]
		| { type: string; id: string }
		| null,
	toColumn(name: string, config: RelationFieldConfig) {
		const relationType = inferRelationType(config);

		// HasMany, ManyToMany, MorphMany - no column on this table
		if (
			relationType === "hasMany" ||
			relationType === "manyToMany" ||
			relationType === "morphMany"
		) {
			return null as any;
		}

		// Multiple - jsonb array of FKs
		if (relationType === "multiple") {
			let column: any = jsonb(name);

			if (config.required && config.nullable !== true) {
				column = column.notNull();
			}
			if (config.default !== undefined) {
				const defaultValue =
					typeof config.default === "function"
						? config.default()
						: config.default;
				column = column.default(JSON.stringify(defaultValue));
			}

			return column;
		}

		// MorphTo - creates two columns (type + id)
		// Note: These use derived names (${name}Type, ${name}Id) because
		// they need distinct columns stored under different keys
		if (relationType === "morphTo") {
			const types = config.to as Record<
				string,
				string | (() => { name: string })
			>;
			const typeNames = Object.keys(types);

			const maxTypeLength = Math.max(...typeNames.map((t) => t.length), 50);

			let typeColumn: any = varchar(`${name}Type`, { length: maxTypeLength });
			let idColumn: any = varchar(`${name}Id`, { length: 36 });

			if (config.required && config.nullable !== true) {
				typeColumn = typeColumn.notNull();
				idColumn = idColumn.notNull();
			}

			// Return both columns as array - collection-builder handles key naming
			return [typeColumn, idColumn] as any;
		}

		// BelongsTo - single FK column
		let column: any = varchar(name, { length: 36 }); // UUID length

		// Apply NOT NULL
		if (config.required && config.nullable !== true) {
			column = column.notNull();
		}

		// Apply default
		if (config.default !== undefined) {
			const defaultValue =
				typeof config.default === "function"
					? config.default()
					: config.default;
			column = column.default(defaultValue as string);
		}
		// NOTE: unique constraint removed from field level
		// Use .indexes() on collection builder instead

		// Apply FK constraint only if we have a callback with table access
		if (typeof config.to === "function") {
			const targetGetter = config.to as () => {
				name: string;
				table?: { id: AnyPgColumn };
			};
			try {
				const target = targetGetter();
				if (target.table?.id) {
					column = column.references(() => target.table!.id, {
						onDelete: config.onDelete,
						onUpdate: config.onUpdate,
					});
				}
			} catch {
				// Callback failed (likely circular ref) - skip FK constraint
				// The relation will still work, just without DB-level constraint
			}
		}
		// For string targets, FK constraint is added at collection build time
		// when we have access to all collections

		return column;
	},

	toZodSchema(config: RelationFieldConfig) {
		const relationType = inferRelationType(config);

		// MorphTo - object with type + id
		if (relationType === "morphTo") {
			const types = config.to as Record<
				string,
				string | (() => { name: string })
			>;
			const typeNames = Object.keys(types) as [string, ...string[]];

			const schema = z.object({
				type: z.enum(typeNames),
				id: z.string().uuid(),
			});

			if (!config.required && config.nullable !== false) {
				return schema.nullish();
			}
			return schema;
		}

		// Multiple or to-many relations - array of IDs
		if (
			relationType === "multiple" ||
			relationType === "hasMany" ||
			relationType === "manyToMany" ||
			relationType === "morphMany"
		) {
			const schema = z.array(z.string().uuid());

			if (!config.required && config.nullable !== false) {
				return schema.nullish();
			}
			return schema;
		}

		// BelongsTo - single ID
		const schema = z.string().uuid();

		if (!config.required && config.nullable !== false) {
			return schema.nullish();
		}
		return schema;
	},

	getOperators<TApp>(config: RelationFieldConfig) {
		const relationType = inferRelationType(config);

		if (relationType === "multiple") {
			return getMultipleOperators();
		}

		if (
			relationType === "hasMany" ||
			relationType === "manyToMany" ||
			relationType === "morphMany"
		) {
			return getToManyOperators();
		}

		return getBelongsToOperators();
	},

	getMetadata(config: RelationFieldConfig): RelationFieldMetadata {
		const relationType = inferRelationType(config);

		// Resolve target collection name(s)
		const targetCollection = resolveTargetName(config.to) ?? "__unresolved__";
		const through = resolveJunctionName(config.through);

		return {
			type: "relation",
			label: config.label,
			description: config.description,
			required: config.required ?? false,
			localized: config.localized ?? false,
			readOnly: config.input === false,
			writeOnly: config.output === false,
			relationType,
			targetCollection,
			foreignKey: config.foreignKey,
			through,
			sourceField: config.sourceField,
			targetField: config.targetField,
			morphName: config.morphName,
			morphType: config.morphType,
			onDelete: config.onDelete,
			onUpdate: config.onUpdate,
			relationName: config.relationName,
			// Store original configs for runtime resolution
			_toConfig: config.to,
			_throughConfig: config.through,
			meta: config.meta,
		};
	},
});

// Register in default registry
