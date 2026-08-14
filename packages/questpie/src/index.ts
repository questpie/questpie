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

export interface FieldDefinition<
	Value = FieldValue,
	Nullable extends boolean = boolean,
	Default extends "now" | "randomUuid" | null = "now" | "randomUuid" | null,
> {
	readonly kind: "field";
	readonly scalar: "boolean" | "integer" | "text" | "timestamp" | "uuid";
	readonly nullable: Nullable;
	readonly default: Default;
	readonly postgresName: string | null;
	readonly options: Readonly<Record<string, boolean | number | string | null>>;
	readonly value?: Value;
}

function fieldDefinition<Value, const Options extends FieldRuntimeOptions>(
	scalar: FieldDefinition["scalar"],
	options: Options,
): FieldDefinition<
	Value,
	Options extends { nullable: true } ? true : false,
	Options extends { default: infer Default extends "now" | "randomUuid" }
		? Default
		: null
> {
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
	}) as FieldDefinition<
		Value,
		Options extends { nullable: true } ? true : false,
		Options extends { default: infer Default extends "now" | "randomUuid" }
			? Default
			: null
	>;
}

export const field = Object.freeze({
	uuid: <
		const Options extends FieldBaseOptions &
			Readonly<{ default?: "randomUuid" }>,
	>(
		options: Options = {} as Options,
	) => fieldDefinition<string, Options>("uuid", options),
	text: <
		const Options extends FieldBaseOptions &
			Readonly<{ minLength?: number; maxLength?: number }>,
	>(
		options: Options = {} as Options,
	) => fieldDefinition<string, Options>("text", options),
	boolean: <const Options extends FieldBaseOptions>(
		options: Options = {} as Options,
	) => fieldDefinition<boolean, Options>("boolean", options),
	integer: <
		const Options extends FieldBaseOptions &
			Readonly<{ minimum?: number; maximum?: number }>,
	>(
		options: Options = {} as Options,
	) => fieldDefinition<number, Options>("integer", options),
	timestamp: <
		const Options extends FieldBaseOptions &
			Readonly<{ default?: "now"; withTimezone?: boolean }>,
	>(
		options: Options = {} as Options,
	) => fieldDefinition<Date, Options>("timestamp", options),
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
	Kind extends "primaryKey" | "unique" = "primaryKey" | "unique",
> {
	readonly kind: Kind;
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
	): ConstraintDefinition<Fields, "primaryKey"> =>
		Object.freeze({
			kind: "primaryKey",
			fields: frozenTuple(input.fields),
			postgresName: input.postgres?.name ?? null,
		}),
	unique: <const Fields extends readonly string[]>(
		input: Readonly<{ fields: Fields; postgres?: { name: string } }>,
	): ConstraintDefinition<Fields, "unique"> =>
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
	Field extends FieldDefinition<infer Value, infer Nullable>
		? Value extends Date
			? Value | string | (Nullable extends true ? null : never)
			: Value | (Nullable extends true ? null : never)
		: never;

type RequiredSeedKeys<
	Fields extends Readonly<Record<string, FieldDefinition>>,
> = {
	[Key in keyof Fields]: Fields[Key] extends FieldDefinition<
		unknown,
		false,
		null
	>
		? Key
		: never;
}[keyof Fields];

type SeedInsertValues<
	Fields extends Readonly<Record<string, FieldDefinition>>,
> = Readonly<
	{ [Key in RequiredSeedKeys<Fields>]: SeedValueForField<Fields[Key]> } & {
		[Key in Exclude<
			keyof Fields,
			RequiredSeedKeys<Fields>
		>]?: SeedValueForField<Fields[Key]>;
	}
>;

type SeedPartialValues<
	Fields extends Readonly<Record<string, FieldDefinition>>,
> = Readonly<{ [Key in keyof Fields]?: SeedValueForField<Fields[Key]> }>;

type PrimaryKeyNames<Constraints> = {
	[Key in keyof Constraints]: Constraints[Key] extends ConstraintDefinition<
		infer Fields,
		"primaryKey"
	>
		? Fields[number]
		: never;
}[keyof Constraints];

type SeedPrimaryKey<
	Fields extends Readonly<Record<string, FieldDefinition>>,
	Constraints,
> = Readonly<{
	[Key in Extract<PrimaryKeyNames<Constraints>, keyof Fields>]-?: Exclude<
		SeedValueForField<Fields[Key]>,
		null
	>;
}>;

export interface SeedStepDefinition<
	Kind extends "insert" | "update" | "upsert" | "delete" =
		| "insert"
		| "update"
		| "upsert"
		| "delete",
	Collection extends `collection:${string}` = `collection:${string}`,
> {
	readonly kind: Kind;
	readonly collection: Collection;
	readonly values?: Readonly<Record<string, unknown>>;
	readonly key?: Readonly<Record<string, unknown>>;
	readonly create?: Readonly<Record<string, unknown>>;
	readonly update?: Readonly<Record<string, unknown>>;
}

export interface SeedDefinition<
	Name extends string = string,
	Dependencies extends readonly string[] = readonly string[],
	Steps extends readonly SeedStepDefinition[] = readonly SeedStepDefinition[],
> {
	readonly __questpie: Readonly<{
		category: "definition";
		resourceKind: "seed";
	}>;
	readonly name: Name;
	readonly dependsOn: Dependencies;
	readonly steps: Steps;
}

function collectionIdentity<const Name extends string>(
	collection: CollectionDefinition<Name>,
): `collection:${Name}` {
	return `collection:${collection.name}`;
}

export const seed = Object.freeze({
	insert: <
		const Name extends string,
		const Fields extends Readonly<Record<string, FieldDefinition>>,
	>(
		collection: CollectionDefinition<Name, Fields>,
		values: SeedInsertValues<Fields>,
	): SeedStepDefinition<"insert", `collection:${Name}`> =>
		Object.freeze({
			kind: "insert",
			collection: collectionIdentity(collection),
			values: Object.freeze({ ...values }),
		}),
	update: <
		const Name extends string,
		const Fields extends Readonly<Record<string, FieldDefinition>>,
		const Constraints extends Readonly<Record<string, ConstraintDefinition>>,
	>(
		collection: CollectionDefinition<Name, Fields, Constraints>,
		input: Readonly<{
			key: SeedPrimaryKey<Fields, Constraints>;
			values: SeedPartialValues<Fields>;
		}>,
	): SeedStepDefinition<"update", `collection:${Name}`> =>
		Object.freeze({
			kind: "update",
			collection: collectionIdentity(collection),
			key: Object.freeze({ ...input.key }),
			values: Object.freeze({ ...input.values }),
		}),
	upsert: <
		const Name extends string,
		const Fields extends Readonly<Record<string, FieldDefinition>>,
		const Constraints extends Readonly<Record<string, ConstraintDefinition>>,
	>(
		collection: CollectionDefinition<Name, Fields, Constraints>,
		input: Readonly<{
			key: SeedPrimaryKey<Fields, Constraints>;
			create: Omit<SeedInsertValues<Fields>, PrimaryKeyNames<Constraints>>;
			update: Omit<SeedPartialValues<Fields>, PrimaryKeyNames<Constraints>>;
		}>,
	): SeedStepDefinition<"upsert", `collection:${Name}`> =>
		Object.freeze({
			kind: "upsert",
			collection: collectionIdentity(collection),
			key: Object.freeze({ ...input.key }),
			create: Object.freeze({ ...input.create }),
			update: Object.freeze({ ...input.update }),
		}),
	delete: <
		const Name extends string,
		const Fields extends Readonly<Record<string, FieldDefinition>>,
		const Constraints extends Readonly<Record<string, ConstraintDefinition>>,
	>(
		collection: CollectionDefinition<Name, Fields, Constraints>,
		key: SeedPrimaryKey<Fields, Constraints>,
	): SeedStepDefinition<"delete", `collection:${Name}`> =>
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
): SeedDefinition<Name, Dependencies, Steps> {
	return Object.freeze({
		__questpie: Object.freeze({
			category: "definition",
			resourceKind: "seed",
		}),
		name: input.name,
		dependsOn: Object.freeze([...(input.dependsOn ?? [])]),
		steps: Object.freeze([...input.steps]),
	}) as unknown as SeedDefinition<Name, Dependencies, Steps>;
}
