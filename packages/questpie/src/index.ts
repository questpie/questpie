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

export interface ConstraintDefinition<
	Fields extends readonly string[] = readonly never[],
> {
	readonly kind: "primaryKey" | "unique";
	readonly fields: Fields;
	readonly postgresName: string | null;
}

function frozenTuple<const Values extends readonly string[]>(
	values: Values,
): Values {
	return Object.freeze([...values]) as unknown as Values;
}

export const constraint = Object.freeze({
	primaryKey: <const Fields extends readonly string[]>(
		input: Readonly<{ fields: Fields; postgres?: { name: string } }>,
	): ConstraintDefinition<Fields> =>
		Object.freeze({
			kind: "primaryKey",
			fields: frozenTuple(input.fields),
			postgresName: input.postgres?.name ?? null,
		}),
	unique: <const Fields extends readonly string[]>(
		input: Readonly<{ fields: Fields; postgres?: { name: string } }>,
	): ConstraintDefinition<Fields> =>
		Object.freeze({
			kind: "unique",
			fields: frozenTuple(input.fields),
			postgresName: input.postgres?.name ?? null,
		}),
});

export interface IndexDefinition<
	Fields extends readonly string[] = readonly never[],
> {
	readonly kind: "btree";
	readonly fields: Fields;
	readonly postgresName: string | null;
}

export function index<const Fields extends readonly string[]>(
	input: Readonly<{ fields: Fields; postgres?: { name: string } }>,
): IndexDefinition<Fields> {
	return Object.freeze({
		kind: "btree",
		fields: frozenTuple(input.fields),
		postgresName: input.postgres?.name ?? null,
	});
}

export interface RelationDefinition<
	Target extends `collection:${string}` = `collection:${string}`,
	Fields extends readonly string[] = readonly never[],
	References extends readonly string[] = readonly never[],
> {
	readonly kind: "toOne";
	readonly target: Target;
	readonly fields: Fields;
	readonly references: References;
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
	toOne: <
		const Target extends `collection:${string}`,
		const Fields extends readonly string[],
		const References extends readonly string[],
	>(
		input: Readonly<{
			target: Target;
			fields: Fields;
			references: References;
			onDelete?: RelationDefinition["onDelete"];
			onUpdate?: RelationDefinition["onUpdate"];
			postgres?: { name: string };
		}>,
	): RelationDefinition<Target, Fields, References> =>
		Object.freeze({
			kind: "toOne",
			target: input.target,
			fields: frozenTuple(input.fields),
			references: frozenTuple(input.references),
			onDelete: input.onDelete ?? "restrict",
			onUpdate: input.onUpdate ?? "restrict",
			postgresName: input.postgres?.name ?? null,
		}),
});

interface DefinitionBrand {
	readonly category: "definition";
	readonly resourceKind: "collection" | "seed";
}

interface AugmentationBrand {
	readonly category: "augmentation";
	readonly resourceKind: "collection";
}

export interface CollectionAugmentation<
	Name extends string = string,
	Fields extends Readonly<Record<string, FieldDefinition>> = Readonly<
		Record<never, never>
	>,
	Constraints extends Readonly<
		Record<string, { readonly fields: readonly string[] }>
	> = Readonly<Record<never, never>>,
	Indexes extends Readonly<
		Record<string, { readonly fields: readonly string[] }>
	> = Readonly<Record<never, never>>,
> {
	readonly __questpie: AugmentationBrand;
	readonly name: Name;
	readonly fields: Fields;
	readonly constraints: Constraints;
	readonly indexes: Indexes;
}

export interface CollectionDefinition<
	Name extends string = string,
	Fields extends Readonly<Record<string, FieldDefinition>> = Readonly<
		Record<never, never>
	>,
	Constraints extends Readonly<
		Record<string, { readonly fields: readonly string[] }>
	> = Readonly<Record<never, never>>,
	Indexes extends Readonly<
		Record<string, { readonly fields: readonly string[] }>
	> = Readonly<Record<never, never>>,
	Relations extends Readonly<
		Record<string, { readonly fields: readonly string[] }>
	> = Readonly<Record<never, never>>,
> {
	readonly __questpie: DefinitionBrand;
	readonly name: Name;
	readonly fields: Fields;
	readonly constraints: Constraints;
	readonly indexes: Indexes;
	readonly relations: Relations;
	readonly augmentations: readonly CollectionAugmentation[];
	readonly postgresName: string | null;
}

type ValidateFieldReferences<
	Fields extends Readonly<Record<string, FieldDefinition>>,
	Members extends Readonly<
		Record<string, { readonly fields: readonly string[] }>
	>,
> = {
	readonly [Key in keyof Members]: Exclude<
		Members[Key]["fields"][number],
		Extract<keyof Fields, string>
	> extends never
		? Members[Key]
		: never;
};

export function defineCollectionAugmentation<
	const Name extends string,
	const Fields extends Readonly<Record<string, FieldDefinition>>,
	const Constraints extends Readonly<
		Record<string, { readonly fields: readonly string[] }>
	>,
	const Indexes extends Readonly<
		Record<string, { readonly fields: readonly string[] }>
	>,
>(
	input: Readonly<{
		name: Name;
		fields?: Fields;
		constraints?: Constraints & ValidateFieldReferences<Fields, Constraints>;
		indexes?: Indexes & ValidateFieldReferences<Fields, Indexes>;
	}>,
): CollectionAugmentation<Name, Fields, Constraints, Indexes> {
	return Object.freeze({
		__questpie: Object.freeze({
			category: "augmentation",
			resourceKind: "collection",
		}),
		name: input.name,
		fields: input.fields ?? ({} as Fields),
		constraints: input.constraints ?? ({} as Constraints),
		indexes: input.indexes ?? ({} as Indexes),
	});
}

export function defineCollection<
	const Name extends string,
	const Fields extends Readonly<Record<string, FieldDefinition>>,
	const Constraints extends Readonly<
		Record<string, { readonly fields: readonly string[] }>
	>,
	const Indexes extends Readonly<
		Record<string, { readonly fields: readonly string[] }>
	>,
	const Relations extends Readonly<
		Record<string, { readonly fields: readonly string[] }>
	>,
>(
	input: Readonly<{
		name: Name;
		fields: Fields;
		constraints: Constraints & ValidateFieldReferences<Fields, Constraints>;
		indexes?: Indexes & ValidateFieldReferences<Fields, Indexes>;
		relations?: Relations & ValidateFieldReferences<Fields, Relations>;
		augmentations?: readonly CollectionAugmentation[];
		postgres?: Readonly<{ name: string }>;
	}>,
): CollectionDefinition<Name, Fields, Constraints, Indexes, Relations> {
	return Object.freeze({
		__questpie: Object.freeze({
			category: "definition",
			resourceKind: "collection",
		}),
		name: input.name,
		fields: input.fields,
		constraints: input.constraints,
		indexes: input.indexes ?? ({} as Indexes),
		relations: input.relations ?? ({} as Relations),
		augmentations: input.augmentations ?? [],
		postgresName: input.postgres?.name ?? null,
	});
}

type SeedValueForField<Field> =
	Field extends FieldDefinition<infer Value>
		? Value extends Date
			? Value | string
			: Value
		: never;

type SeedValues<Fields extends Readonly<Record<string, FieldDefinition>>> =
	Readonly<{
		[Key in keyof Fields]?: SeedValueForField<Fields[Key]> | null;
	}>;

export interface SeedStepDefinition {
	readonly kind: "insert" | "update" | "upsert" | "delete";
	readonly collection: `collection:${string}`;
	readonly values?: Readonly<Record<string, unknown>>;
	readonly key?: Readonly<Record<string, unknown>>;
	readonly create?: Readonly<Record<string, unknown>>;
	readonly update?: Readonly<Record<string, unknown>>;
}

export interface SeedDefinition<Name extends string = string> {
	readonly __questpie: Readonly<{
		category: "definition";
		resourceKind: "seed";
	}>;
	readonly name: Name;
	readonly dependsOn: readonly string[];
	readonly steps: readonly SeedStepDefinition[];
}

function collectionIdentity(
	collection: CollectionDefinition,
): `collection:${string}` {
	return `collection:${collection.name}`;
}

export const seed = Object.freeze({
	insert: <const Fields extends Readonly<Record<string, FieldDefinition>>>(
		collection: CollectionDefinition<string, Fields>,
		values: SeedValues<Fields>,
	): SeedStepDefinition =>
		Object.freeze({
			kind: "insert",
			collection: collectionIdentity(collection),
			values: Object.freeze({ ...values }),
		}),
	update: <const Fields extends Readonly<Record<string, FieldDefinition>>>(
		collection: CollectionDefinition<string, Fields>,
		input: Readonly<{ key: SeedValues<Fields>; values: SeedValues<Fields> }>,
	): SeedStepDefinition =>
		Object.freeze({
			kind: "update",
			collection: collectionIdentity(collection),
			key: Object.freeze({ ...input.key }),
			values: Object.freeze({ ...input.values }),
		}),
	upsert: <const Fields extends Readonly<Record<string, FieldDefinition>>>(
		collection: CollectionDefinition<string, Fields>,
		input: Readonly<{
			key: SeedValues<Fields>;
			create: SeedValues<Fields>;
			update: SeedValues<Fields>;
		}>,
	): SeedStepDefinition =>
		Object.freeze({
			kind: "upsert",
			collection: collectionIdentity(collection),
			key: Object.freeze({ ...input.key }),
			create: Object.freeze({ ...input.create }),
			update: Object.freeze({ ...input.update }),
		}),
	delete: <const Fields extends Readonly<Record<string, FieldDefinition>>>(
		collection: CollectionDefinition<string, Fields>,
		key: SeedValues<Fields>,
	): SeedStepDefinition =>
		Object.freeze({
			kind: "delete",
			collection: collectionIdentity(collection),
			key: Object.freeze({ ...key }),
		}),
});

export function defineSeed<
	const Name extends string,
	const Dependencies extends readonly string[],
	const Steps extends readonly SeedStepDefinition[],
>(
	input: Readonly<{
		name: Name;
		dependsOn?: Dependencies;
		steps: Steps;
	}>,
): SeedDefinition<Name> {
	return Object.freeze({
		__questpie: Object.freeze({
			category: "definition",
			resourceKind: "seed",
		}),
		name: input.name,
		dependsOn: Object.freeze([...(input.dependsOn ?? [])]),
		steps: Object.freeze([...input.steps]),
	});
}
