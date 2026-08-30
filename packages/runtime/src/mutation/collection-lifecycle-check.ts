import type { CollectionExecutionBudget } from "./collection-budget";
import { assertAllowedCollectionPaths } from "./collection-input";
import {
	hasMutationValueAt as hasValueAt,
	mutationLeafPaths as inputPaths,
	mutationPathKey as pathKey,
	mutationValueAt as valueAt,
	setMutationValueAt as setAt,
} from "./field-path";
import {
	captureCollectionLifecycleFailure,
	executeCollectionLifecyclePhase,
	type CollectionLifecycleDoom,
} from "./lifecycle";
import type { LinkedCollectionLifecycleProgramV1 } from "./lifecycle";
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
		budget: CollectionExecutionBudget;
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
		executeList?(
			identity: string,
			request: unknown,
			started: number,
		): Promise<readonly Row[]>;
		executeWrite(identity: string, request: unknown): Promise<unknown>;
		executeJob?(identity: string, request: unknown): Promise<unknown>;
	}>,
) {
	const readCapabilities = (
		program: LinkedCollectionLifecycleProgramV1,
		started: number,
	) =>
		Object.freeze(
			Object.fromEntries(
				Object.values(program.bindings.capabilities)
					.filter((binding) => binding.kind === "read")
					.map((binding) => [
						binding.identity,
						async (rawArgument: unknown) => {
							if (binding.cardinality === "many") {
								if (!input.executeList)
									throw new TypeError("Lifecycle list capability is withheld");
								return input.executeList(
									binding.identity,
									rawArgument,
									started,
								);
							}
							const plan = input.plans.byIdentity.get(binding.identity);
							if (!plan || plan.member !== "get")
								throw new TypeError("Lifecycle get capability is unbound");
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
							const boundSelection = binding.argumentKeys
								.filter((key) => key.startsWith("select."))
								.map((key) => key.slice("select.".length).split("."));
							exactPaths(
								selectedPaths,
								boundSelection,
								"Lifecycle get selection",
							);
							assertAllowedCollectionPaths(
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
							const row = await input.executeGet(
								plan,
								{ key: argument.key },
								started,
							);
							if (row === null) return null;
							const selected: Record<string, unknown> = {};
							for (const path of selectedPaths) {
								if (!hasValueAt(row, path)) continue;
								setAt(selected, path, valueAt(row, path, "Lifecycle get row"));
							}
							return Object.freeze(selected);
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
			await captureCollectionLifecycleFailure(input.doom, () =>
				executeCollectionLifecyclePhase(
					lifecycle,
					"validate",
					{
						candidate,
						current,
						now: input.operationTime,
					},
					{},
					input.budget,
				),
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
			await captureCollectionLifecycleFailure(input.doom, () =>
				executeCollectionLifecyclePhase(
					lifecycle,
					"check",
					{ candidate, current, now: input.operationTime },
					readCapabilities(lifecycle, started),
					input.budget,
				),
			);
			return true;
		},
		async executeAfterWrite(
			plan: WritePlan,
			written: Row,
			previous: Row | null,
			callId: string,
			started: number,
		): Promise<void> {
			const lifecycle = plan.operation.lifecycleProgram;
			if (!lifecycle || lifecycle.phases.afterWrite.length === 0) return;
			if (callId.length === 0)
				throw new TypeError("Lifecycle call ID is unavailable");
			const writes = Object.fromEntries(
				Object.values(lifecycle.bindings.capabilities)
					.filter((binding) => binding.kind === "write")
					.map((binding) => [
						binding.identity,
						(request: unknown) => input.executeWrite(binding.identity, request),
					]),
			);
			const jobs = Object.fromEntries(
				Object.values(lifecycle.bindings.capabilities)
					.filter((binding) => binding.kind === "acceptJob")
					.map((binding) => [
						binding.identity,
						(request: unknown) => {
							if (!input.executeJob)
								throw new TypeError("Lifecycle Job capability is withheld");
							return input.executeJob(binding.identity, request);
						},
					]),
			);
			await captureCollectionLifecycleFailure(input.doom, () =>
				executeCollectionLifecyclePhase(
					lifecycle,
					"afterWrite",
					{
						written,
						previous,
						now: input.operationTime,
						callId,
					},
					{ ...readCapabilities(lifecycle, started), ...writes, ...jobs },
					input.budget,
				),
			);
		},
	});
}
