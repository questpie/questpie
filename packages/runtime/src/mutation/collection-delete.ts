import type { PostgresParameter } from "../postgres/contract";
import { exactPaths, record, type Row } from "./collection-shared";
import { mutationLeafPaths as inputPaths } from "./field-path";
import type { LinkedPostgresDeleteOperationPlanV1 } from "./postgres-program";
import type { PostgresResultV1 } from "./postgres-program-types";

/**
 * Mirrors createCollectionGetExecutor's shape (key-only request, lock then
 * act, decode-or-null), extended with one conditional step: when the
 * Collection has a lifecycle program, a second read fetches the full locked
 * current row and `validateCurrent` interprets `validate` against it before
 * the write runs (ADR-0047 F1/F2 — delete is no longer exempt from a
 * Collection's own destructive-guard checks). No `check`/`afterWrite`
 * wiring in this slice, and no candidate: `validateCurrent` throwing dooms
 * the transaction the same way update's lifecycle check does.
 */
export function createCollectionDeleteExecutor(
	input: Readonly<{
		execute(
			plan: LinkedPostgresDeleteOperationPlanV1,
			started: number,
			leaf:
				| LinkedPostgresDeleteOperationPlanV1["lock"]
				| NonNullable<LinkedPostgresDeleteOperationPlanV1["currentValidation"]>
				| LinkedPostgresDeleteOperationPlanV1["write"],
			parameters: readonly PostgresParameter[],
		): Promise<readonly Row[]>;
		bind(
			parameters:
				| LinkedPostgresDeleteOperationPlanV1["lock"]["parameters"]
				| NonNullable<
						LinkedPostgresDeleteOperationPlanV1["currentValidation"]
				  >["parameters"]
				| LinkedPostgresDeleteOperationPlanV1["write"]["parameters"],
			key: Row,
		): readonly PostgresParameter[];
		decode(row: Row, result: readonly PostgresResultV1[]): Row;
		consumeRows(count: number): void;
		validateCurrent(
			plan: LinkedPostgresDeleteOperationPlanV1,
			current: Row,
		): Promise<void>;
	}>,
) {
	return async (
		plan: LinkedPostgresDeleteOperationPlanV1,
		rawRequest: unknown,
		started: number,
	): Promise<Row | null> => {
		const request = record(rawRequest, "Collection delete request");
		if (Object.keys(request).length !== 1 || !Object.hasOwn(request, "key"))
			throw new TypeError(
				"Collection delete request must have exactly the compiled keys",
			);
		const key = record(request.key, "Collection key");
		exactPaths(
			inputPaths(key, "Collection key", plan.operation.keyFields),
			plan.operation.keyFields,
			"Collection key",
		);
		// Round trip 1: lock. A row that does not exist short-circuits here
		// instead of paying for a validate read or the DELETE statement.
		const locked = await input.execute(
			plan,
			started,
			plan.lock,
			input.bind(plan.lock.parameters, key),
		);
		if (locked.length === 0) return null;
		if (locked.length !== 1)
			throw new TypeError("Collection delete lock returned multiple rows");
		if (plan.currentValidation) {
			// Round trip 2 (lifecycle only): the same row-scope Policy check
			// re-read fresh, gating existence/authorization for the validate
			// read exactly like it gates the write below. Zero rows here means
			// not-found/denied, so `validate` never runs for a row the caller
			// was never going to see anyway.
			const currentRows = await input.execute(
				plan,
				started,
				plan.currentValidation,
				input.bind(plan.currentValidation.parameters, key),
			);
			if (currentRows.length === 0) return null;
			if (currentRows.length !== 1)
				throw new TypeError(
					"Collection delete current-row read returned multiple rows",
				);
			const current = input.decode(
				currentRows[0]!,
				plan.currentValidation.result,
			);
			// May throw a mapped Collection issue (or doom the transaction on an
			// unmapped/interpreter failure); either way nothing is deleted.
			await input.validateCurrent(plan, current);
		}
		// Final round trip: DELETE ... RETURNING, gated by the same row-scope
		// Policy check re-evaluated fresh in this statement. Zero rows means
		// not-found and Policy-denied stayed indistinguishable, exactly like
		// update's "authorized-or-absent".
		const rows = await input.execute(
			plan,
			started,
			plan.write,
			input.bind(plan.write.parameters, key),
		);
		input.consumeRows(rows.length);
		if (rows.length === 0) return null;
		if (rows.length > plan.limits.rows || rows.length !== 1)
			throw new TypeError("Collection delete exceeded its row limit");
		return input.decode(rows[0]!, plan.write.result);
	};
}
