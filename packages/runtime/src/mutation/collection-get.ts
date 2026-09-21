import type { PostgresParameter } from "../postgres/contract";
import { exactPaths, record, type Row } from "./collection-shared";
import { mutationLeafPaths as inputPaths } from "./field-path";
import type { LinkedPostgresGetOperationPlanV1 } from "./postgres-program";
import type { PostgresResultV1 } from "./postgres-program-types";

export function createCollectionGetExecutor(
	input: Readonly<{
		execute(
			plan: LinkedPostgresGetOperationPlanV1,
			started: number,
			leaf:
				| LinkedPostgresGetOperationPlanV1["lock"]
				| LinkedPostgresGetOperationPlanV1["read"],
			parameters: readonly PostgresParameter[],
		): Promise<readonly Row[]>;
		bind(
			parameters:
				| LinkedPostgresGetOperationPlanV1["lock"]["parameters"]
				| LinkedPostgresGetOperationPlanV1["read"]["parameters"],
			key: Row,
		): readonly PostgresParameter[];
		decode(row: Row, result: readonly PostgresResultV1[]): Row;
		consumeRows(count: number): void;
	}>,
) {
	return async (
		plan: LinkedPostgresGetOperationPlanV1,
		rawRequest: unknown,
		started: number,
	): Promise<Row | null> => {
		const request = record(rawRequest, "Collection get request");
		if (Object.keys(request).length !== 1 || !Object.hasOwn(request, "key"))
			throw new TypeError(
				"Collection get request must have exactly the compiled keys",
			);
		const key = record(request.key, "Collection key");
		exactPaths(
			inputPaths(key, "Collection key", plan.operation.keyFields),
			plan.operation.keyFields,
			"Collection key",
		);
		const locked = await input.execute(
			plan,
			started,
			plan.lock,
			input.bind(plan.lock.parameters, key),
		);
		if (locked.length > 1)
			throw new TypeError("Collection lock returned multiple rows");
		const rows = await input.execute(
			plan,
			started,
			plan.read,
			input.bind(plan.read.parameters, key),
		);
		input.consumeRows(rows.length);
		if (rows.length > plan.limits.rows)
			throw new TypeError("Collection get exceeded its row limit");
		return rows[0] ? input.decode(rows[0], plan.read.result) : null;
	};
}
