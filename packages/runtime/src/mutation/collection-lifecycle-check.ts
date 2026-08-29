import {
	mutationLeafPaths as inputPaths,
	mutationPathKey as pathKey,
	mutationValueAt as valueAt,
} from "./field-path";
import {
	captureCollectionLifecycleIssue,
	executeCollectionLifecyclePhase,
	type CollectionLifecycleDoom,
} from "./lifecycle";
import type {
	LinkedPostgresCollectionOperationPlansV1,
	LinkedPostgresCreateOperationPlanV1,
	LinkedPostgresGetOperationPlanV1,
	LinkedPostgresUpdateOperationPlanV1,
} from "./postgres-program";

type Row = Readonly<Record<string, unknown>>;
type WritePlan =
	| LinkedPostgresCreateOperationPlanV1
	| LinkedPostgresUpdateOperationPlanV1;
type PolicyCheck = NonNullable<WritePlan["candidatePolicyCheck"]>;

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

export function createCollectionLifecycleCheckExecutor(
	input: Readonly<{
		plans: LinkedPostgresCollectionOperationPlansV1;
		operationTime: Date;
		doom?: CollectionLifecycleDoom;
		executePolicy(
			plan: WritePlan,
			check: PolicyCheck,
			values: Readonly<{ key?: Row; candidate: Row }>,
			started: number,
		): Promise<readonly Row[]>;
		executeGet(
			plan: LinkedPostgresGetOperationPlanV1,
			request: unknown,
			started: number,
		): Promise<Row | null>;
	}>,
) {
	const capabilities = (started: number) =>
		Object.freeze(
			Object.fromEntries(
				input.plans.plans
					.filter(
						(plan): plan is LinkedPostgresGetOperationPlanV1 =>
							plan.member === "get",
					)
					.map((plan) => [
						plan.identity,
						async (rawArgument: unknown) => {
							const argument = record(rawArgument, "Lifecycle get argument");
							if (
								Object.keys(argument).length !== 2 ||
								!Object.hasOwn(argument, "key") ||
								!Object.hasOwn(argument, "select")
							)
								throw new TypeError(
									"Lifecycle get argument must have exactly key and select",
								);
							const select = record(argument.select, "Lifecycle get selection");
							const selectedPaths = inputPaths(
								select,
								"Lifecycle get selection",
								plan.operation.selectedFieldPaths,
							);
							exactPaths(
								selectedPaths,
								plan.operation.selectedFieldPaths,
								"Lifecycle get selection",
							);
							if (
								selectedPaths.some(
									(path) =>
										valueAt(select, path, "Lifecycle get selection") !== true,
								)
							)
								throw new TypeError(
									"Lifecycle get selection must contain true leaves",
								);
							return input.executeGet(plan, { key: argument.key }, started);
						},
					]),
			),
		);

	return Object.freeze({
		async execute(
			plan: WritePlan,
			candidate: Row,
			current: Row | null,
			key: Row | undefined,
			started: number,
		): Promise<boolean> {
			const lifecycle = plan.operation.lifecycleProgram;
			if (!lifecycle) return true;
			await captureCollectionLifecycleIssue(input.doom, () =>
				executeCollectionLifecyclePhase(lifecycle, "validate", {
					candidate,
					current,
					now: input.operationTime,
				}),
			);
			const policyCheck = plan.candidatePolicyCheck;
			if (!policyCheck)
				throw new TypeError("Lifecycle candidate Policy is incomplete");
			const policyRows = await input.executePolicy(
				plan,
				policyCheck,
				{ ...(key ? { key } : {}), candidate },
				started,
			);
			if (policyRows.length === 0) return false;
			if (policyRows.length !== 1)
				throw new TypeError(
					"Collection candidate Policy returned multiple rows",
				);
			await captureCollectionLifecycleIssue(input.doom, () =>
				executeCollectionLifecyclePhase(
					lifecycle,
					"check",
					{ candidate, current, now: input.operationTime },
					capabilities(started),
				),
			);
			return true;
		},
	});
}
