import type {
	CRUDContext,
	FindManyOptions,
	RelationAggregation,
} from "#questpie/server/collection/crud/types.js";

/**
 * Private entry on a generated CRUD: a hasMany relation aggregate that the
 * TARGET collection executes through its own read pipeline, so the aggregate
 * is authorized by the same owner as an ordinary read of those rows. A symbol
 * keeps it off the public method surface and out of JSON-carried input.
 */
export const RELATION_AGGREGATE = Symbol("questpie.internal.relationAggregate");

export type RelationAggregate = {
	field: string;
	parentIds: Array<string | number>;
	count?: boolean;
	values?: RelationAggregation;
};

export type AggregateCRUD = {
	[RELATION_AGGREGATE]: (
		options: FindManyOptions,
		context: CRUDContext,
		aggregate: RelationAggregate,
	) => Promise<Record<string, any>[]>;
};

/**
 * afterRead hooks that only add derived output and never alter a stored field.
 * A value aggregate reads stored fields in SQL, so it stays correct under
 * these hooks; any other afterRead may rewrite the value and is refused.
 */
export const OUTPUT_ONLY_AFTER_READ = new WeakSet<object>();
