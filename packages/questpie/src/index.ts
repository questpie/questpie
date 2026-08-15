import {
	type CheckConstraintDefinition,
	createCheckConstraint,
} from "./check-expression";
import type {
	PrimaryKeyReferences,
	SeedInsertValues,
	SeedInsertWithoutKeys,
	SeedPartialValues,
	SeedPartialWithoutKeys,
	SeedPrimaryKey,
} from "./seed-types";
import type { FieldNode, InlineShapeDefinition } from "./shape";
import {
	type TaggedJsonValue,
	type ValueDefinition,
	type ValueOf,
} from "./value";

export { shape } from "./shape";
export type { FieldNode, InlineShapeDefinition } from "./shape";
export { value } from "./value";
export type { JsonValue, TaggedJsonValue, ValueDefinition } from "./value";

export type CodecKind = "boolean" | "integer" | "object" | "text" | "uuid";

export interface Codec<Value, Kind extends CodecKind = CodecKind> {
	readonly kind: Kind;
	readonly value?: Value;
}

export type CodecValue<ValueCodec> =
	ValueCodec extends Codec<infer Value> ? Value : never;

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

type ScalarOptions = Readonly<{ nullable?: boolean }>;
type FieldBaseOptions = Readonly<{
	nullable: boolean;
	postgres?: Readonly<{ name: string }>;
}>;

type FieldDefault = "now" | "randomUuid" | boolean | number | string;

type ExactOptions<Options, Shape> = Options &
	Readonly<Record<Exclude<keyof Options, keyof Shape>, never>>;

type BigintFieldOptions = FieldBaseOptions &
	Readonly<{ minimum?: string; maximum?: string }>;
type NumericFieldOptions = FieldBaseOptions &
	Readonly<{ precision: number; scale: number }>;

type FieldRuntimeOptions = FieldBaseOptions &
	Readonly<{
		default?: FieldDefault;
		minLength?: number;
		maxLength?: number;
		minimum?: number | string;
		maximum?: number | string;
		precision?: number;
		properties?: Readonly<Record<string, ValueDefinition>>;
		items?: ValueDefinition;
		maximumItems?: number;
		scale?: number;
		withTimezone?: boolean;
	}>;

type FieldValue = object | string | number | boolean | null;

type FieldScalar =
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

function fieldDefinition<
	const Scalar extends FieldScalar,
	Value,
	const Options extends FieldRuntimeOptions,
>(
	scalar: Scalar,
	options: Options,
): FieldDefinition<
	Value,
	Options["nullable"],
	Options extends { default: infer Default extends FieldDefault }
		? Default
		: null,
	Scalar
> {
	const {
		nullable,
		default: defaultValue = null,
		postgres,
		...scalarOptions
	} = options;
	return Object.freeze({
		kind: "field",
		scalar,
		nullable,
		default: defaultValue,
		postgresName: postgres?.name ?? null,
		options: Object.freeze(scalarOptions),
	}) as FieldDefinition<
		Value,
		Options["nullable"],
		Options extends { default: infer Default extends FieldDefault }
			? Default
			: null,
		Scalar
	>;
}

export const field = Object.freeze({
	uuid: <
		const Options extends FieldBaseOptions &
			Readonly<{ default?: "randomUuid" }>,
	>(
		options: ExactOptions<
			Options,
			FieldBaseOptions & Readonly<{ default?: "randomUuid" }>
		>,
	) => fieldDefinition<"uuid", string, Options>("uuid", options),
	text: <
		const Options extends FieldBaseOptions &
			Readonly<{
				minLength?: number;
				maxLength?: number;
				default?: string;
			}>,
	>(
		options: ExactOptions<
			Options,
			FieldBaseOptions &
				Readonly<{
					minLength?: number;
					maxLength?: number;
					default?: string;
				}>
		>,
	) => fieldDefinition<"text", string, Options>("text", options),
	boolean: <
		const Options extends FieldBaseOptions & Readonly<{ default?: boolean }>,
	>(
		options: ExactOptions<
			Options,
			FieldBaseOptions & Readonly<{ default?: boolean }>
		>,
	) => fieldDefinition<"boolean", boolean, Options>("boolean", options),
	integer: <
		const Options extends FieldBaseOptions &
			Readonly<{
				minimum?: number;
				maximum?: number;
				default?: number;
			}>,
	>(
		options: ExactOptions<
			Options,
			FieldBaseOptions &
				Readonly<{
					minimum?: number;
					maximum?: number;
					default?: number;
				}>
		>,
	) => fieldDefinition<"integer", number, Options>("integer", options),
	bigint: <const Options extends BigintFieldOptions>(
		options: ExactOptions<Options, BigintFieldOptions>,
	) => fieldDefinition<"bigint", string, Options>("bigint", options),
	numeric: <const Options extends NumericFieldOptions>(
		options: ExactOptions<Options, NumericFieldOptions>,
	) => fieldDefinition<"numeric", string, Options>("numeric", options),
	timestamp: <
		const Options extends FieldBaseOptions &
			Readonly<{ default?: "now"; withTimezone?: boolean }>,
	>(
		options: ExactOptions<
			Options,
			FieldBaseOptions & Readonly<{ default?: "now"; withTimezone?: boolean }>
		>,
	) => fieldDefinition<"timestamp", string, Options>("timestamp", options),
	date: <const Options extends FieldBaseOptions>(
		options: ExactOptions<Options, FieldBaseOptions>,
	) => fieldDefinition<"date", string, Options>("date", options),
	object: <
		const Options extends FieldBaseOptions &
			Readonly<{
				properties: Readonly<Record<string, ValueDefinition>>;
			}>,
	>(
		options: ExactOptions<
			Options,
			FieldBaseOptions &
				Readonly<{
					properties: Readonly<Record<string, ValueDefinition>>;
				}>
		>,
	) =>
		fieldDefinition<
			"object",
			Readonly<{
				[Key in keyof Options["properties"]]: ValueOf<
					Options["properties"][Key]
				>;
			}>,
			Options
		>("object", options),
	array: <
		const Options extends FieldBaseOptions &
			Readonly<{ items: ValueDefinition; maximumItems: number }>,
	>(
		options: ExactOptions<
			Options,
			FieldBaseOptions &
				Readonly<{ items: ValueDefinition; maximumItems: number }>
		>,
	) =>
		fieldDefinition<"array", readonly ValueOf<Options["items"]>[], Options>(
			"array",
			options,
		),
	json: <const Options extends FieldBaseOptions>(
		options: ExactOptions<Options, FieldBaseOptions>,
	) => fieldDefinition<"json", TaggedJsonValue, Options>("json", options),
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

export type FieldReference = string | readonly [string, ...string[]];

export interface ConstraintDefinition<
	Fields extends readonly FieldReference[] = readonly never[],
	Kind extends "primaryKey" | "unique" = "primaryKey" | "unique",
> {
	readonly kind: Kind;
	readonly fields: Fields;
	readonly postgresName: string | null;
}

type ConstraintMemberDefinition =
	| ConstraintDefinition<readonly FieldReference[]>
	| CheckConstraintDefinition;

function frozenTuple<const Values extends readonly unknown[]>(
	values: Values,
): Values {
	return Object.freeze(
		values.map((value) =>
			Array.isArray(value) ? Object.freeze([...value]) : value,
		),
	) as unknown as Values;
}

export const constraint = Object.freeze({
	primaryKey: <const Fields extends readonly FieldReference[]>(
		input: Readonly<{ fields: Fields; postgres?: { name: string } }>,
	): ConstraintDefinition<Fields, "primaryKey"> =>
		Object.freeze({
			kind: "primaryKey",
			fields: frozenTuple(input.fields),
			postgresName: input.postgres?.name ?? null,
		}),
	unique: <const Fields extends readonly FieldReference[]>(
		input: Readonly<{ fields: Fields; postgres?: { name: string } }>,
	): ConstraintDefinition<Fields, "unique"> =>
		Object.freeze({
			kind: "unique",
			fields: frozenTuple(input.fields),
			postgresName: input.postgres?.name ?? null,
		}),
	check: createCheckConstraint,
});

export type IndexField =
	| FieldReference
	| Readonly<{
			field: FieldReference;
			order?: "asc" | "desc";
			nulls?: "first" | "last";
	  }>;

export interface IndexDefinition<
	Fields extends readonly IndexField[] = readonly never[],
> {
	readonly kind: "btree";
	readonly fields: Fields;
	readonly postgresName: string | null;
}

export function index<const Fields extends readonly IndexField[]>(
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
	Fields extends readonly FieldReference[] = readonly FieldReference[],
	References extends readonly FieldReference[] = readonly FieldReference[],
> {
	readonly kind: "toOne";
	readonly target: Target;
	readonly fields: Fields;
	readonly references: References;
	readonly onDelete: "restrict" | "cascade" | "setNull" | "noAction";
	readonly onUpdate: "restrict" | "cascade" | "setNull" | "noAction";
	readonly postgresName: string | null;
}

export type RelationReference<
	Name extends string = string,
	Member extends string = string,
> = `collection:${Name}/relation:${Member}`;

export interface InverseRelationDefinition<
	InverseOf extends RelationReference = RelationReference,
> {
	readonly kind: "toMany";
	readonly inverseOf: InverseOf;
}

export function relationRef<
	const Name extends string,
	const Member extends string,
>(name: Name, member: Member): RelationReference<Name, Member>;
export function relationRef(name: string, member: string): string {
	return `collection:${name}/relation:${member}`;
}

export const relation = Object.freeze({
	toOne: <
		const TargetName extends string,
		const TargetFields extends Readonly<Record<string, FieldNode>>,
		const Fields extends readonly FieldReference[],
		const References extends readonly FieldReferences<TargetFields>[],
	>(
		input: Readonly<{
			target: CollectionDefinition<TargetName, TargetFields>;
			fields: Fields;
			references: References;
			onDelete?: RelationDefinition["onDelete"];
			onUpdate?: RelationDefinition["onUpdate"];
			postgres?: { name: string };
		}>,
	): RelationDefinition<`collection:${TargetName}`, Fields, References> =>
		Object.freeze({
			kind: "toOne",
			target: collectionIdentity(input.target),
			fields: frozenTuple(input.fields),
			references: frozenTuple(input.references),
			onDelete: input.onDelete ?? "restrict",
			onUpdate: input.onUpdate ?? "restrict",
			postgresName: input.postgres?.name ?? null,
		}),
	toMany: <const InverseOf extends RelationReference>(
		input: Readonly<{ inverseOf: InverseOf }>,
	): InverseRelationDefinition<InverseOf> =>
		Object.freeze({ ...input, kind: "toMany", inverseOf: input.inverseOf }),
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
	Fields extends Readonly<Record<string, FieldNode>> = Readonly<
		Record<never, never>
	>,
	Constraints extends Readonly<Record<string, ConstraintMemberDefinition>> =
		Readonly<Record<never, never>>,
	Indexes extends Readonly<
		Record<string, { readonly fields: readonly IndexField[] }>
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
	Fields extends Readonly<Record<string, FieldNode>> = Readonly<
		Record<never, never>
	>,
	Constraints extends Readonly<Record<string, ConstraintMemberDefinition>> =
		Readonly<Record<never, never>>,
	Indexes extends Readonly<
		Record<string, { readonly fields: readonly IndexField[] }>
	> = Readonly<Record<never, never>>,
	Relations extends Readonly<
		Record<string, RelationDefinition | InverseRelationDefinition>
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
	Fields extends Readonly<Record<string, FieldNode>>,
	Members extends Readonly<Record<string, unknown>>,
> = {
	readonly [Key in keyof Members]: Members[Key] extends Readonly<{
		fields: infer References extends readonly unknown[];
	}>
		? Exclude<
				MemberFieldReference<References[number]>,
				FieldReferences<Fields>
			> extends never
			? Members[Key]
			: never
		: Members[Key];
};

type ValidateRelationFieldReferences<
	Fields extends Readonly<Record<string, FieldNode>>,
	Members extends Readonly<
		Record<string, RelationDefinition | InverseRelationDefinition>
	>,
> = {
	readonly [Key in keyof Members]: Members[Key] extends RelationDefinition
		? Exclude<
				MemberFieldReference<Members[Key]["fields"][number]>,
				FieldReferences<Fields>
			> extends never
			? Members[Key]
			: never
		: Members[Key];
};

type MemberFieldReference<Value> =
	Value extends Readonly<{
		field: infer Reference;
	}>
		? Reference
		: Value;

type NestedFieldSegments<Fields extends Readonly<Record<string, FieldNode>>> = {
	[Key in Extract<keyof Fields, string>]: Fields[Key] extends FieldDefinition
		? readonly [Key]
		: Fields[Key] extends InlineShapeDefinition<infer Children>
			? readonly [Key, ...NestedFieldSegments<Children>]
			: never;
}[Extract<keyof Fields, string>];

type FieldReferences<Fields extends Readonly<Record<string, FieldNode>>> = {
	[Key in Extract<keyof Fields, string>]: Fields[Key] extends FieldDefinition
		? Key
		: Fields[Key] extends InlineShapeDefinition<infer Children>
			? readonly [Key, ...NestedFieldSegments<Children>]
			: never;
}[Extract<keyof Fields, string>];

export function defineCollectionAugmentation<
	const Name extends string,
	const Fields extends Readonly<Record<string, FieldNode>>,
	const Constraints extends Readonly<
		Record<string, ConstraintMemberDefinition>
	>,
	const Indexes extends Readonly<
		Record<string, { readonly fields: readonly IndexField[] }>
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
	const Fields extends Readonly<Record<string, FieldNode>>,
	const Constraints extends Readonly<
		Record<string, ConstraintMemberDefinition>
	>,
	const Indexes extends Readonly<
		Record<string, { readonly fields: readonly IndexField[] }>
	>,
	const Relations extends Readonly<
		Record<string, RelationDefinition | InverseRelationDefinition>
	>,
>(
	input: Readonly<{
		name: Name;
		fields: Fields;
		constraints: Constraints & ValidateFieldReferences<Fields, Constraints>;
		indexes?: Indexes & ValidateFieldReferences<Fields, Indexes>;
		relations?: Relations & ValidateRelationFieldReferences<Fields, Relations>;
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
		const Fields extends Readonly<Record<string, FieldNode>>,
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
		const Fields extends Readonly<Record<string, FieldNode>>,
		const Constraints extends Readonly<
			Record<string, ConstraintMemberDefinition>
		>,
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
		const Fields extends Readonly<Record<string, FieldNode>>,
		const Constraints extends Readonly<
			Record<string, ConstraintMemberDefinition>
		>,
	>(
		collection: CollectionDefinition<Name, Fields, Constraints>,
		input: Readonly<{
			key: SeedPrimaryKey<Fields, Constraints>;
			create: SeedInsertWithoutKeys<Fields, PrimaryKeyReferences<Constraints>>;
			update: SeedPartialWithoutKeys<Fields, PrimaryKeyReferences<Constraints>>;
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
		const Fields extends Readonly<Record<string, FieldNode>>,
		const Constraints extends Readonly<
			Record<string, ConstraintMemberDefinition>
		>,
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
