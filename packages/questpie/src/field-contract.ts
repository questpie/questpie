export type { Codec, CodecKind, CodecValue } from "./codec";

export interface DataFieldDescriptor<
	Identity extends `collection:${string}/field:${string}`,
	FieldCodec,
	Value,
	Nullable extends boolean,
	HasDefault extends boolean,
	Immutable extends boolean = false,
	Server extends boolean = false,
> {
	readonly identity: Identity;
	readonly codec: FieldCodec;
	readonly nullable: Nullable;
	readonly hasDefault: HasDefault;
	readonly immutable: Immutable;
	readonly server: Server;
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
	Immutable extends boolean = boolean,
	Server extends boolean = boolean,
	Options extends Readonly<Record<string, unknown>> = Readonly<
		Record<string, unknown>
	>,
> {
	readonly kind: "field";
	readonly scalar: Scalar;
	readonly nullable: Nullable;
	readonly default: Default;
	readonly immutable: Immutable;
	readonly server: Server;
	readonly postgresName: string | null;
	readonly options: Options;
	readonly value?: Value;
}
