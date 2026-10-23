import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import type { FieldAccessContext } from "./types.js";

const BATCH_READ = Symbol("questpie.batchRead");

export type BatchReadContext<TRow = Record<string, unknown>> = Omit<
	FieldAccessContext,
	"doc" | "operation"
> & {
	/** Effective CRUD database, bound to the current transaction when present. */
	db: AnyDrizzleClient;
	docs: readonly TRow[];
	operation: "read";
};

export type BatchReadCallback<TRow = Record<string, unknown>> = (
	context: BatchReadContext<TRow>,
) => readonly boolean[] | Promise<readonly boolean[]>;

export type BatchReadRule<TRow = Record<string, unknown>> = (() => boolean) & {
	readonly [BATCH_READ]: BatchReadCallback<TRow>;
};

/**
 * Evaluate a field's read policy once for the authorized page. Return one
 * boolean per document, in the same order. Facts must be loaded afresh on each
 * invocation; batching the callback does not batch I/O performed inside it.
 */
export function batchRead<TRow = Record<string, unknown>>(
	callback: BatchReadCallback<TRow>,
): BatchReadRule<TRow> {
	// Unknown callers (including schema introspection) cannot authorize a row
	// without the batch evaluation. Never invoke the batch callback per row.
	return Object.assign(() => false, { [BATCH_READ]: callback });
}

export function getBatchReadCallback(
	rule: unknown,
): BatchReadCallback | undefined {
	return typeof rule === "function"
		? (rule as BatchReadRule)[BATCH_READ]
		: undefined;
}
