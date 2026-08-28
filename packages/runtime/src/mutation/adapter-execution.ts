import type {
	CollectionOperationAdapterFacts,
	LinkedCollectionOperationAdaptersV1,
	LinkedCollectionOperationAdapterV1,
} from "./adapter";
import {
	hasMutationValueAt,
	mutationLeafPaths,
	mutationPathKey,
	mutationValueAt,
	setMutationValueAt,
	type MutationRow,
} from "./field-path";
import type { FieldNormalizerProgramV1, ServerValueProgramV1 } from "./program";

type AdapterInvoker = (
	kernelIdentity: string,
	request: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

function fail(message: string): never {
	throw new TypeError(`Invalid Collection Operation adapter: ${message}`);
}

function record(value: unknown, label: string): MutationRow {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail(`${label} must be an object`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== null && prototype !== Object.prototype)
		fail(`${label} must be a plain object`);
	return value as MutationRow;
}

function exact(
	value: MutationRow,
	keys: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value).toSorted();
	const expected = [...keys].toSorted();
	if (
		actual.length !== expected.length ||
		expected.some((key, index) => key !== actual[index])
	)
		fail(`${label} has invalid keys`);
}

function exactWithOptional(
	value: MutationRow,
	required: readonly string[],
	optional: readonly string[],
	label: string,
): void {
	const keys = Object.keys(value);
	if (
		required.some((key) => !Object.hasOwn(value, key)) ||
		keys.some((key) => !required.includes(key) && !optional.includes(key))
	)
		fail(`${label} has invalid keys`);
}

function validatePinnedInput(
	value: unknown,
	adapter: LinkedCollectionOperationAdapterV1,
) {
	const input = record(value, "adapter input");
	const supplied = mutationLeafPaths(
		input,
		"adapter input",
		adapter.callerInputFields,
	);
	const allowed = new Set(adapter.callerInputFields.map(mutationPathKey));
	if (supplied.some((path) => !allowed.has(mutationPathKey(path))))
		fail("adapter input contains undeclared Fields");
	const present = new Set(supplied.map(mutationPathKey));
	if (
		adapter.requiredCallerInputFields.some(
			(path) => !present.has(mutationPathKey(path)),
		)
	)
		fail("adapter input is missing required Fields");
	return input;
}

function normalizedInput(
	input: MutationRow,
	program: FieldNormalizerProgramV1 | null,
): MutationRow {
	const output = structuredClone(input) as Record<string, unknown>;
	for (const step of program?.steps ?? []) {
		if (
			step.expression.kind === "trimIfPresent" &&
			!hasMutationValueAt(input, step.expression.source)
		)
			continue;
		const value = mutationValueAt(
			input,
			step.expression.source,
			"adapter value",
		);
		if (typeof value !== "string") fail("normalizer source must be a string");
		setMutationValueAt(output, step.target, value.trim());
	}
	return Object.freeze(output);
}

function trustedValues(
	input: MutationRow,
	program: ServerValueProgramV1 | null,
	facts: CollectionOperationAdapterFacts,
): MutationRow | undefined {
	if (!program) return undefined;
	const values: Record<string, unknown> = {};
	for (const assignment of program.assignments) {
		const source = mutationPathKey(assignment.source);
		const value =
			source === '["operationTime"]'
				? facts.operationTime
				: source === '["principal","id"]'
					? facts.principal.id
					: source === '["principal","kind"]'
						? facts.principal.kind
						: source === '["tenant","id"]'
							? facts.tenant.id
							: mutationValueAt(input, assignment.source, "adapter value");
		setMutationValueAt(values, assignment.target, value);
	}
	return Object.freeze(values);
}

function projectedResult(
	value: unknown,
	adapter: LinkedCollectionOperationAdapterV1,
): unknown {
	if (value === null && adapter.outputCardinality === "optionalOne")
		return null;
	const source = record(value, "adapter kernel result");
	const result: Record<string, unknown> = {};
	for (const path of adapter.selectedFieldPaths) {
		if (!hasMutationValueAt(source, path))
			fail("kernel result is missing a selected Field");
		setMutationValueAt(
			result,
			path,
			mutationValueAt(source, path, "adapter kernel result"),
		);
	}
	return Object.freeze(result);
}

export function createCollectionOperationAdapterExecutor(
	input: Readonly<{
		adapters: LinkedCollectionOperationAdaptersV1;
		facts: CollectionOperationAdapterFacts;
		invokeKernel: AdapterInvoker;
	}>,
) {
	return async (identity: string, rawRequest: unknown): Promise<unknown> => {
		const adapter = input.adapters.byIdentity.get(identity);
		if (!adapter) fail(`unknown adapter ${identity}`);
		return executeCollectionOperationAdapter(
			{
				adapter,
				facts: input.facts,
				invokeKernel: input.invokeKernel,
			},
			rawRequest,
		);
	};
}

export async function executeCollectionOperationAdapter(
	input: Readonly<{
		adapter: LinkedCollectionOperationAdapterV1;
		facts: CollectionOperationAdapterFacts;
		invokeKernel: AdapterInvoker;
	}>,
	rawRequest: unknown,
): Promise<unknown> {
	const { adapter } = input;
	const request = record(rawRequest, `${adapter.identity} request`);
	if (adapter.member === "create")
		exact(request, ["input"], `${adapter.identity} request`);
	else
		exactWithOptional(
			request,
			["key"],
			["expected", "patch"],
			`${adapter.identity} request`,
		);
	const caller = validatePinnedInput(
		adapter.member === "create"
			? request.input
			: Object.hasOwn(request, "patch")
				? request.patch
				: {},
		adapter,
	);
	const normalized = normalizedInput(caller, adapter.normalizerProgram);
	const values = trustedValues(
		normalized,
		adapter.serverValueProgram,
		input.facts,
	);
	const kernelRequest =
		adapter.member === "create"
			? { input: normalized, ...(values ? { values } : {}) }
			: {
					key: request.key,
					...(Object.hasOwn(request, "expected")
						? { expected: request.expected }
						: {}),
					patch: normalized,
					...(values ? { values } : {}),
				};
	return projectedResult(
		await input.invokeKernel(adapter.kernelIdentity, kernelRequest),
		adapter,
	);
}
