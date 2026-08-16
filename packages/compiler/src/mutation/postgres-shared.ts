import { canonicalBytes, digest } from "../canonical";
import type {
	PolicyProgramV1,
	PostgresMutationCollectionV1,
	PostgresMutationFieldV1,
	ScalarCodecV1,
} from "../relational";
import type { CollectionOperationProgramV1 } from "./operation-set-contract";
import type {
	PostgresOperationParameterV1,
	PostgresOperationResultV1,
} from "./postgres-contract";

export type RecordValue = Readonly<Record<string, unknown>>;

export function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as RecordValue;
}

export function items(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
	return value;
}

export function path(value: unknown, label: string): readonly string[] {
	const parts = items(value, label);
	if (
		parts.length === 0 ||
		parts.some((part) => typeof part !== "string" || part.length === 0)
	)
		throw new TypeError(`${label} must be a non-empty Field path`);
	return parts as readonly string[];
}

export function quote(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

export function postgresType(codec: ScalarCodecV1): string {
	switch (codec.kind) {
		case "uuid":
			return "uuid";
		case "boolean":
			return "boolean";
		case "integer":
			return "integer";
		case "bigint":
			return "bigint";
		case "numeric":
			return "numeric";
		case "timestamp":
			return codec.withTimezone ? "timestamptz" : "timestamp";
		case "date":
			return "date";
		case "text":
			return "text";
	}
	throw new TypeError("unsupported PostgreSQL codec");
}

type ParameterInput = PostgresOperationParameterV1 extends infer Parameter
	? Parameter extends Readonly<{ position: number }>
		? Omit<Parameter, "position">
		: never
	: never;

export class Parameters {
	readonly #parameters: PostgresOperationParameterV1[] = [];
	readonly #positions = new Map<string, number>();

	constructor(initial: readonly RecordValue[] = []) {
		for (const raw of initial) {
			if (raw.kind !== "executionFact" && raw.kind !== "literal")
				throw new TypeError("write Policy emitted an unsupported parameter");
			const { position: _position, ...parameter } = raw;
			this.add(parameter as ParameterInput);
		}
	}

	add(parameter: ParameterInput): string {
		const key = canonicalBytes(parameter);
		let position = this.#positions.get(key);
		if (position === undefined) {
			position = this.#parameters.length + 1;
			this.#positions.set(key, position);
			this.#parameters.push({ ...parameter, position });
		}
		return `$${position}::${parameter.postgresType}`;
	}

	values(): readonly PostgresOperationParameterV1[] {
		return Object.freeze([...this.#parameters]);
	}
}

export function fieldByPath(
	collection: PostgresMutationCollectionV1,
	fieldPath: readonly string[],
): PostgresMutationFieldV1 {
	const field = collection.fields.find(
		(candidate) => canonicalBytes(candidate.path) === canonicalBytes(fieldPath),
	);
	if (!field)
		throw new TypeError(
			`${collection.identity} has no Field ${fieldPath.join(".")}`,
		);
	return field;
}

export function projection(
	value: unknown,
	format: string,
	key: string,
): readonly unknown[] {
	const artifact = record(value, format);
	if (artifact.format !== format || artifact.version !== 1)
		throw new TypeError(`invalid ${format}`);
	return items(artifact[key], `${format}.${key}`);
}

export function policyFor(value: unknown, identity: string): PolicyProgramV1 {
	const matches = projection(value, "questpie.policy-projection", "policies")
		.map((entry) => record(entry, "Policy projection entry"))
		.filter(
			(entry) => record(entry.program, "Policy program").identity === identity,
		);
	if (matches.length !== 1)
		throw new TypeError(`expected one Policy ${identity}`);
	return matches[0]!.program as PolicyProgramV1;
}

export function linkedProgram(
	value: unknown,
	format: string,
	key: string,
	artifact: string,
	operation: CollectionOperationProgramV1,
	expectedDigest: string | null,
): RecordValue | null {
	const matches = projection(value, format, key)
		.map((candidate) => record(candidate, artifact))
		.filter(
			(candidate) =>
				candidate.target === operation.target &&
				candidate.operation === operation.member,
		);
	if (expectedDigest === null) {
		if (matches.length !== 0)
			throw new TypeError(`${operation.identity} has an unlinked ${artifact}`);
		return null;
	}
	if (matches.length !== 1)
		throw new TypeError(`${operation.identity} requires one ${artifact}`);
	const actual = digest(
		artifact === "normalizer program"
			? "questpie-field-normalizer-program-v1"
			: "questpie-server-value-program-v1",
		matches[0],
	);
	if (actual !== expectedDigest)
		throw new TypeError(`${operation.identity} ${artifact} digest mismatch`);
	return matches[0]!;
}

function parameterFromPolicy(value: RecordValue): ParameterInput {
	if (value.kind === "executionFact")
		return {
			kind: "executionFact",
			source: String(value.source),
			path: value.path as readonly string[],
			codec: String(value.codec),
			postgresType: String(value.postgresType),
		};
	if (value.kind === "literal")
		return {
			kind: "literal",
			value: value.value as null | boolean | number | string,
			codec: String(value.codec),
			postgresType: String(value.postgresType),
		};
	throw new TypeError("unsupported Policy parameter");
}

export function policyParameters(parameters: readonly unknown[]): Parameters {
	return new Parameters(
		parameters.map((parameter) => {
			const raw = record(parameter, "Policy parameter");
			return { ...parameterFromPolicy(raw), position: raw.position };
		}),
	);
}

export function result(
	collection: PostgresMutationCollectionV1,
	paths: readonly (readonly string[])[],
): readonly PostgresOperationResultV1[] {
	return Object.freeze(
		paths.map((fieldPath, index) => {
			const field = fieldByPath(collection, fieldPath);
			return Object.freeze({
				path: field.path,
				column: `qp_result_${index}`,
				codec: field.codec,
				nullable: field.nullable,
			});
		}),
	);
}

export function inputParameter(
	parameters: Parameters,
	kind: "callerInput" | "key",
	field: PostgresMutationFieldV1,
): string {
	return parameters.add({
		kind,
		path: field.path,
		codec: field.codec,
		postgresType: postgresType(field.codec),
	});
}

export function executionParameter(
	parameters: Parameters,
	source: string,
	sourcePath: readonly string[],
	field: PostgresMutationFieldV1,
): string {
	return parameters.add({
		kind: "executionFact",
		source,
		path: sourcePath,
		codec: field.codec.kind,
		postgresType: postgresType(field.codec),
	});
}
