import {
	decodeRelationalScalar,
	type ScalarCodecV1,
} from "../relational/scalar";

function fail(message: string): never {
	throw new TypeError(
		`Invalid PostgreSQL Collection Operation plan: ${message}`,
	);
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
