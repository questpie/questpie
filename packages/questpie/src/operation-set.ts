import type { CollectionDefinition } from "./collection-contract";
import type { CollectionRowFor, FieldOperationValue } from "./collection-input";
import type { FieldDefinition } from "./field-contract";
import type { OperationErrorMap } from "./operation";
import type { OperationDescription } from "./operation-documentation";
import type { InlineShapeDefinition } from "./shape";

type CollectionFields<Collection> =
	Collection extends CollectionDefinition<
		string,
		infer Fields,
		infer _Constraints,
		infer _Indexes,
		infer _Relations
	>
		? Fields
		: never;

type CollectionName<Collection> =
	Collection extends CollectionDefinition<infer Name> ? Name : never;

type CollectionIssues<Collection> =
	Collection extends CollectionDefinition<
		string,
		infer _Fields,
		infer _Constraints,
		infer _Indexes,
		infer _Relations,
		infer Issues
	>
		? Issues
		: never;

type CollectionPolicy<Collection> = Readonly<{
	kind: "policy";
	identity: `policy:${string}`;
	target: `collection:${CollectionName<Collection>}`;
}>;

type FieldValue<Node> = Node extends FieldDefinition
	? FieldOperationValue<Node>
	: Node extends InlineShapeDefinition<infer Fields>
		? Readonly<{ [Key in keyof Fields]: FieldValue<Fields[Key]> }>
		: never;

type FieldName<Fields> = Extract<keyof Fields, string>;

type CollectionConstraints<Collection> =
	Collection extends CollectionDefinition<
		string,
		infer _Fields,
		infer Constraints
	>
		? Constraints
		: never;

type PrimaryFieldReferences<Collection> = {
	[Key in keyof CollectionConstraints<Collection>]: CollectionConstraints<Collection>[Key] extends Readonly<{
		kind: "primaryKey";
		fields: infer Fields extends readonly unknown[];
	}>
		? Fields[number]
		: never;
}[keyof CollectionConstraints<Collection>];

type PathObject<Fields, Path> = Path extends keyof Fields
	? Readonly<{ [Key in Path]: FieldValue<Fields[Key]> }>
	: Path extends readonly [infer Head extends keyof Fields, ...infer Tail]
		? Tail extends readonly []
			? Readonly<{ [Key in Head]: FieldValue<Fields[Key]> }>
			: Fields[Head] extends InlineShapeDefinition<infer Children>
				? Readonly<{ [Key in Head]: PathObject<Children, Tail> }>
				: never
		: never;

type UnionToIntersection<Value> = (
	Value extends unknown ? (input: Value) => void : never
) extends (input: infer Intersection) => void
	? Intersection
	: never;

type PrimaryKeyValue<Collection> = Readonly<
	UnionToIntersection<
		PrimaryFieldReferences<Collection> extends infer Reference
			? Reference extends unknown
				? PathObject<CollectionFields<Collection>, Reference>
				: never
			: never
	>
>;

type SelectedValue<Fields, Selection> = Readonly<{
	[Key in keyof Selection & keyof Fields]: Selection[Key] extends true
		? FieldValue<Fields[Key]>
		: Fields[Key] extends InlineShapeDefinition<infer Children>
			? SelectedValue<Children, Selection[Key]>
			: never;
}>;

type RequiredCreateFieldNames<Fields> = {
	[Key in keyof Fields]: Fields[Key] extends FieldDefinition<
		unknown,
		false,
		null
	>
		? Key
		: never;
}[keyof Fields];

type OperationInputShape<Fields, Names, RequiredNames> = Readonly<
	{
		[Key in Extract<Names, keyof Fields> as Key extends RequiredNames
			? Key
			: never]: FieldValue<Fields[Key]>;
	} & {
		[Key in Extract<Names, keyof Fields> as Key extends RequiredNames
			? never
			: Key]?: FieldValue<Fields[Key]>;
	}
>;

type AuthoredInputNames<Definition> =
	Definition extends Readonly<{ input: readonly (infer Name)[] }>
		? Name
		: never;

type StaticValueNames<Definition> =
	Definition extends Readonly<{
		values: (...input: never[]) => infer Values;
	}>
		? keyof Values
		: never;

type TrustedFieldNames<Fields, Member> = {
	[Key in keyof Fields]: Fields[Key] extends FieldDefinition<
		unknown,
		boolean,
		FieldDefinition["default"],
		FieldDefinition["scalar"],
		infer Immutable,
		boolean,
		Readonly<Record<string, unknown>>,
		infer OnUpdate
	>
		? OnUpdate extends "now"
			? never
			: Member extends "update"
				? Immutable extends true | "database"
					? never
					: Key
				: Key
		: Key;
}[keyof Fields];

type TrustedValuesInput<Fields, Definition, Member> = OperationInputShape<
	Fields,
	Exclude<TrustedFieldNames<Fields, Member>, StaticValueNames<Definition>>,
	Member extends "create"
		? Exclude<
				RequiredCreateFieldNames<Fields>,
				AuthoredInputNames<Definition> | StaticValueNames<Definition>
			>
		: never
>;

type TrustedValuesMember<Fields, Definition, Member> = keyof TrustedValuesInput<
	Fields,
	Definition,
	Member
> extends never
	? Readonly<Record<never, never>>
	: Member extends "create"
		? Exclude<
				RequiredCreateFieldNames<Fields>,
				AuthoredInputNames<Definition> | StaticValueNames<Definition>
			> extends never
			? Readonly<{
					values?: TrustedValuesInput<Fields, Definition, Member>;
				}>
			: Readonly<{
					values: TrustedValuesInput<Fields, Definition, Member>;
				}>
		: Readonly<{ values?: TrustedValuesInput<Fields, Definition, Member> }>;

type CollectionOperationDescription<
	Collection extends CollectionDefinition,
	Member extends "list" | "get" | "create" | "update" | "delete",
	Definition,
> = Member extends "list"
	? Definition extends Readonly<{
			data: Readonly<{ parameters: infer Input; result: infer Output }>;
		}>
		? OperationDescription<Input, Output>
		: OperationDescription<never, never>
	: Definition extends Readonly<{ select: infer Selection }>
		? OperationDescription<
				Member extends "get" | "delete"
					? Readonly<{ key: PrimaryKeyValue<Collection> }>
					: Member extends "create"
						? Readonly<{
								input: OperationInputShape<
									CollectionFields<Collection>,
									AuthoredInputNames<Definition>,
									RequiredCreateFieldNames<CollectionFields<Collection>>
								>;
							}> &
								TrustedValuesMember<
									CollectionFields<Collection>,
									Definition,
									Member
								>
						: Readonly<{
								key: PrimaryKeyValue<Collection>;
								expected?: Partial<
									CollectionRowFor<CollectionFields<Collection>>
								>;
								patch?: OperationInputShape<
									CollectionFields<Collection>,
									AuthoredInputNames<Definition>,
									never
								>;
							}> &
								TrustedValuesMember<
									CollectionFields<Collection>,
									Definition,
									Member
								>,
				Member extends "create"
					? SelectedValue<CollectionFields<Collection>, Selection>
					: SelectedValue<CollectionFields<Collection>, Selection> | null
			>
		: OperationDescription<never, never>;

type CollectionOperationDescriptions<
	Collection extends CollectionDefinition,
	Body,
> = Readonly<{
	[Member in
		| "list"
		| "get"
		| "create"
		| "update"
		| "delete"]?: Member extends keyof Body
		? Body[Member] &
				Readonly<{
					describe?: CollectionOperationDescription<
						Collection,
						Member,
						Body[Member]
					>;
				}> &
				Readonly<
					Record<
						Exclude<
							keyof Body[Member],
							keyof NonNullable<CollectionOperationSetBody<Collection>[Member]>
						>,
						never
					>
				>
		: never;
}>;

export interface ValueProgramOperand<Value> {
	readonly kind: "valueOperand";
	readonly value?: Value;
}

export interface NormalizedValue<Value> {
	readonly kind: "normalizedValue";
	readonly value?: Value;
}

export interface ServerValue<Value> {
	readonly kind: "overwrite";
	readonly value: ValueProgramOperand<Value>;
}

type FieldOperands<Fields, Optional extends boolean> = Readonly<{
	[Key in keyof Fields]: ValueProgramOperand<
		FieldValue<Fields[Key]> | (Optional extends true ? undefined : never)
	>;
}>;

type NormalizedFields<Fields, Optional extends boolean> = Readonly<
	Partial<{
		[Key in keyof Fields]:
			| ValueProgramOperand<
					FieldValue<Fields[Key]> | (Optional extends true ? undefined : never)
			  >
			| NormalizedValue<
					FieldValue<Fields[Key]> | (Optional extends true ? undefined : never)
			  >;
	}>
>;

type ServerFieldValue<Node> =
	Node extends FieldDefinition<
		infer Value,
		infer Nullable,
		infer _Default,
		infer Scalar
	>
		?
				| Value
				| (Nullable extends true ? null : never)
				| (Scalar extends "timestamp" ? Date : never)
		: FieldValue<Node>;

type ServerValues<Fields> = Readonly<
	Partial<{
		[Key in keyof Fields]: ServerValue<ServerFieldValue<Fields[Key]>>;
	}>
>;

type ValueProgramScope<Fields, Optional extends boolean> = Readonly<{
	input: FieldOperands<Fields, Optional>;
	principal: Readonly<{
		id: ValueProgramOperand<string>;
		kind: ValueProgramOperand<"anonymous" | "service" | "user">;
	}>;
	tenant: Readonly<{ id: ValueProgramOperand<string> }>;
	operationTime: ValueProgramOperand<Date>;
}>;

export type CollectionOperationSelection<Fields> = Readonly<{
	[Key in keyof Fields]?: Fields[Key] extends FieldDefinition
		? true
		: Fields[Key] extends InlineShapeDefinition<infer Children>
			? CollectionOperationSelection<Children>
			: never;
}>;

type WriteMember<
	Fields,
	Optional extends boolean,
	Collection extends CollectionDefinition,
> = Readonly<{
	input: readonly FieldName<Fields>[];
	normalize?: (
		scope: Readonly<{ input: FieldOperands<Fields, Optional> }>,
	) => NormalizedFields<Fields, Optional>;
	values?: (scope: ValueProgramScope<Fields, Optional>) => ServerValues<Fields>;
	errors?: OperationErrorMap;
	issueMappings?: Readonly<{
		[Name in CollectionName<Collection>]?: Readonly<
			Partial<
				Record<Extract<keyof CollectionIssues<Collection>, string>, string>
			>
		>;
	}>;
	select: CollectionOperationSelection<Fields>;
	describe?: OperationDescription<unknown, unknown>;
}>;

export interface CollectionOperationSetBody<
	Collection extends CollectionDefinition,
> {
	readonly name: string;
	readonly policy: CollectionPolicy<Collection>;
	readonly network?: boolean;
	readonly list?: Readonly<{
		data: Readonly<{ kind: "dataQuery" }>;
		describe?: OperationDescription<unknown, unknown>;
	}>;
	readonly get?: Readonly<{
		select: CollectionOperationSelection<CollectionFields<Collection>>;
		describe?: OperationDescription<unknown, unknown>;
	}>;
	readonly create?: WriteMember<
		CollectionFields<Collection>,
		false,
		Collection
	>;
	readonly update?: WriteMember<CollectionFields<Collection>, true, Collection>;
	readonly delete?: Readonly<{
		select: CollectionOperationSelection<CollectionFields<Collection>>;
		describe?: OperationDescription<unknown, unknown>;
	}>;
}

export interface CollectionOperationSetDefinition<
	Collection extends CollectionDefinition = CollectionDefinition,
	Body = CollectionOperationSetBody<Collection>,
> {
	readonly kind: "collectionOperationSet";
	readonly collection: Collection;
	readonly body: Body;
}

export function defineCollectionOperations<
	const Collection extends CollectionDefinition,
	const Body extends CollectionOperationSetBody<NoInfer<Collection>>,
>(
	collection: Collection,
	body: Body &
		CollectionOperationDescriptions<NoInfer<Collection>, Body> &
		Readonly<
			Record<
				Exclude<
					keyof Body,
					keyof CollectionOperationSetBody<NoInfer<Collection>>
				>,
				never
			>
		>,
): CollectionOperationSetDefinition<Collection, Body> {
	return Object.freeze({
		kind: "collectionOperationSet",
		collection,
		body: Object.freeze({ ...body }),
	});
}

export const mutation = Object.freeze({
	overwrite: <Value>(value: ValueProgramOperand<Value>): ServerValue<Value> =>
		Object.freeze({ kind: "overwrite", value }),
});
