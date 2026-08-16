import { decodeRelationalScalar, type ScalarCodecV1 } from "../relational";
import type {
	LinkedPostgresCollectionOperationPlanV1,
	LinkedPostgresCollectionOperationPlansV1,
	LinkedPostgresCreateOperationPlanV1,
	LinkedPostgresGetOperationPlanV1,
} from "./postgres-program";

type Row = Readonly<Record<string, unknown>>;
type Path = readonly string[];
type Parameter = LinkedPostgresGetOperationPlanV1["lock"]["parameters"][number];
type Result = LinkedPostgresGetOperationPlanV1["read"]["result"][number];

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

function pathKey(path: Path): string {
	return JSON.stringify(path);
}

function valueAt(value: Row, path: Path): unknown {
	let current: unknown = value;
	for (const part of path) current = record(current, "Collection value")[part];
	return current;
}

function inputPaths(
	value: unknown,
	label: string,
	prefix: string[] = [],
): Path[] {
	const source = record(value, label);
	const prototype = Object.getPrototypeOf(source);
	if (prototype !== null && prototype !== Object.prototype)
		throw new TypeError(`${label} must have exactly the compiled Fields`);
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
			paths.push(...inputPaths(child, label, next));
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

function inputScalar(value: unknown, codec: ScalarCodecV1, nullable: boolean) {
	if (value === null && nullable) return null;
	return decodeRelationalScalar(value, codec, "date");
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

function decodeRow(row: Row, result: readonly Result[]) {
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
				: decodeRelationalScalar(value, field.codec, "date"),
		);
	}
	return Object.freeze(output);
}

function executionFact(
	parameter: Parameter,
	facts: ExecutionFacts,
	operationTime: Date,
): unknown {
	if (!parameter.source || !parameter.path)
		throw new TypeError(
			"Compiled Collection plan references an invalid execution fact",
		);
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
	values: Readonly<{ callerInput?: Row; key?: Row }>,
	facts: ExecutionFacts,
	operationTime: Date,
	nullableByPath: ReadonlyMap<string, boolean> = new Map(),
) {
	return parameters.map((parameter, index) => {
		if (parameter.position !== index + 1)
			throw new TypeError("Compiled Collection parameters are not positional");
		if (parameter.kind === "literal") return parameter.value;
		if (parameter.kind === "executionFact")
			return executionFact(parameter, facts, operationTime);
		const source = parameter.kind === "key" ? values.key : values.callerInput;
		if (!source || !parameter.path || typeof parameter.codec === "string")
			throw new TypeError("Compiled Collection parameter has no value source");
		return inputScalar(
			valueAt(source, parameter.path),
			parameter.codec,
			nullableByPath.get(pathKey(parameter.path)) === true,
		);
	});
}

function collectionMember(target: string): string {
	if (
		!target.startsWith("collection:") ||
		target.length === "collection:".length
	)
		throw new TypeError("Compiled Collection target is invalid");
	return target.slice("collection:".length);
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
	const execute = async (
		plan: LinkedPostgresCollectionOperationPlanV1,
		started: number,
		statement: string,
		parameters: readonly unknown[],
	) => {
		if (performance.now() - started > plan.limits.durationMilliseconds)
			throw new TypeError("Collection operation exceeded its duration limit");
		const rows = await input.query(statement, parameters);
		if (performance.now() - started > plan.limits.durationMilliseconds)
			throw new TypeError("Collection operation exceeded its duration limit");
		return rows;
	};
	const collections = new Map<
		string,
		{
			create?: LinkedPostgresCreateOperationPlanV1;
			get?: LinkedPostgresGetOperationPlanV1;
		}
	>();
	for (const plan of input.plans.plans) {
		const name = collectionMember(plan.target);
		const members = collections.get(name) ?? {};
		if (plan.member === "create") members.create = plan;
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
										inputPaths(key, "Collection key"),
										plan.operation.keyFields,
										"Collection key",
									);
									const values = { key };
									const locked = await execute(
										plan,
										started,
										plan.lock.sql,
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
										plan.read.sql,
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
									return rows[0] ? decodeRow(rows[0], plan.read.result) : null;
								},
							}
						: {}),
					...(plans.create
						? {
								create: async (rawRequest: unknown) => {
									const plan = plans.create!;
									const started = performance.now();
									const request = exactRequest(
										rawRequest,
										"input",
										"Collection create request",
									);
									const callerInput = record(
										request.input,
										"Collection create input",
									);
									exactPaths(
										inputPaths(callerInput, "Collection create input"),
										plan.operation.callerInputFields,
										"Collection create input",
									);
									const nullableByPath = new Map(
										plan.candidate.fields.map(
											(field) => [pathKey(field.path), field.nullable] as const,
										),
									);
									const values = { callerInput };
									for (const check of plan.fieldAuthority.checks) {
										const rows = await execute(
											plan,
											started,
											check.sql,
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
										plan.write.sql,
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
									return decodeRow(rows[0]!, plan.write.result);
								},
							}
						: {}),
				}),
			]),
		),
	);
}
