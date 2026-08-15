export type CodecKind =
	| "array"
	| "boolean"
	| "integer"
	| "nullable"
	| "object"
	| "optional"
	| "text"
	| "timestamp"
	| "uuid";

export interface Codec<
	Value,
	Kind extends CodecKind = CodecKind,
	Presence extends "required" | "optional" = "required",
> {
	readonly kind: Kind;
	readonly presence?: Presence;
	readonly value?: Value;
}

export type CodecValue<ValueCodec> =
	ValueCodec extends Codec<infer Value> ? Value : never;

type AnyCodec = Codec<unknown, CodecKind, "required" | "optional">;
type CodecMap = Readonly<Record<string, AnyCodec>>;
type OptionalKeys<Properties extends CodecMap> = {
	[Key in keyof Properties]: Properties[Key] extends Codec<
		unknown,
		CodecKind,
		"optional"
	>
		? Key
		: never;
}[keyof Properties];
type RequiredKeys<Properties extends CodecMap> = Exclude<
	keyof Properties,
	OptionalKeys<Properties>
>;
type ObjectValue<Properties extends CodecMap> = Readonly<
	{
		[Key in RequiredKeys<Properties>]: CodecValue<Properties[Key]>;
	} & {
		[Key in OptionalKeys<Properties>]?: CodecValue<Properties[Key]>;
	}
>;

function scalar<
	Value,
	Kind extends "boolean" | "integer" | "text" | "timestamp" | "uuid",
>(kind: Kind): Codec<Value, Kind> {
	return Object.freeze({ kind });
}

export const codec = Object.freeze({
	uuid: () => scalar<string, "uuid">("uuid"),
	text: () => scalar<string, "text">("text"),
	boolean: () => scalar<boolean, "boolean">("boolean"),
	integer: () => scalar<number, "integer">("integer"),
	timestamp: () => scalar<Date, "timestamp">("timestamp"),
	object: <const Properties extends CodecMap>(
		properties: Properties,
	): Codec<ObjectValue<Properties>, "object"> =>
		Object.freeze({ kind: "object", properties: Object.freeze(properties) }),
	array: <const Item extends AnyCodec>(
		items: Item,
	): Codec<readonly CodecValue<Item>[], "array"> =>
		Object.freeze({ kind: "array", items }),
	nullable: <const ValueCodec extends AnyCodec>(
		value: ValueCodec,
	): Codec<CodecValue<ValueCodec> | null, "nullable"> =>
		Object.freeze({ kind: "nullable", codec: value }),
	optional: <const ValueCodec extends AnyCodec>(
		value: ValueCodec,
	): Codec<CodecValue<ValueCodec>, "optional", "optional"> =>
		Object.freeze({ kind: "optional", presence: "optional", codec: value }),
});
