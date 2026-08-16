import type { CollectionDefinition } from "./collection-contract";
import type { FieldDefinition } from "./field-contract";
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

type CollectionPolicy<Collection> = Readonly<{
	kind: "policy";
	identity: `policy:${string}`;
	target: `collection:${CollectionName<Collection>}`;
}>;

type FieldValue<Node> =
	Node extends FieldDefinition<infer Value, infer Nullable>
		? Value | (Nullable extends true ? null : never)
		: Node extends InlineShapeDefinition<infer Fields>
			? Readonly<{ [Key in keyof Fields]: FieldValue<Fields[Key]> }>
			: never;

type FieldName<Fields> = Extract<keyof Fields, string>;

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

type WriteMember<Fields, Optional extends boolean> = Readonly<{
	input: readonly FieldName<Fields>[];
	normalize?: (
		scope: Readonly<{ input: FieldOperands<Fields, Optional> }>,
	) => NormalizedFields<Fields, Optional>;
	values?: (scope: ValueProgramScope<Fields, Optional>) => ServerValues<Fields>;
	select: CollectionOperationSelection<Fields>;
}>;

export interface CollectionOperationSetBody<
	Collection extends CollectionDefinition,
> {
	readonly name: string;
	readonly policy: CollectionPolicy<Collection>;
	readonly network?: boolean;
	readonly list?: Readonly<{ data: Readonly<{ kind: "dataQuery" }> }>;
	readonly get?: Readonly<{
		select: CollectionOperationSelection<CollectionFields<Collection>>;
	}>;
	readonly create?: WriteMember<CollectionFields<Collection>, false>;
	readonly update?: WriteMember<CollectionFields<Collection>, true>;
	readonly delete?: Readonly<{
		select: CollectionOperationSelection<CollectionFields<Collection>>;
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
