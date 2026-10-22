import type { PgTable } from "drizzle-orm/pg-core";

import type { AccessWhere } from "#questpie/server/collection/builder/types.js";
import type {
	CRUDContext,
	FindManyOptions,
} from "#questpie/server/collection/crud/types.js";
import { ApiError } from "#questpie/server/errors/base.js";

/**
 * Private entries on a generated CRUD for relation reads that the TARGET
 * collection authorizes itself, like `RELATION_AGGREGATE`. Symbols keep them
 * off the public method surface and out of JSON-carried input.
 */
export const READ_ACCESS = Symbol("questpie.internal.readAccess");
export const RELATION_WINDOW = Symbol("questpie.internal.relationWindow");
/** Parent key of a row returned by a relation window. */
export const RELATION_WINDOW_KEY = Symbol(
	"questpie.internal.relationWindowKey",
);

/** Per-parent page of a to-many relation's target rows. */
export type RelationWindow = {
	/** hasMany: the target's foreign key. manyToMany: the key `through` links. */
	field: string;
	limit?: number;
	offset?: number;
	/** manyToMany: rank through these authorized junction rows, per source. */
	through?: {
		table: PgTable;
		ids: Array<string | number>;
		sourceField: string;
		targetField: string;
	};
};

type ReadAccess = (
	context: CRUDContext,
	input: FindManyOptions,
) => Promise<boolean | AccessWhere>;

type RelationWindowRead = (
	options: FindManyOptions,
	context: CRUDContext,
	window: RelationWindow,
) => Promise<Record<string, any>[]>;

function entryOf<T>(targetCrud: object, entry: symbol): T {
	const read: T | undefined = Reflect.get(targetCrud, entry);
	if (typeof read !== "function") {
		throw new TypeError("Relation target does not support authorized reads");
	}
	return read;
}

/**
 * The target collection's own read decision (rule, default, system bypass)
 * for one concrete read.
 */
export function readAccessOf(targetCrud: object): ReadAccess {
	return entryOf<ReadAccess>(targetCrud, READ_ACCESS);
}

/** The target collection's per-parent windowed read. */
export function relationWindowOf(targetCrud: object): RelationWindowRead {
	return entryOf<RelationWindowRead>(targetCrud, RELATION_WINDOW);
}

/** A `with` page bound; query strings carry it as a digit string. */
export function relationBound(value: unknown): number | undefined {
	if (value === undefined || value === null) return undefined;
	const bound =
		typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
	if (typeof bound !== "number" || !Number.isSafeInteger(bound) || bound < 0) {
		throw ApiError.badRequest(
			"Relation limit and offset must be non-negative integers",
		);
	}
	return bound;
}
