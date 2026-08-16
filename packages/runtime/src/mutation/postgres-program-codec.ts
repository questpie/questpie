import type { RecordValue, ScalarCodecV1 } from "./postgres-program-types";

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

function nullableInteger(value: unknown, label: string): number | null {
	if (value === null) return null;
	if (!Number.isSafeInteger(value)) fail(`${label} is invalid`);
	return value as number;
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
		const minimum = nullableInteger(source.minimum, `${label} minimum`);
		const maximum = nullableInteger(source.maximum, `${label} maximum`);
		if (minimum !== null && maximum !== null && minimum > maximum)
			fail(`${label} bounds are invalid`);
		return Object.freeze({ kind: "integer", minimum, maximum });
	}
	if (source.kind === "bigint") {
		exact(source, ["kind", "minimum", "maximum"], label);
		for (const key of ["minimum", "maximum"])
			if (source[key] !== null && typeof source[key] !== "string")
				fail(`${label} ${key} is invalid`);
		return Object.freeze({
			kind: "bigint",
			minimum: source.minimum as string | null,
			maximum: source.maximum as string | null,
		});
	}
	if (source.kind === "numeric") {
		exact(source, ["kind", "precision", "scale"], label);
		if (
			!Number.isSafeInteger(source.precision) ||
			!Number.isSafeInteger(source.scale) ||
			(source.precision as number) <= 0 ||
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
