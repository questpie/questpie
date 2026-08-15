export type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

export interface TaggedJsonValue {
	readonly kind: "json";
	readonly value: JsonValue;
}

type EmbeddedValueKind =
	| "array"
	| "bigint"
	| "boolean"
	| "date"
	| "integer"
	| "numeric"
	| "object"
	| "text"
	| "timestamp"
	| "uuid";

export interface ValueDefinition<
	Value = unknown,
	Nullable extends boolean = boolean,
	Kind extends EmbeddedValueKind = EmbeddedValueKind,
> {
	readonly kind: Kind;
	readonly nullable: Nullable;
	readonly options: Readonly<Record<string, unknown>>;
	readonly value?: Value | (Nullable extends true ? null : never);
}

export type ValueOf<Definition> =
	Definition extends ValueDefinition<infer Result, infer Nullable>
		? Result | (Nullable extends true ? null : never)
		: never;

type ValueBaseOptions = Readonly<{ nullable: boolean }>;
type ExactOptions<Options, Shape> = Options &
	Readonly<Record<Exclude<keyof Options, keyof Shape>, never>>;

function valueDefinition<
	Value,
	Kind extends EmbeddedValueKind,
	const Options extends ValueBaseOptions & Readonly<Record<string, unknown>>,
>(
	kind: Kind,
	options: Options,
): ValueDefinition<Value, Options["nullable"], Kind> {
	const { nullable, ...rest } = options;
	return Object.freeze({
		kind,
		nullable,
		options: Object.freeze(rest),
	}) as ValueDefinition<Value, Options["nullable"], Kind>;
}

export const value = Object.freeze({
	uuid: <const Options extends ValueBaseOptions>(
		options: ExactOptions<Options, ValueBaseOptions>,
	) => valueDefinition<string, "uuid", Options>("uuid", options),
	text: <
		const Options extends ValueBaseOptions &
			Readonly<{ minLength?: number; maxLength?: number }>,
	>(
		options: ExactOptions<
			Options,
			ValueBaseOptions & Readonly<{ minLength?: number; maxLength?: number }>
		>,
	) => valueDefinition<string, "text", Options>("text", options),
	boolean: <const Options extends ValueBaseOptions>(
		options: ExactOptions<Options, ValueBaseOptions>,
	) => valueDefinition<boolean, "boolean", Options>("boolean", options),
	integer: <
		const Options extends ValueBaseOptions &
			Readonly<{ minimum?: number; maximum?: number }>,
	>(
		options: ExactOptions<
			Options,
			ValueBaseOptions & Readonly<{ minimum?: number; maximum?: number }>
		>,
	) => valueDefinition<number, "integer", Options>("integer", options),
	bigint: <
		const Options extends ValueBaseOptions &
			Readonly<{ minimum?: string; maximum?: string }>,
	>(
		options: ExactOptions<
			Options,
			ValueBaseOptions & Readonly<{ minimum?: string; maximum?: string }>
		>,
	) => valueDefinition<string, "bigint", Options>("bigint", options),
	numeric: <
		const Options extends ValueBaseOptions &
			Readonly<{ precision: number; scale: number }>,
	>(
		options: ExactOptions<
			Options,
			ValueBaseOptions & Readonly<{ precision: number; scale: number }>
		>,
	) => valueDefinition<string, "numeric", Options>("numeric", options),
	timestamp: <
		const Options extends ValueBaseOptions &
			Readonly<{ withTimezone: boolean }>,
	>(
		options: ExactOptions<
			Options,
			ValueBaseOptions & Readonly<{ withTimezone: boolean }>
		>,
	) => valueDefinition<string, "timestamp", Options>("timestamp", options),
	date: <const Options extends ValueBaseOptions>(
		options: ExactOptions<Options, ValueBaseOptions>,
	) => valueDefinition<string, "date", Options>("date", options),
	object: <
		const Options extends ValueBaseOptions &
			Readonly<{
				properties: Readonly<Record<string, ValueDefinition>>;
			}>,
	>(
		options: ExactOptions<
			Options,
			ValueBaseOptions &
				Readonly<{
					properties: Readonly<Record<string, ValueDefinition>>;
				}>
		>,
	) =>
		valueDefinition<
			Readonly<{
				[Key in keyof Options["properties"]]: ValueOf<
					Options["properties"][Key]
				>;
			}>,
			"object",
			Options
		>("object", options),
	array: <
		const Options extends ValueBaseOptions &
			Readonly<{ items: ValueDefinition; maximumItems: number }>,
	>(
		options: ExactOptions<
			Options,
			ValueBaseOptions &
				Readonly<{ items: ValueDefinition; maximumItems: number }>
		>,
	) =>
		valueDefinition<readonly ValueOf<Options["items"]>[], "array", Options>(
			"array",
			options,
		),
});
