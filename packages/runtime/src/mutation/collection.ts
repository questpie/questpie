import type {
	PostgresParameter,
	PostgresTransaction,
} from "../postgres/contract";
import {
	decodeMutationFieldInput,
	decodeMutationFieldResult,
	type MutationFieldCodecV1,
} from "./field-codec";
import type {
	LinkedPostgresCollectionOperationPlanV1,
	LinkedPostgresCollectionOperationPlansV1,
	LinkedPostgresCreateOperationPlanV1,
	LinkedPostgresGetOperationPlanV1,
	LinkedPostgresUpdateOperationPlanV1,
} from "./postgres-program";

type Row = Readonly<Record<string, unknown>>;
type Path = readonly string[];
type Parameter = LinkedPostgresGetOperationPlanV1["lock"]["parameters"][number];
type ExecutionFactParameter = Extract<Parameter, { kind: "executionFact" }>;
type Result = LinkedPostgresGetOperationPlanV1["read"]["result"][number];
type CollectionLeaf =
	| LinkedPostgresGetOperationPlanV1["lock"]
	| LinkedPostgresGetOperationPlanV1["read"]
	| LinkedPostgresCreateOperationPlanV1["fieldAuthority"]["checks"][number]
	| LinkedPostgresCreateOperationPlanV1["write"]
	| LinkedPostgresUpdateOperationPlanV1["lock"]
	| LinkedPostgresUpdateOperationPlanV1["fieldAuthority"]["checks"][number]
	| LinkedPostgresUpdateOperationPlanV1["write"];
type ExecuteCollectionLeaf = (
	leaf: CollectionLeaf,
	parameters: readonly PostgresParameter[],
) => Promise<readonly Row[]>;

export type TransactionQuery = (
	statement: string,
	parameters?: readonly unknown[],
) => Promise<readonly Row[]>;

type ExecutionFacts = Readonly<{
	principal: Readonly<{ id: string; kind: string }>;
	authority: Readonly<{ kind: string }>;
	tenant: Readonly<{ id: string }>;
}>;

function unavailable(): never {
	throw new TypeError("Collection operation is unavailable");
}

function record(value: unknown, label: string): Row {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as Row;
}

function exactRequest(
	value: unknown,
	key: "input" | "key",
	label: string,
): Row {
	const request = record(value, label);
	if (Object.keys(request).length !== 1 || !Object.hasOwn(request, key))
		throw new TypeError(`${label} must have exactly the compiled keys`);
	return request;
}

function exactRequestWithOptionalKeys(
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

function pathKey(path: Path): string {
	return JSON.stringify(path);
}

function valueAt(value: Row, path: Path): unknown {
	let current: unknown = value;
	for (const part of path) current = record(current, "Collection value")[part];
	return current;
}

function hasValueAt(value: Row, path: Path): boolean {
	let current: unknown = value;
	for (const [index, part] of path.entries()) {
		if (!current || typeof current !== "object" || Array.isArray(current))
			return false;
		if (!Object.hasOwn(current, part)) return false;
		current = (current as Row)[part];
		if (index < path.length - 1 && current === undefined) return false;
	}
	return true;
}

function inputPaths(
	value: unknown,
	label: string,
	physicalPaths: readonly Path[],
	prefix: string[] = [],
): Path[] {
	const source = record(value, label);
	const prototype = Object.getPrototypeOf(source);
	if (prototype !== null && prototype !== Object.prototype)
		throw new TypeError(`${label} must have exactly the compiled Fields`);
	if (
		prefix.length > 0 &&
		physicalPaths.some((fieldPath) => pathKey(fieldPath) === pathKey(prefix))
	)
		return [prefix];
	const paths: Path[] = [];
	const keys = Object.keys(source).sort();
	if (keys.length === 0 && prefix.length > 0) return [prefix];
	for (const key of keys) {
		const next = [...prefix, key];
		const child = source[key];
		if (
			child &&
			typeof child === "object" &&
			!Array.isArray(child) &&
			!(child instanceof Date)
		)
			paths.push(...inputPaths(child, label, physicalPaths, next));
		else paths.push(next);
	}
	return paths;
}

function exactPaths(
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

function allowedPaths(
	actual: readonly Path[],
	allowed: readonly Path[],
	label: string,
) {
	const allowedKeys = new Set(allowed.map(pathKey));
	const actualKeys = actual.map(pathKey);
	if (
		new Set(actualKeys).size !== actualKeys.length ||
		actualKeys.some((key) => !allowedKeys.has(key))
	)
		throw new TypeError(`${label} contains undeclared Fields`);
}

function rejectOverlap(
	callerPaths: readonly Path[],
	trustedPaths: readonly Path[],
	label: string,
) {
	const caller = new Set(callerPaths.map(pathKey));
	if (trustedPaths.some((path) => caller.has(pathKey(path))))
		throw new TypeError(`${label} must not overlap`);
}

function requirePaths(
	supplied: readonly Path[],
	required: readonly Path[],
	label: string,
) {
	const present = new Set(supplied.map(pathKey));
	if (required.some((path) => !present.has(pathKey(path))))
		throw new TypeError(`${label} is missing required Fields`);
}

function inputField(
	value: unknown,
	codec: MutationFieldCodecV1,
	nullable: boolean,
): PostgresParameter {
	return decodeMutationFieldInput(value, codec, nullable);
}

function setPath(target: Record<string, unknown>, path: Path, value: unknown) {
	let current = target;
	for (const part of path.slice(0, -1)) {
		const child = current[part];
		if (!child || typeof child !== "object" || Array.isArray(child))
			current[part] = {};
		current = current[part] as Record<string, unknown>;
	}
	current[path.at(-1)!] = value;
}

function decodeRow(
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

function bind(
	parameters: readonly Parameter[],
	values: Readonly<{ callerInput?: Row; trustedValues?: Row; key?: Row }>,
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
		const source =
			parameter.kind === "key"
				? values.key
				: parameter.kind === "trustedValue"
					? values.trustedValues
					: values.callerInput;
		if (parameter.kind === "trustedValue" && !source) return null;
		if (!source)
			throw new TypeError("Compiled Collection parameter has no value source");
		if (
			(parameter.kind === "callerInput" ||
				parameter.kind === "patchValue" ||
				parameter.kind === "trustedValue") &&
			!hasValueAt(source, parameter.path)
		)
			return null;
		if (parameter.codec === "boolean")
			throw new TypeError("Compiled Collection presence parameter is invalid");
		return inputField(
			valueAt(source, parameter.path),
			parameter.codec,
			nullableByPath.get(pathKey(parameter.path)) === true,
		);
	});
}

function validateScalars(
	source: Row,
	paths: readonly Path[],
	fields: readonly Readonly<{
		path: Path;
		codec: MutationFieldCodecV1;
		nullable: boolean;
	}>[],
) {
	const byPath = new Map(fields.map((field) => [pathKey(field.path), field]));
	for (const path of paths) {
		const field = byPath.get(pathKey(path));
		if (!field)
			throw new TypeError("Compiled Collection Field has no scalar definition");
		inputField(valueAt(source, path), field.codec, field.nullable);
	}
}

function collectionMember(target: string): string {
	if (
		!target.startsWith("collection:") ||
		target.length === "collection:".length
	)
		throw new TypeError("Compiled Collection target is invalid");
	return target.slice("collection:".length);
}

function createCollectionMutationData(
	input: Readonly<{
		plans: LinkedPostgresCollectionOperationPlansV1;
		executeLeaf: ExecuteCollectionLeaf;
		facts: ExecutionFacts;
		operationTime: Date;
		consumeRows(count: number): void;
		resultValuesDecoded: boolean;
	}>,
) {
	const execute = async (
		plan: LinkedPostgresCollectionOperationPlanV1,
		started: number,
		leaf: CollectionLeaf,
		parameters: readonly PostgresParameter[],
	) => {
		if (performance.now() - started > plan.limits.durationMilliseconds)
			throw new TypeError("Collection operation exceeded its duration limit");
		const rows = await input.executeLeaf(leaf, parameters);
		if (performance.now() - started > plan.limits.durationMilliseconds)
			throw new TypeError("Collection operation exceeded its duration limit");
		return rows;
	};
	const collections = new Map<
		string,
		{
			create?: LinkedPostgresCreateOperationPlanV1;
			get?: LinkedPostgresGetOperationPlanV1;
			update?: LinkedPostgresUpdateOperationPlanV1;
		}
	>();
	for (const plan of input.plans.plans) {
		const name = collectionMember(plan.target);
		const members = collections.get(name) ?? {};
		if (plan.member === "create") members.create = plan;
		else if (plan.member === "update") members.update = plan;
		else members.get = plan;
		collections.set(name, members);
	}
	return Object.freeze(
		Object.fromEntries(
			[...collections].map(([name, plans]) => [
				name,
				Object.freeze({
					...(plans.get
						? {
								get: async (rawRequest: unknown) => {
									const plan = plans.get!;
									const started = performance.now();
									const request = exactRequest(
										rawRequest,
										"key",
										"Collection get request",
									);
									const key = record(request.key, "Collection key");
									exactPaths(
										inputPaths(key, "Collection key", plan.operation.keyFields),
										plan.operation.keyFields,
										"Collection key",
									);
									const values = { key };
									const locked = await execute(
										plan,
										started,
										plan.lock,
										bind(
											plan.lock.parameters,
											values,
											input.facts,
											input.operationTime,
										),
									);
									if (locked.length > 1)
										throw new TypeError(
											"Collection lock returned multiple rows",
										);
									const rows = await execute(
										plan,
										started,
										plan.read,
										bind(
											plan.read.parameters,
											values,
											input.facts,
											input.operationTime,
										),
									);
									input.consumeRows(rows.length);
									if (rows.length > plan.limits.rows)
										throw new TypeError(
											"Collection get exceeded its row limit",
										);
									return rows[0]
										? decodeRow(
												rows[0],
												plan.read.result,
												input.resultValuesDecoded,
											)
										: null;
								},
							}
						: {}),
					...(plans.create
						? {
								create: async (rawRequest: unknown) => {
									const plan = plans.create!;
									const started = performance.now();
									const request = exactRequestWithOptionalKeys(
										rawRequest,
										["input"],
										["values"],
										"Collection create request",
									);
									const callerInput = record(
										request.input,
										"Collection create input",
									);
									const callerPaths = inputPaths(
										callerInput,
										"Collection create input",
										plan.operation.callerInputFields,
									);
									allowedPaths(
										callerPaths,
										plan.operation.callerInputFields,
										"Collection create input",
									);
									requirePaths(
										callerPaths,
										plan.operation.requiredCallerInputFields,
										"Collection create input",
									);
									const trustedValues = Object.hasOwn(request, "values")
										? record(request.values, "Collection create values")
										: undefined;
									const trustedPaths = trustedValues
										? inputPaths(
												trustedValues,
												"Collection create values",
												plan.operation.trustedValueFields,
											)
										: [];
									allowedPaths(
										trustedPaths,
										plan.operation.trustedValueFields,
										"Collection create values",
									);
									rejectOverlap(
										callerPaths,
										trustedPaths,
										"Collection create input and values",
									);
									requirePaths(
										trustedPaths,
										plan.operation.requiredTrustedValueFields,
										"Collection create values",
									);
									const nullableByPath = new Map(
										plan.candidate.fields.map(
											(field) => [pathKey(field.path), field.nullable] as const,
										),
									);
									validateScalars(
										callerInput,
										callerPaths,
										plan.candidate.fields,
									);
									if (trustedValues)
										validateScalars(
											trustedValues,
											trustedPaths,
											plan.candidate.fields,
										);
									const values = { callerInput, trustedValues };
									for (const check of plan.fieldAuthority.checks) {
										if (
											!callerPaths.some(
												(path) => pathKey(path) === pathKey(check.path),
											)
										)
											continue;
										const rows = await execute(
											plan,
											started,
											check,
											bind(
												check.parameters,
												values,
												input.facts,
												input.operationTime,
												nullableByPath,
											),
										);
										if (rows.length === 0) unavailable();
										if (rows.length !== 1)
											throw new TypeError(
												"Collection Field authority returned multiple rows",
											);
									}
									const rows = await execute(
										plan,
										started,
										plan.write,
										bind(
											plan.write.parameters,
											values,
											input.facts,
											input.operationTime,
											nullableByPath,
										),
									);
									input.consumeRows(rows.length);
									if (rows.length === 0) unavailable();
									if (rows.length > plan.limits.rows || rows.length !== 1)
										throw new TypeError(
											"Collection create exceeded its row limit",
										);
									return decodeRow(
										rows[0]!,
										plan.write.result,
										input.resultValuesDecoded,
									);
								},
							}
						: {}),
					...(plans.update
						? {
								update: async (rawRequest: unknown) => {
									const plan = plans.update!;
									const started = performance.now();
									const request = exactRequestWithOptionalKeys(
										rawRequest,
										["key"],
										["patch", "values"],
										"Collection update request",
									);
									const key = record(request.key, "Collection key");
									const patch = Object.hasOwn(request, "patch")
										? record(request.patch, "Collection update patch")
										: Object.freeze({});
									exactPaths(
										inputPaths(key, "Collection key", plan.operation.keyFields),
										plan.operation.keyFields,
										"Collection key",
									);
									const suppliedPaths = inputPaths(
										patch,
										"Collection update patch",
										plan.operation.callerInputFields,
									);
									const trustedValues = Object.hasOwn(request, "values")
										? record(request.values, "Collection update values")
										: undefined;
									const trustedPaths = trustedValues
										? inputPaths(
												trustedValues,
												"Collection update values",
												plan.operation.trustedValueFields,
											)
										: [];
									if (suppliedPaths.length === 0 && trustedPaths.length === 0)
										throw new TypeError(
											"Collection update patch and values must not both be empty",
										);
									allowedPaths(
										suppliedPaths,
										plan.operation.callerInputFields,
										"Collection update patch",
									);
									allowedPaths(
										trustedPaths,
										plan.operation.trustedValueFields,
										"Collection update values",
									);
									rejectOverlap(
										suppliedPaths,
										trustedPaths,
										"Collection update patch and values",
									);
									const nullableByPath = new Map(
										plan.candidate.fields.map(
											(field) => [pathKey(field.path), field.nullable] as const,
										),
									);
									validateScalars(patch, suppliedPaths, plan.candidate.fields);
									if (trustedValues)
										validateScalars(
											trustedValues,
											trustedPaths,
											plan.candidate.fields,
										);
									const values = { key, callerInput: patch, trustedValues };
									const locked = await execute(
										plan,
										started,
										plan.lock,
										bind(
											plan.lock.parameters,
											values,
											input.facts,
											input.operationTime,
										),
									);
									if (locked.length === 0) return null;
									if (locked.length !== 1)
										throw new TypeError(
											"Collection update lock returned multiple rows",
										);
									const supplied = new Set(suppliedPaths.map(pathKey));
									for (const check of plan.fieldAuthority.checks) {
										if (!supplied.has(pathKey(check.path))) continue;
										const rows = await execute(
											plan,
											started,
											check,
											bind(
												check.parameters,
												values,
												input.facts,
												input.operationTime,
												nullableByPath,
											),
										);
										if (rows.length === 0) return null;
										if (rows.length !== 1)
											throw new TypeError(
												"Collection update Field authority returned multiple rows",
											);
									}
									const rows = await execute(
										plan,
										started,
										plan.write,
										bind(
											plan.write.parameters,
											values,
											input.facts,
											input.operationTime,
											nullableByPath,
										),
									);
									input.consumeRows(rows.length);
									if (rows.length === 0) return null;
									if (rows.length > plan.limits.rows || rows.length !== 1)
										throw new TypeError(
											"Collection update exceeded its row limit",
										);
									return decodeRow(
										rows[0]!,
										plan.write.result,
										input.resultValuesDecoded,
									);
								},
							}
						: {}),
				}),
			]),
		),
	);
}

export function createPostgresCollectionMutationData(
	input: Readonly<{
		plans: LinkedPostgresCollectionOperationPlansV1;
		query: TransactionQuery;
		facts: ExecutionFacts;
		operationTime: Date;
		consumeRows(count: number): void;
	}>,
) {
	return createCollectionMutationData({
		...input,
		resultValuesDecoded: false,
		executeLeaf: (leaf, parameters) => input.query(leaf.sql, parameters),
	});
}

export function createPostgresDatabaseCollectionMutationData(
	input: Readonly<{
		plans: LinkedPostgresCollectionOperationPlansV1;
		transaction: PostgresTransaction;
		facts: ExecutionFacts;
		operationTime: Date;
		consumeRows(count: number): void;
	}>,
) {
	return createCollectionMutationData({
		...input,
		resultValuesDecoded: true,
		executeLeaf: (leaf, parameters) =>
			input.transaction.execute(leaf.statement, parameters),
	});
}
