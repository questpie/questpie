import type { PostgresParameter } from "../postgres/contract";
import {
	mutationLeafPaths as inputPaths,
	mutationPathKey as pathKey,
} from "./field-path";
import type { LinkedPostgresDeleteOperationPlanV1 } from "./postgres-program";
import type { PostgresResultV1 } from "./postgres-program-types";

type Row = Readonly<Record<string, unknown>>;

function record(value: unknown, label: string): Row {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as Row;
}

function exactPaths(
	actual: readonly (readonly string[])[],
	expected: readonly (readonly string[])[],
	label: string,
) {
	const actualKeys = actual.map(pathKey).sort();
	const expectedKeys = expected.map(pathKey).sort();
	if (
		actualKeys.length !== expectedKeys.length ||
		expectedKeys.some((key, index) => key !== actualKeys[index])
	)
		throw new TypeError(`${label} must have exactly the compiled Fields`);
}

/**
 * Mirrors createCollectionGetExecutor's shape (key-only request, lock then
 * read/write, decode-or-null). Delete has no candidate/lifecycle wiring in
 * this slice, so unlike the create/update executors in collection.ts it
 * needs no Field authority, normalizer, or candidate-validation steps: the
 * lock round trip exists only so a later authored `validate` phase can be
 * added without reshaping the plan (ADR-0047).
 */
export function createCollectionDeleteExecutor(
	input: Readonly<{
		execute(
			plan: LinkedPostgresDeleteOperationPlanV1,
			started: number,
			leaf:
				| LinkedPostgresDeleteOperationPlanV1["lock"]
				| LinkedPostgresDeleteOperationPlanV1["write"],
			parameters: readonly PostgresParameter[],
		): Promise<readonly Row[]>;
		bind(
			parameters:
				| LinkedPostgresDeleteOperationPlanV1["lock"]["parameters"]
				| LinkedPostgresDeleteOperationPlanV1["write"]["parameters"],
			key: Row,
		): readonly PostgresParameter[];
		decode(row: Row, result: readonly PostgresResultV1[]): Row;
		consumeRows(count: number): void;
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
		// instead of paying for the DELETE statement.
		const locked = await input.execute(
			plan,
			started,
			plan.lock,
			input.bind(plan.lock.parameters, key),
		);
		if (locked.length === 0) return null;
		if (locked.length !== 1)
			throw new TypeError("Collection delete lock returned multiple rows");
		// Round trip 2: DELETE ... RETURNING, gated by the same row-scope
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
