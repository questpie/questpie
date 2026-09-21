import type { PostgresParameter } from "../postgres/contract";
import {
	decodeMutationFieldInput,
	decodeMutationFieldResult,
	type MutationFieldCodecV1,
} from "./field-codec";
import {
	hasMutationValueAt as hasValueAt,
	mutationPathKey as pathKey,
	setMutationValueAt as setPath,
	mutationValueAt as valueAt,
	type MutationFieldPath,
} from "./field-path";
import type { LinkedPostgresGetOperationPlanV1 } from "./postgres-program";

export type Row = Readonly<Record<string, unknown>>;
export type Path = MutationFieldPath;
export type Parameter =
	LinkedPostgresGetOperationPlanV1["lock"]["parameters"][number];
export type ExecutionFactParameter = Extract<
	Parameter,
	{ kind: "executionFact" }
>;
export type Result = LinkedPostgresGetOperationPlanV1["read"]["result"][number];
export type ExecutionFacts = Readonly<{
	principal: Readonly<{ id: string; kind: string }>;
	authority: Readonly<{ kind: string }>;
	tenant: Readonly<{ id: string }>;
	signal?: AbortSignal;
}>;

/**
 * The pure request/parameter/row helpers create, update, get, and delete
 * all share verbatim. Extracted so each executor imports one copy instead
 * of collection.ts carrying every collection member's plumbing inline
 * (that inline shape is what pushed collection.ts over
 * architecture:check's 800-line cap).
 */
export function unavailable(): never {
	throw new TypeError("Collection operation is unavailable");
}

export function record(value: unknown, label: string): Row {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as Row;
}

export function exactRequestWithOptionalKeys(
	value: unknown,
	required: readonly string[],
	optional: readonly string[],
	label: string,
): Row {
	const request = record(value, label);
	const keys = Object.keys(request);
	if (
		required.some((key) => !Object.hasOwn(request, key)) ||
		keys.some((key) => !required.includes(key) && !optional.includes(key))
	)
		throw new TypeError(`${label} must have exactly the compiled keys`);
	return request;
}

export function exactPaths(
	actual: readonly Path[],
	expected: readonly Path[],
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

function inputField(
	value: unknown,
	codec: MutationFieldCodecV1,
	nullable: boolean,
): PostgresParameter {
	return decodeMutationFieldInput(value, codec, nullable);
}

export function decodeRow(
	row: Row,
	result: readonly Result[],
	resultValuesDecoded: boolean,
) {
	const output: Record<string, unknown> = {};
	for (const field of result) {
		if (field.guardColumn !== undefined) {
			const guard = row[field.guardColumn];
			if (guard === false) continue;
			if (guard !== true)
				throw new TypeError("PostgreSQL returned an invalid Field guard");
		}
		const value = row[field.column];
		setPath(
			output,
			field.path,
			value === null && field.nullable
				? null
				: resultValuesDecoded
					? value
					: decodeMutationFieldResult(value, field.codec),
		);
	}
	return Object.freeze(output);
}

function executionFact(
	parameter: ExecutionFactParameter,
	facts: ExecutionFacts,
	operationTime: Date,
): PostgresParameter {
	const key = `${parameter.source}.${parameter.path.join(".")}`;
	if (key === "authority.kind") return facts.authority.kind;
	if (key === "principal.id") return facts.principal.id;
	if (key === "principal.kind") return facts.principal.kind;
	if (key === "tenant.id") return facts.tenant.id;
	if (key === "operationTime.") return new Date(operationTime.getTime());
	throw new TypeError(
		"Compiled Collection plan references an invalid execution fact",
	);
}

export function bind(
	parameters: readonly Parameter[],
	values: Readonly<{
		callerInput?: Row;
		trustedValues?: Row;
		key?: Row;
		expected?: Row;
		candidate?: Row;
	}>,
	facts: ExecutionFacts,
	operationTime: Date,
	nullableByPath: ReadonlyMap<string, boolean> = new Map(),
): readonly PostgresParameter[] {
	return parameters.map((parameter, index) => {
		if (parameter.position !== index + 1)
			throw new TypeError("Compiled Collection parameters are not positional");
		if (parameter.kind === "literal") return parameter.value;
		if (parameter.kind === "executionFact")
			return executionFact(parameter, facts, operationTime);
		if (
			parameter.kind === "callerInputPresent" ||
			parameter.kind === "patchPresent"
		) {
			if (!values.callerInput)
				throw new TypeError("Compiled Collection patch has no value source");
			return hasValueAt(values.callerInput, parameter.path);
		}
		if (parameter.kind === "trustedValuePresent")
			return values.trustedValues
				? hasValueAt(values.trustedValues, parameter.path)
				: false;
		if (parameter.kind === "expectedPresent")
			return values.expected
				? hasValueAt(values.expected, parameter.path)
				: false;
		const source =
			parameter.kind === "key"
				? values.key
				: parameter.kind === "candidateValue"
					? values.candidate
					: parameter.kind === "expectedValue"
						? values.expected
						: parameter.kind === "trustedValue"
							? values.trustedValues
							: values.callerInput;
		if (
			(parameter.kind === "trustedValue" ||
				parameter.kind === "expectedValue") &&
			!source
		)
			return null;
		if (!source)
			throw new TypeError("Compiled Collection parameter has no value source");
		if (
			(parameter.kind === "callerInput" ||
				parameter.kind === "patchValue" ||
				parameter.kind === "trustedValue" ||
				parameter.kind === "expectedValue") &&
			!hasValueAt(source, parameter.path)
		)
			return null;
		if (parameter.codec === "boolean")
			throw new TypeError("Compiled Collection presence parameter is invalid");
		return inputField(
			valueAt(source, parameter.path, "Collection value"),
			parameter.codec,
			nullableByPath.get(pathKey(parameter.path)) === true,
		);
	});
}
