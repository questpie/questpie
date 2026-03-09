/**
 * Relation Field Factory (V2)
 *
 * Unified field for all relation types:
 * - belongsTo: FK column on this table (default)
 * - hasMany: FK on target table
 * - manyToMany: Junction table
 * - multiple: Inline array of FKs (jsonb)
 * - morphTo: Polymorphic (type + id columns)
 * - morphMany: Reverse polymorphic
 */

import { jsonb, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { KnownCollectionNames } from "../../config/app-context.js";
import {
	belongsToOps,
	multipleOps,
	toManyOps,
} from "../operators/builtin.js";
import { createField, Field } from "../field-class.js";
import type { DefaultFieldState } from "../field-class-types.js";
import type {
	InferredRelationType,
	ReferentialAction,
	RelationFieldMetadata,
} from "../types.js";

// ============================================================================
// Types
// ============================================================================

export type RelationFieldState = DefaultFieldState & {
	type: "relation";
	data: string;
};

export type ToManyRelationFieldState = DefaultFieldState & {
	type: "relation";
	data: string[];
	virtual: true;
};

export type MorphToFieldState = DefaultFieldState & {
	type: "relation";
	data: { type: string; id: string };
};

export type MultipleRelationFieldState = DefaultFieldState & {
	type: "relation";
	data: string[];
};

type RelationTarget =
	| KnownCollectionNames
	| (() => { name: string; table?: { id: unknown } })
	| Record<string, KnownCollectionNames | (() => { name: string })>;

type JunctionTarget = KnownCollectionNames | (() => { name: string });

// ============================================================================
// Helper Functions
// ============================================================================

function resolveTargetName(target: RelationTarget): string | string[] | undefined {
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

function resolveJunctionName(target: JunctionTarget | undefined): string | undefined {
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
	return typeof target === "object" && target !== null && typeof target !== "function";
}

function buildRelationMetadata(state: import("../field-class-types.js").FieldRuntimeState): RelationFieldMetadata {
	const to = state.to as RelationTarget;
	const targetCollection = (to ? resolveTargetName(to) : undefined) ?? "__unresolved__";
	const through = resolveJunctionName(state.through as JunctionTarget | undefined);

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
		meta: state.admin as RelationFieldMetadata["meta"],
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
export function relation(target: RelationTarget): Field<RelationFieldState> {
	const isPoly = isPolymorphicTarget(target);

	if (isPoly) {
		// MorphTo — two columns (type + id)
		const types = target as Record<string, string | (() => { name: string })>;
		const typeNames = Object.keys(types);
		const maxTypeLength = Math.max(...typeNames.map((t) => t.length), 50);

		return createField<RelationFieldState>({
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
		}) as any;
	}

	// Default: belongsTo
	return createField<RelationFieldState>({
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
	});
}

// ============================================================================
// Chain Methods
// ============================================================================

declare module "../field-class.js" {
	interface Field<TState> {
		/** Convert to hasMany relation (FK on target table). */
		hasMany(config: {
			foreignKey: string;
			onDelete?: ReferentialAction;
			relationName?: string;
		}): Field<TState & { virtual: true }>;

		/** Convert to manyToMany relation (junction table). */
		manyToMany(config: {
			through: JunctionTarget;
			sourceField?: string;
			targetField?: string;
			relationName?: string;
		}): Field<TState & { virtual: true }>;

		/** Convert to multiple relation (jsonb array of FKs). */
		multiple(): Field<TState>;

		/** Set onDelete action. */
		onDelete(action: ReferentialAction): Field<TState>;

		/** Set onUpdate action. */
		onUpdate(action: ReferentialAction): Field<TState>;

		/** Set relation name (for disambiguation). */
		relationName(name: string): Field<TState>;
	}
}

Field.prototype.hasMany = function (config) {
	return new Field({
		...this._state,
		hasMany: true,
		foreignKey: config.foreignKey,
		onDelete: config.onDelete,
		relationName: config.relationName,
		// No column for hasMany
		columnFactory: null,
		virtual: true,
		operatorSet: toManyOps,
	}) as any;
};

Field.prototype.manyToMany = function (config) {
	return new Field({
		...this._state,
		hasMany: true,
		through: config.through,
		sourceField: config.sourceField,
		targetField: config.targetField,
		relationName: config.relationName,
		// No column for manyToMany
		columnFactory: null,
		virtual: true,
		operatorSet: toManyOps,
	}) as any;
};

Field.prototype.multiple = function () {
	return new Field({
		...this._state,
		multiple: true,
		columnFactory: (name: string) => jsonb(name),
		schemaFactory: () => z.array(z.string().uuid()),
		operatorSet: multipleOps,
	});
};

Field.prototype.onDelete = function (action) {
	return new Field({ ...this._state, onDelete: action });
};

Field.prototype.onUpdate = function (action) {
	return new Field({ ...this._state, onUpdate: action });
};

Field.prototype.relationName = function (name) {
	return new Field({ ...this._state, relationName: name });
};
