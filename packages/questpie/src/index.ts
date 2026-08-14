export type CodecKind = "boolean" | "integer" | "object" | "text" | "uuid";

export interface Codec<Value, Kind extends CodecKind = CodecKind> {
	readonly kind: Kind;
	readonly value?: Value;
}

export type CodecValue<ValueCodec> =
	ValueCodec extends Codec<infer Value> ? Value : never;

type ScalarOptions = Readonly<{ nullable?: boolean }>;
type FieldBaseOptions = Readonly<{
	nullable?: boolean;
	postgres?: Readonly<{ name: string }>;
}>;

type FieldRuntimeOptions = FieldBaseOptions &
	Readonly<{
		default?: "now" | "randomUuid";
		minLength?: number;
		maxLength?: number;
		minimum?: number;
		maximum?: number;
		withTimezone?: boolean;
	}>;

type FieldValue = object | string | number | boolean | Date | null;

export interface FieldDefinition<Value = FieldValue> {
	readonly kind: "field";
	readonly scalar: "boolean" | "integer" | "text" | "timestamp" | "uuid";
	readonly nullable: boolean;
	readonly default: "now" | "randomUuid" | null;
	readonly postgresName: string | null;
	readonly options: Readonly<Record<string, boolean | number | string | null>>;
	readonly value?: Value;
}

function fieldDefinition<Value>(
	scalar: FieldDefinition["scalar"],
	options: FieldRuntimeOptions = {},
): FieldDefinition<Value> {
	const normalizedOptions: Record<string, boolean | number | string | null> =
		{};
	for (const key of [
		"minLength",
		"maxLength",
		"minimum",
		"maximum",
		"withTimezone",
	] as const) {
		const value = options[key];
		if (value !== undefined) normalizedOptions[key] = value;
	}
	return Object.freeze({
		kind: "field",
		scalar,
		nullable: options.nullable ?? false,
		default: options.default ?? null,
		postgresName: options.postgres?.name ?? null,
		options: Object.freeze(normalizedOptions),
	});
}

export const field = Object.freeze({
	uuid: (
		options: FieldBaseOptions & Readonly<{ default?: "randomUuid" }> = {},
	) => fieldDefinition<string>("uuid", options),
	text: (
		options: FieldBaseOptions &
			Readonly<{ minLength?: number; maxLength?: number }> = {},
	) => fieldDefinition<string>("text", options),
	boolean: (options: FieldBaseOptions = {}) =>
		fieldDefinition<boolean>("boolean", options),
	integer: (
		options: FieldBaseOptions &
			Readonly<{ minimum?: number; maximum?: number }> = {},
	) => fieldDefinition<number>("integer", options),
	timestamp: (
		options: FieldBaseOptions &
			Readonly<{ default?: "now"; withTimezone?: boolean }> = {},
	) => fieldDefinition<Date>("timestamp", options),
});

function scalarCodec<Value, Kind extends Exclude<CodecKind, "object">>(
	kind: Kind,
	options: ScalarOptions = {},
): Codec<Value, Kind> {
	return Object.freeze({ kind, nullable: options.nullable ?? false });
}

export const codec = Object.freeze({
	uuid: (options: ScalarOptions = {}) =>
		scalarCodec<string, "uuid">("uuid", options),
	text: (options: ScalarOptions = {}) =>
		scalarCodec<string, "text">("text", options),
	boolean: (options: ScalarOptions = {}) =>
		scalarCodec<boolean, "boolean">("boolean", options),
	integer: (options: ScalarOptions = {}) =>
		scalarCodec<number, "integer">("integer", options),
	object: <
		const Properties extends Readonly<
			Record<string, Codec<object | string | number | boolean | null>>
		>,
	>(
		properties: Properties,
	): Codec<
		{
			readonly [Key in keyof Properties]: CodecValue<Properties[Key]>;
		},
		"object"
	> => Object.freeze({ kind: "object", properties }),
});

export interface ConstraintDefinition {
	readonly kind: "primaryKey" | "unique";
	readonly fields: readonly string[];
	readonly postgresName: string | null;
}

export const constraint = Object.freeze({
	primaryKey: (
		input: Readonly<{ fields: readonly string[]; postgres?: { name: string } }>,
	): ConstraintDefinition =>
		Object.freeze({
			kind: "primaryKey",
			fields: Object.freeze([...input.fields]),
			postgresName: input.postgres?.name ?? null,
		}),
	unique: (
		input: Readonly<{ fields: readonly string[]; postgres?: { name: string } }>,
	): ConstraintDefinition =>
		Object.freeze({
			kind: "unique",
			fields: Object.freeze([...input.fields]),
			postgresName: input.postgres?.name ?? null,
		}),
});

export interface IndexDefinition {
	readonly kind: "btree";
	readonly fields: readonly string[];
	readonly postgresName: string | null;
}

export function index(
	input: Readonly<{ fields: readonly string[]; postgres?: { name: string } }>,
): IndexDefinition {
	return Object.freeze({
		kind: "btree",
		fields: Object.freeze([...input.fields]),
		postgresName: input.postgres?.name ?? null,
	});
}

export interface RelationDefinition {
	readonly kind: "toOne";
	readonly target: `collection:${string}`;
	readonly fields: readonly string[];
	readonly references: readonly string[];
	readonly onDelete: "restrict" | "cascade" | "setNull" | "noAction";
	readonly onUpdate: "restrict" | "cascade" | "setNull" | "noAction";
	readonly postgresName: string | null;
}

export function relationRef<const Name extends string>(
	name: Name,
): `collection:${Name}` {
	return `collection:${name}`;
}

export const relation = Object.freeze({
	toOne: (
		input: Readonly<{
			target: `collection:${string}`;
			fields: readonly string[];
			references: readonly string[];
			onDelete?: RelationDefinition["onDelete"];
			onUpdate?: RelationDefinition["onUpdate"];
			postgres?: { name: string };
		}>,
	): RelationDefinition =>
		Object.freeze({
			kind: "toOne",
			target: input.target,
			fields: Object.freeze([...input.fields]),
			references: Object.freeze([...input.references]),
			onDelete: input.onDelete ?? "restrict",
			onUpdate: input.onUpdate ?? "restrict",
			postgresName: input.postgres?.name ?? null,
		}),
});

interface DefinitionBrand {
	readonly category: "definition";
	readonly resourceKind: "collection";
}

interface AugmentationBrand {
	readonly category: "augmentation";
	readonly resourceKind: "collection";
}

export interface CollectionAugmentation<
	Name extends string = string,
	Fields extends Readonly<Record<string, FieldDefinition>> = Readonly<
		Record<string, FieldDefinition>
	>,
> {
	readonly __questpie: AugmentationBrand;
	readonly name: Name;
	readonly fields: Fields;
	readonly constraints: Readonly<Record<string, ConstraintDefinition>>;
	readonly indexes: Readonly<Record<string, IndexDefinition>>;
}

export interface CollectionDefinition<
	Name extends string = string,
	Fields extends Readonly<Record<string, FieldDefinition>> = Readonly<
		Record<string, FieldDefinition>
	>,
> {
	readonly __questpie: DefinitionBrand;
	readonly name: Name;
	readonly fields: Fields;
	readonly constraints: Readonly<Record<string, ConstraintDefinition>>;
	readonly indexes: Readonly<Record<string, IndexDefinition>>;
	readonly relations: Readonly<Record<string, RelationDefinition>>;
	readonly augmentations: readonly CollectionAugmentation[];
	readonly postgresName: string | null;
}

export function defineCollectionAugmentation<
	const Name extends string,
	const Fields extends Readonly<Record<string, FieldDefinition>>,
>(
	input: Readonly<{
		name: Name;
		fields?: Fields;
		constraints?: Readonly<Record<string, ConstraintDefinition>>;
		indexes?: Readonly<Record<string, IndexDefinition>>;
	}>,
): CollectionAugmentation<Name, Fields> {
	return Object.freeze({
		__questpie: Object.freeze({
			category: "augmentation",
			resourceKind: "collection",
		}),
		name: input.name,
		fields: input.fields ?? ({} as Fields),
		constraints: input.constraints ?? {},
		indexes: input.indexes ?? {},
	});
}

export function defineCollection<
	const Name extends string,
	const Fields extends Readonly<Record<string, FieldDefinition>>,
>(
	input: Readonly<{
		name: Name;
		fields: Fields;
		constraints: Readonly<Record<string, ConstraintDefinition>>;
		indexes?: Readonly<Record<string, IndexDefinition>>;
		relations?: Readonly<Record<string, RelationDefinition>>;
		augmentations?: readonly CollectionAugmentation[];
		postgres?: Readonly<{ name: string }>;
	}>,
): CollectionDefinition<Name, Fields> {
	return Object.freeze({
		__questpie: Object.freeze({
			category: "definition",
			resourceKind: "collection",
		}),
		name: input.name,
		fields: input.fields,
		constraints: input.constraints,
		indexes: input.indexes ?? {},
		relations: input.relations ?? {},
		augmentations: input.augmentations ?? [],
		postgresName: input.postgres?.name ?? null,
	});
}
