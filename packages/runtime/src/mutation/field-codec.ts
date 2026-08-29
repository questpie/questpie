import {
	decodeRuntimeCodec,
	decodeRuntimeCodecDescriptor,
	encodeRuntimeCodec,
	type RuntimeCodec,
} from "../codec";
import type {
	PostgresJson,
	PostgresJsonValue,
	PostgresParameter,
} from "../postgres";
import {
	decodeRelationalScalar,
	decodeRelationalScalarCodec,
	type ScalarCodecV1,
} from "../relational";
import {
	mutationPathKey as pathKey,
	mutationValueAt as valueAt,
	type MutationFieldPath,
} from "./field-path";

export type MutationFieldCodecV1 =
	| ScalarCodecV1
	| Readonly<{ kind: "json" }>
	| Readonly<{
			kind: "object";
			properties: Readonly<Record<string, RuntimeCodec>>;
	  }>
	| Readonly<{ kind: "array"; items: RuntimeCodec; maximum?: number }>;

export function decodeMutationFieldCodec(
	value: unknown,
	label: string,
): MutationFieldCodecV1 {
	const kind =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Readonly<Record<string, unknown>>).kind
			: undefined;
	if (kind === "object" || kind === "array" || kind === "json") {
		const codec = decodeRuntimeCodecDescriptor(value, label);
		if (
			codec.kind !== "object" &&
			codec.kind !== "array" &&
			codec.kind !== "json"
		)
			throw new TypeError(`${label} must describe one physical Field`);
		return codec as MutationFieldCodecV1;
	}
	return decodeRelationalScalarCodec(value, label);
}

export function postgresTypeForMutationFieldCodec(
	codec: MutationFieldCodecV1,
): string {
	if (
		codec.kind === "object" ||
		codec.kind === "array" ||
		codec.kind === "json"
	)
		return "jsonb";
	if (codec.kind === "timestamp")
		return codec.withTimezone ? "timestamptz" : "timestamp";
	return codec.kind === "text" ? "text" : codec.kind;
}

function jsonParameter(value: unknown): PostgresJson {
	return Object.freeze({ kind: "json", value: value as PostgresJsonValue });
}

export function decodeMutationFieldInput(
	value: unknown,
	codec: MutationFieldCodecV1,
	nullable: boolean,
): PostgresParameter {
	if (value === null && nullable) return null;
	if (
		codec.kind !== "object" &&
		codec.kind !== "array" &&
		codec.kind !== "json"
	)
		return decodeRelationalScalar(value, codec, "date") as PostgresParameter;
	const decoded = decodeRuntimeCodec(codec, value, "$field");
	const encoded = encodeRuntimeCodec(codec, decoded, "$field");
	return codec.kind === "json"
		? jsonParameter(
				(encoded as Readonly<{ kind: "json"; value: unknown }>).value,
			)
		: jsonParameter(encoded);
}

export function decodeMutationFieldResult(
	value: unknown,
	codec: MutationFieldCodecV1,
): unknown {
	if (
		codec.kind !== "object" &&
		codec.kind !== "array" &&
		codec.kind !== "json"
	)
		return decodeRelationalScalar(value, codec, "date");
	return decodeRuntimeCodec(
		codec,
		codec.kind === "json" ? { kind: "json", value } : value,
		"$field",
	);
}

export function validateMutationFieldScalars(
	source: Readonly<Record<string, unknown>>,
	paths: readonly MutationFieldPath[],
	fields: readonly Readonly<{
		path: MutationFieldPath;
		codec: MutationFieldCodecV1;
		nullable: boolean;
	}>[],
) {
	const byPath = new Map(fields.map((field) => [pathKey(field.path), field]));
	for (const path of paths) {
		const field = byPath.get(pathKey(path));
		if (!field)
			throw new TypeError("Compiled Collection Field has no scalar definition");
		decodeMutationFieldInput(
			valueAt(source, path, "Collection value"),
			field.codec,
			field.nullable,
		);
	}
}
