export type { Codec, CodecKind, CodecValue } from "./codec";

export interface DataFieldDescriptor<
	Identity extends `collection:${string}/field:${string}`,
	FieldCodec,
	Value,
	Nullable extends boolean,
	HasDefault extends boolean,
> {
	readonly identity: Identity;
	readonly codec: FieldCodec;
	readonly nullable: Nullable;
	readonly hasDefault: HasDefault;
	readonly value?: Value;
}

export type FieldDefault = "now" | "randomUuid" | boolean | number | string;

export type FieldValue = object | string | number | boolean | null;

export type FieldScalar =
	| "array"
	| "bigint"
	| "boolean"
	| "date"
	| "integer"
	| "json"
	| "numeric"
	| "object"
	| "text"
	| "timestamp"
	| "uuid";

export interface FieldDefinition<
	Value = FieldValue,
	Nullable extends boolean = boolean,
	Default extends FieldDefault | null = FieldDefault | null,
	Scalar extends FieldScalar = FieldScalar,
> {
	readonly kind: "field";
	readonly scalar: Scalar;
	readonly nullable: Nullable;
	readonly default: Default;
	readonly postgresName: string | null;
	readonly options: Readonly<Record<string, unknown>>;
	readonly value?: Value;
}
