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

import {
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	notInArray,
	sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { jsonb, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import { defineField } from "../define-field.js";
import { getDefaultRegistry } from "../registry.js";
import type {
	BaseFieldConfig,
	ContextualOperators,
	FieldMetadataBase,
} from "../types.js";

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
export interface RelationFieldMeta {}

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
function getBelongsToOperators(): ContextualOperators {
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
 * Operators for multiple (jsonb array of FKs).
 */
function getMultipleOperators(): ContextualOperators {
	return {
		column: {
			contains: (col, value) =>
				sql`${col} @> ${JSON.stringify([value])}::jsonb`,
			containsAll: (col, values) =>
				sql`${col} @> ${JSON.stringify(values)}::jsonb`,
			containsAny: (col, values) =>
				sql`${col} ?| ${sql.raw(`ARRAY[${(values as string[]).map((v) => `'${v}'`).join(",")}]`)}`,
			isEmpty: (col) => sql`(${col} = '[]'::jsonb OR ${col} IS NULL)`,
			isNotEmpty: (col) => sql`(${col} != '[]'::jsonb AND ${col} IS NOT NULL)`,
			count: (col, value) =>
				sql`jsonb_array_length(COALESCE(${col}, '[]'::jsonb)) = ${value}`,
			isNull: (col) => isNull(col),
			isNotNull: (col) => isNotNull(col),
		},
		jsonb: {
			contains: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify([value])}::jsonb`;
			},
			containsAll: (col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify(values)}::jsonb`;
			},
			containsAny: (col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' ?| ${sql.raw(`ARRAY[${(values as string[]).map((v) => `'${v}'`).join(",")}]`)}`;
			},
			isEmpty: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' = '[]'::jsonb OR ${col}#>'{${sql.raw(path)}}' IS NULL)`;
			},
			isNotEmpty: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' != '[]'::jsonb AND ${col}#>'{${sql.raw(path)}}' IS NOT NULL)`;
			},
			count: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`jsonb_array_length(COALESCE(${col}#>'{${sql.raw(path)}}', '[]'::jsonb)) = ${value}`;
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
 * Operators for hasMany/manyToMany/morphMany.
 * These require subqueries built at query time.
 */
function getToManyOperators(): ContextualOperators {
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
// Relation Field Metadata
// ============================================================================

/**
 * Extended metadata for relation fields.
 */
export interface RelationFieldMetadata extends FieldMetadataBase {
	type: "relation";
	relationType: InferredRelationType;
	/** Target collection name(s) - resolved from config.to */
	targetCollection: string | string[];
	/** FK column name on target (for hasMany) */
	foreignKey?: string;
	/** Junction collection name (for manyToMany) */
	through?: string;
	sourceField?: string;
	targetField?: string;
	morphName?: string;
	morphType?: string;
	onDelete?: ReferentialAction;
	onUpdate?: ReferentialAction;
	relationName?: string;
	/** Original config.to for runtime resolution */
	_toConfig?: RelationTarget;
	/** Original config.through for runtime resolution */
	_throughConfig?: JunctionTarget;
}

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
export const relationField = defineField<
	"relation",
	RelationFieldConfig,
	string | string[] | { type: string; id: string } | null
>("relation", {
	toColumn(name, config) {
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
			// Don't specify column name - Drizzle uses the key name
			let column: any = jsonb();

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

			// MorphTo columns don't specify name - they get stored under derived keys
			// (${name}Type, ${name}Id) by collection-builder
			let typeColumn: any = varchar({ length: maxTypeLength });
			let idColumn: any = varchar({ length: 36 });

			if (config.required && config.nullable !== true) {
				typeColumn = typeColumn.notNull();
				idColumn = idColumn.notNull();
			}

			// Return both columns as array - collection-builder handles key naming
			return [typeColumn, idColumn] as any;
		}

		// BelongsTo - single FK column
		// Don't specify column name - Drizzle uses the key name
		// User's casing config handles: author → author or author → author_id
		let column: any = varchar({ length: 36 }); // UUID length

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

	toZodSchema(config) {
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

	getOperators(config) {
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

	getMetadata(config): RelationFieldMetadata {
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
getDefaultRegistry().register("relation", relationField as any);
