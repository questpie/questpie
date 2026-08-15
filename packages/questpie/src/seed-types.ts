import type {
	ConstraintDefinition,
	FieldDefinition,
	FieldReference,
} from "./index";
import type { FieldNode, InlineShapeDefinition } from "./shape";

type SeedValueForField<Field> =
	Field extends FieldDefinition<infer Value, infer Nullable>
		? Value | (Nullable extends true ? null : never)
		: never;

type SeedValueForNode<
	Node,
	Mode extends "insert" | "partial",
> = Node extends FieldDefinition
	? SeedValueForField<Node>
	: Node extends InlineShapeDefinition<infer Children>
		? Mode extends "insert"
			? SeedInsertValues<Children>
			: SeedPartialValues<Children>
		: never;

type RequiredSeedKeys<Fields extends Readonly<Record<string, FieldNode>>> = {
	[Key in keyof Fields]: Fields[Key] extends FieldDefinition<
		unknown,
		false,
		null
	>
		? Key
		: Fields[Key] extends InlineShapeDefinition<infer Children>
			? RequiredSeedKeys<Children> extends never
				? never
				: Key
			: never;
}[keyof Fields];

export type SeedInsertValues<
	Fields extends Readonly<Record<string, FieldNode>>,
> = Readonly<
	{
		[Key in RequiredSeedKeys<Fields>]: SeedValueForNode<Fields[Key], "insert">;
	} & {
		[Key in Exclude<keyof Fields, RequiredSeedKeys<Fields>>]?: SeedValueForNode<
			Fields[Key],
			"insert"
		>;
	}
>;

export type SeedPartialValues<
	Fields extends Readonly<Record<string, FieldNode>>,
> = Readonly<{
	[Key in keyof Fields]?: SeedValueForNode<Fields[Key], "partial">;
}>;

type NestedKeyReferences<
	References,
	Key extends PropertyKey,
> = References extends readonly [
	infer Head extends PropertyKey,
	...infer Tail extends string[],
]
	? Head extends Key
		? Tail extends [infer Leaf extends string]
			? Leaf
			: Tail
		: never
	: never;

type SeedNodeWithoutKeys<
	Node,
	Mode extends "insert" | "partial",
	References,
> = Node extends FieldDefinition
	? SeedValueForField<Node>
	: Node extends InlineShapeDefinition<infer Children>
		? [References] extends [never]
			? SeedValueForNode<Node, Mode>
			: Mode extends "insert"
				? SeedInsertWithoutKeys<Children, References>
				: SeedPartialWithoutKeys<Children, References>
		: never;

type RequiredSeedKeysWithoutKeys<
	Fields extends Readonly<Record<string, FieldNode>>,
	References,
> = {
	[Key in Exclude<
		keyof Fields,
		Extract<References, string>
	>]: Fields[Key] extends FieldDefinition<unknown, false, null>
		? Key
		: Fields[Key] extends InlineShapeDefinition<infer Children>
			? [NestedKeyReferences<References, Key>] extends [never]
				? RequiredSeedKeys<Children> extends never
					? never
					: Key
				: RequiredSeedKeysWithoutKeys<
							Children,
							NestedKeyReferences<References, Key>
					  > extends never
					? never
					: Key
			: never;
}[Exclude<keyof Fields, Extract<References, string>>];

export type SeedInsertWithoutKeys<
	Fields extends Readonly<Record<string, FieldNode>>,
	References,
> = Readonly<
	{
		[Key in RequiredSeedKeysWithoutKeys<
			Fields,
			References
		>]: SeedNodeWithoutKeys<
			Fields[Key],
			"insert",
			NestedKeyReferences<References, Key>
		>;
	} & {
		[Key in Exclude<
			Exclude<keyof Fields, Extract<References, string>>,
			RequiredSeedKeysWithoutKeys<Fields, References>
		>]?: SeedNodeWithoutKeys<
			Fields[Key],
			"insert",
			NestedKeyReferences<References, Key>
		>;
	}
>;

export type SeedPartialWithoutKeys<
	Fields extends Readonly<Record<string, FieldNode>>,
	References,
> = Readonly<{
	[Key in Exclude<
		keyof Fields,
		Extract<References, string>
	>]?: SeedNodeWithoutKeys<
		Fields[Key],
		"partial",
		NestedKeyReferences<References, Key>
	>;
}>;

export type PrimaryKeyReferences<Constraints> = {
	[Key in keyof Constraints]: Constraints[Key] extends ConstraintDefinition<
		infer Fields,
		"primaryKey"
	>
		? Fields[number]
		: never;
}[keyof Constraints];

type UnionToIntersection<Value> = (
	Value extends unknown ? (value: Value) => void : never
) extends (value: infer Intersection) => void
	? Intersection
	: never;

type SeedKeyAtPath<
	Fields extends Readonly<Record<string, FieldNode>>,
	Path extends FieldReference,
> = Path extends keyof Fields & string
	? Fields[Path] extends FieldDefinition
		? Readonly<{
				[Key in Path]-?: Exclude<SeedValueForField<Fields[Path]>, null>;
			}>
		: never
	: Path extends readonly [
				infer Head extends keyof Fields & string,
				...infer Tail extends string[],
		  ]
		? Fields[Head] extends InlineShapeDefinition<infer Children>
			? Tail extends [infer Leaf extends keyof Children & string]
				? Children[Leaf] extends FieldDefinition
					? Readonly<{
							[Key in Head]-?: Readonly<{
								[Child in Leaf]-?: Exclude<
									SeedValueForField<Children[Leaf]>,
									null
								>;
							}>;
						}>
					: never
				: Tail extends FieldReference
					? Readonly<{
							[Key in Head]-?: SeedKeyAtPath<Children, Tail>;
						}>
					: never
			: never
		: never;

export type SeedPrimaryKey<
	Fields extends Readonly<Record<string, FieldNode>>,
	Constraints,
> = Readonly<
	UnionToIntersection<
		SeedKeyAtPath<
			Fields,
			Extract<PrimaryKeyReferences<Constraints>, FieldReference>
		>
	>
>;
