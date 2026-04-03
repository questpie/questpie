/**
 * Relation Field Factory
 *
 * Unified field for all relation types:
 * - belongsTo: FK column on this table (default)
 * - hasMany: FK on target table
 * - manyToMany: Junction table
 * - multiple: Inline array of FKs (jsonb)
 * - morphTo: Polymorphic (type + id columns)
 * - morphMany: Reverse polymorphic
 */

import { jsonb, type PgVarcharBuilder, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { Field, field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import type { FieldWithMethods } from "../../../fields/field-with-methods.js";
import { belongsToOps, multipleOps, toManyOps } from "../../../fields/operators/builtin.js";
import type {
	InferredRelationType,
	ReferentialAction,
	RelationFieldMetadata,
} from "../../../fields/types.js";

declare global {
	namespace Questpie {
		interface RelationFieldMeta {}
	}
}

export interface RelationFieldMeta extends Questpie.RelationFieldMeta {
	_?: never;
}

// ============================================================================
// Types
// ============================================================================

export type RelationFieldState<TTo extends string = string> =
	DefaultFieldState & {
		type: "relation";
		data: string;
		column: PgVarcharBuilder<[string, ...string[]]>;
		operators: typeof belongsToOps;
		relationTo: TTo;
		relationKind: "one";
	};

export interface RelationFieldMethods {
	hasMany(config: { foreignKey: string; onDelete?: ReferentialAction; relationName?: string }): any;
	manyToMany(config: { through: string; sourceField?: string; targetField?: string; relationName?: string }): any;
	multiple(): any;
	onDelete(action: ReferentialAction): any;
	onUpdate(action: ReferentialAction): any;
	relationName(name: string): any;
}

export type ToManyRelationFieldState<TTo extends string = string> =
	DefaultFieldState & {
		type: "relation";
		data: string[];
		virtual: true;
		operators: typeof toManyOps;
		relationTo: TTo;
		relationKind: "many";
	};

export type MorphToFieldState = DefaultFieldState & {
	type: "relation";
	data: { type: string; id: string };
	operators: typeof belongsToOps;
};

export type MultipleRelationFieldState<TTo extends string = string> =
	DefaultFieldState & {
		type: "relation";
		data: string[];
		operators: typeof multipleOps;
		relationTo: TTo;
		relationKind: "one";
	};

/**
 * Relation target — accepts collection name, factory function, or polymorphic map.
 *
 * Uses plain `string` (with autocomplete hint via `string & {}`) instead of
 * `KnownCollectionNames` to avoid a circular type dependency:
 *   relation() → KnownCollectionNames → RegistryNames → Registry
 *   → _Registry_Collections → _MP<"collections"> → _Module → typeof _modules
 *   → adminModule → collections → CollectionBuilder (uses relation()) → CYCLE
 */
type RelationTarget =
	| (string & {})
	| (() => { name: string; table?: { id: unknown } })
	| Record<string, (string & {}) | (() => { name: string })>;

type JunctionTarget = (string & {}) | (() => { name: string });

// ============================================================================
// Helper Functions
// ============================================================================

function resolveTargetName(
	target: RelationTarget,
): string | string[] | undefined {
	if (typeof target === "string") return target;
	if (typeof target === "function") {
		try {
			return target().name;
		} catch {
			return undefined;
		}
	}
	if (typeof target === "object") return Object.keys(target);
	return undefined;
}

function resolveJunctionName(
	target: JunctionTarget | undefined,
): string | undefined {
	if (!target) return undefined;
	if (typeof target === "string") return target;
	if (typeof target === "function") {
		try {
			return target().name;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function isPolymorphicTarget(target: RelationTarget): boolean {
	return (
		typeof target === "object" &&
		target !== null &&
		typeof target !== "function"
	);
}

function buildRelationMetadata(
	state: import("../../../fields/field-class-types.js").FieldRuntimeState,
): RelationFieldMetadata {
	const to = state.to as RelationTarget;
	const targetCollection =
		(to ? resolveTargetName(to) : undefined) ?? "__unresolved__";
	const through = resolveJunctionName(
		state.through as JunctionTarget | undefined,
	);

	// Infer relation type
	let relationType: InferredRelationType = "belongsTo";
	if (to && isPolymorphicTarget(to)) {
		relationType = state.hasMany && state.morphName ? "morphMany" : "morphTo";
	} else if (state.multiple) {
		relationType = "multiple";
	} else if (state.hasMany && state.through) {
		relationType = "manyToMany";
	} else if (state.hasMany) {
		relationType = "hasMany";
	}

	return {
		type: "relation",
		label: state.label,
		description: state.description,
		required: state.notNull ?? false,
		localized: state.localized ?? false,
		readOnly: state.input === false,
		writeOnly: state.output === false,
		relationType,
		targetCollection,
		foreignKey: state.foreignKey,
		through,
		sourceField: state.sourceField,
		targetField: state.targetField,
		morphName: state.morphName,
		onDelete: state.onDelete as ReferentialAction | undefined,
		onUpdate: state.onUpdate as ReferentialAction | undefined,
		relationName: state.relationName,
		_toConfig: state.to,
		_throughConfig: state.through,
		meta: state.extensions?.admin as RelationFieldMetadata["meta"],
	};
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a relation field (belongsTo by default).
 *
 * @param target - Target collection name, lazy ref, or polymorphic map
 *
 * @example
 * ```ts
 * // BelongsTo (default)
 * author: f.relation("users").required()
 *
 * // HasMany
 * posts: f.relation("posts").hasMany({ foreignKey: "authorId" })
 *
 * // ManyToMany
 * tags: f.relation("tags").manyToMany({ through: "post_tags" })
 *
 * // Multiple (jsonb array of FKs)
 * images: f.relation("assets").multiple()
 *
 * // Polymorphic
 * subject: f.relation({ users: "users", posts: "posts" }).required()
 * ```
 */
export function relation<TTo extends string>(
	target: TTo | Exclude<RelationTarget, string>,
): FieldWithMethods<RelationFieldState<TTo>, RelationFieldMethods> {
	const isPoly = isPolymorphicTarget(target);

	if (isPoly) {
		// MorphTo — two columns (type + id)
		const types = target as Record<string, string | (() => { name: string })>;
		const typeNames = Object.keys(types);
		const maxTypeLength = Math.max(...typeNames.map((t) => t.length), 50);

		return wrapFieldComplete(field<RelationFieldState>({
			type: "relation",
			columnFactory: (name) => {
				// Returns an array of column builders — collection builder handles multi-column
				const typeCol = varchar(`${name}Type`, { length: maxTypeLength });
				const idCol = varchar(`${name}Id`, { length: 36 });
				return [typeCol, idCol] as any;
			},
			schemaFactory: () =>
				z.object({
					type: z.enum(typeNames as [string, ...string[]]),
					id: z.string().uuid(),
				}),
			operatorSet: belongsToOps,
			notNull: false,
			hasDefault: false,
			localized: false,
			virtual: false,
			input: true,
			output: true,
			isArray: false,
			to: target,
			metadataFactory: buildRelationMetadata,
		}), relationFieldType.methods, {}) as any;
	}

	// Default: belongsTo
	return wrapFieldComplete(field<RelationFieldState<TTo>>({
		type: "relation",
		columnFactory: (name) => varchar(name, { length: 36 }),
		schemaFactory: () => z.string().uuid(),
		operatorSet: belongsToOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
		to: target,
		metadataFactory: buildRelationMetadata,
	}), relationFieldType.methods, {}) as any;
}

// ============================================================================
// Chain Methods
// ============================================================================

// ---- fieldType() definition (QUE-265) ----

export const relationFieldType = fieldType("relation", {
	create: (target: string) => ({
		type: "relation",
		columnFactory: (name: string) => varchar(name, { length: 36 }),
		schemaFactory: () => z.string().uuid(),
		operatorSet: belongsToOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
		to: target,
		metadataFactory: buildRelationMetadata,
	}),
	methods: {
		hasMany: (f: Field<any>, config: { foreignKey: string; onDelete?: ReferentialAction; relationName?: string }) =>
			new Field({
				...f._state,
				hasMany: true,
				foreignKey: config.foreignKey,
				onDelete: config.onDelete,
				relationName: config.relationName,
				columnFactory: null,
				virtual: true,
				operatorSet: toManyOps,
			}),
		manyToMany: (f: Field<any>, config: { through: string; sourceField?: string; targetField?: string; relationName?: string }) =>
			new Field({
				...f._state,
				hasMany: true,
				through: config.through,
				sourceField: config.sourceField,
				targetField: config.targetField,
				relationName: config.relationName,
				columnFactory: null,
				virtual: true,
				operatorSet: toManyOps,
			}),
		multiple: (f: Field<any>) =>
			new Field({
				...f._state,
				multiple: true,
				columnFactory: (name: string) => jsonb(name),
				schemaFactory: () => z.array(z.string().uuid()),
				operatorSet: multipleOps,
			}),
		onDelete: (f: Field<any>, action: ReferentialAction) =>
			f.derive({ onDelete: action }),
		onUpdate: (f: Field<any>, action: ReferentialAction) =>
			f.derive({ onUpdate: action }),
		relationName: (f: Field<any>, name: string) =>
			f.derive({ relationName: name }),
	},
});
