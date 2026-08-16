import { decodeRelationalScalar, type ScalarCodecV1 } from "../relational";
import type { RecordValue } from "./postgres-program-types";

function fail(message: string): never {
	throw new TypeError(
		`Invalid PostgreSQL Collection Operation plan: ${message}`,
	);
}

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail(`${label} must be an object`);
	return value as RecordValue;
}

function exact(
	value: RecordValue,
	keys: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (
		actual.length !== expected.length ||
		expected.some((key, index) => key !== actual[index])
	)
		fail(`${label} has invalid keys`);
}

export function decodePostgresStatement(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		fail(`${label} is invalid`);
	if (
		Buffer.byteLength(value) > 1_048_576 ||
		value.includes(";") ||
		value.includes("--") ||
		value.includes("/*") ||
		value.includes("*/")
	)
		fail(`${label} is not one static statement`);
	return value;
}

function nullableInteger(value: unknown, label: string): number | null {
	if (value === null) return null;
	if (!Number.isSafeInteger(value)) fail(`${label} is invalid`);
	return value as number;
}

function boundedNullableInteger(
	value: unknown,
	label: string,
	minimum: number,
	maximum: number,
): number | null {
	const result = nullableInteger(value, label);
	if (result !== null && (result < minimum || result > maximum))
		fail(`${label} bounds are invalid`);
	return result;
}

function nullableBigint(value: unknown, label: string): string | null {
	if (value === null) return null;
	if (
		typeof value !== "string" ||
		!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value)
	)
		fail(`${label} bigint is invalid`);
	const result = BigInt(value);
	if (
		result < -9_223_372_036_854_775_808n ||
		result > 9_223_372_036_854_775_807n
	)
		fail(`${label} bigint is invalid`);
	return value;
}

export function decodePostgresScalarCodec(
	value: unknown,
	label: string,
): ScalarCodecV1 {
	const source = record(value, label);
	if (
		source.kind === "uuid" ||
		source.kind === "boolean" ||
		source.kind === "date"
	) {
		exact(source, ["kind"], label);
		return Object.freeze({ kind: source.kind });
	}
	if (source.kind === "text") {
		exact(source, ["kind", "minLength", "maxLength", "collation"], label);
		const minLength = nullableInteger(source.minLength, `${label} minLength`);
		const maxLength = nullableInteger(source.maxLength, `${label} maxLength`);
		if (
			(minLength !== null && minLength < 0) ||
			(maxLength !== null && maxLength < 0) ||
			(minLength !== null && maxLength !== null && minLength > maxLength) ||
			source.collation !== "questpie.binary"
		)
			fail(`${label} bounds are invalid`);
		return Object.freeze({
			kind: "text",
			minLength,
			maxLength,
			collation: "questpie.binary",
		});
	}
	if (source.kind === "integer") {
		exact(source, ["kind", "minimum", "maximum"], label);
		const minimum = boundedNullableInteger(
			source.minimum,
			`${label} minimum`,
			-2_147_483_648,
			2_147_483_647,
		);
		const maximum = boundedNullableInteger(
			source.maximum,
			`${label} maximum`,
			-2_147_483_648,
			2_147_483_647,
		);
		if (minimum !== null && maximum !== null && minimum > maximum)
			fail(`${label} bounds are invalid`);
		return Object.freeze({ kind: "integer", minimum, maximum });
	}
	if (source.kind === "bigint") {
		exact(source, ["kind", "minimum", "maximum"], label);
		const minimum = nullableBigint(source.minimum, `${label} minimum`);
		const maximum = nullableBigint(source.maximum, `${label} maximum`);
		if (
			minimum !== null &&
			maximum !== null &&
			BigInt(minimum) > BigInt(maximum)
		)
			fail(`${label} bounds are invalid`);
		return Object.freeze({
			kind: "bigint",
			minimum,
			maximum,
		});
	}
	if (source.kind === "numeric") {
		exact(source, ["kind", "precision", "scale"], label);
		if (
			!Number.isSafeInteger(source.precision) ||
			!Number.isSafeInteger(source.scale) ||
			(source.precision as number) <= 0 ||
			(source.precision as number) > 1_000 ||
			(source.scale as number) < 0 ||
			(source.scale as number) > (source.precision as number)
		)
			fail(`${label} bounds are invalid`);
		return Object.freeze({
			kind: "numeric",
			precision: source.precision as number,
			scale: source.scale as number,
		});
	}
	if (source.kind === "timestamp") {
		exact(source, ["kind", "withTimezone"], label);
		if (typeof source.withTimezone !== "boolean") fail(`${label} is invalid`);
		return Object.freeze({
			kind: "timestamp",
			withTimezone: source.withTimezone,
		});
	}
	fail(`${label} kind is invalid`);
}

export function postgresTypeForScalarCodec(codec: ScalarCodecV1): string {
	if (codec.kind === "timestamp")
		return codec.withTimezone ? "timestamptz" : "timestamp";
	return codec.kind === "text" ? "text" : codec.kind;
}

const executionFactContracts: Readonly<
	Record<
		string,
		Readonly<{ codec: ScalarCodecV1["kind"]; postgresType: string }>
	>
> = Object.freeze({
	"authority.kind": { codec: "text", postgresType: "text" },
	"operationTime.": { codec: "timestamp", postgresType: "timestamptz" },
	"principal.id": { codec: "uuid", postgresType: "uuid" },
	"principal.kind": { codec: "text", postgresType: "text" },
	"tenant.id": { codec: "uuid", postgresType: "uuid" },
});

export function decodePostgresExecutionFact(
	source: string,
	path: readonly string[],
	codec: unknown,
	postgresType: string,
	label: string,
): ScalarCodecV1["kind"] {
	const contract = executionFactContracts[`${source}.${path.join(".")}`];
	if (
		!contract ||
		contract.codec !== codec ||
		contract.postgresType !== postgresType
	)
		fail(`${label} execution source is invalid`);
	return contract.codec;
}

function literalDescriptor(
	kind: string,
	postgresType: string,
): ScalarCodecV1 | null {
	switch (`${kind}:${postgresType}`) {
		case "uuid:uuid":
			return { kind: "uuid" };
		case "boolean:boolean":
			return { kind: "boolean" };
		case "integer:integer":
			return { kind: "integer", minimum: null, maximum: null };
		case "bigint:bigint":
			return { kind: "bigint", minimum: null, maximum: null };
		case "text:text":
			return {
				kind: "text",
				minLength: null,
				maxLength: null,
				collation: "questpie.binary",
			};
		case "date:date":
			return { kind: "date" };
		case "timestamp:timestamp":
			return { kind: "timestamp", withTimezone: false };
		case "timestamp:timestamptz":
			return { kind: "timestamp", withTimezone: true };
		default:
			return null;
	}
}

export function decodePostgresLiteralCodec(
	value: unknown,
	postgresType: string,
	literal: null | boolean | number | string,
	label: string,
): ScalarCodecV1["kind"] {
	if (typeof value !== "string" || value.length === 0)
		fail(`${label} codec is invalid`);
	if (value === "numeric" && postgresType === "numeric") {
		if (
			literal !== null &&
			(typeof literal !== "string" ||
				!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(literal))
		)
			fail(`${label} literal is invalid`);
		return "numeric";
	}
	const descriptor = literalDescriptor(value, postgresType);
	if (descriptor === null) fail(`${label} codec or PostgreSQL type is invalid`);
	if (literal !== null) {
		try {
			decodeRelationalScalar(literal, descriptor);
		} catch {
			fail(`${label} literal is invalid`);
		}
	}
	return descriptor.kind;
}
