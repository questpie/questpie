import { codec } from "./codec";
import type { codecValueType, Codec, CodecKind, CodecValue } from "./codec";
import type { FieldDefinition } from "./field-contract";
import type { FieldNode, InlineShapeDefinition } from "./shape";
import type { ValueDefinition } from "./value";

type FieldMap = Readonly<Record<string, FieldNode>>;
type AnyCodec = Codec<unknown, CodecKind, "required" | "optional">;
type CodecMap = Readonly<Record<string, AnyCodec>>;
type TypedCodec<
	Value,
	Kind extends CodecKind = CodecKind,
	Presence extends "required" | "optional" = "required",
> = Codec<Value, Kind, Presence> & Readonly<{ [codecValueType]: Value }>;
type EmbeddedOperationValue<Node> =
	Node extends ValueDefinition<
		infer Value,
		infer Nullable,
		infer Kind,
		infer Options
	>
		?
				| (Kind extends "timestamp"
						? Date
						: Kind extends "object"
							? Options extends Readonly<{
									properties: infer Properties extends Readonly<
										Record<string, ValueDefinition>
									>;
								}>
								? Readonly<{
										[Key in keyof Properties]: EmbeddedOperationValue<
											Properties[Key]
										>;
									}>
								: Value
							: Kind extends "array"
								? Options extends Readonly<{
										items: infer Item extends ValueDefinition;
									}>
									? readonly EmbeddedOperationValue<Item>[]
									: Value
								: Value)
				| (Nullable extends true ? null : never)
		: never;
export type FieldOperationValue<Node> =
	Node extends FieldDefinition<
		infer Value,
		infer Nullable,
		FieldDefinition["default"],
		infer Scalar,
		boolean | "database",
		boolean,
		infer Options
	>
		?
				| (Scalar extends "timestamp"
						? Date
						: Scalar extends "object"
							? Options extends Readonly<{
									properties: infer Properties extends Readonly<
										Record<string, ValueDefinition>
									>;
								}>
								? Readonly<{
										[Key in keyof Properties]: EmbeddedOperationValue<
											Properties[Key]
										>;
									}>
								: Value
							: Scalar extends "array"
								? Options extends Readonly<{
										items: infer Item extends ValueDefinition;
									}>
									? readonly EmbeddedOperationValue<Item>[]
									: Value
								: Value)
				| (Nullable extends true ? null : never)
		: never;

export type CollectionRowFor<Fields extends FieldMap> = Readonly<{
	[Key in keyof Fields]: Fields[Key] extends InlineShapeDefinition<
		infer Children
	>
		? CollectionRowFor<Children>
		: FieldOperationValue<Fields[Key]>;
}>;
type FieldCodec<Node> =
	Node extends FieldDefinition<
		unknown,
		infer Nullable,
		FieldDefinition["default"],
		infer Scalar
	>
		? Nullable extends true
			? TypedCodec<FieldOperationValue<Node> | null, "nullable">
			: TypedCodec<FieldOperationValue<Node>, Scalar>
		: never;
type Optional<C extends AnyCodec> = TypedCodec<
	CodecValue<C>,
	"optional",
	"optional"
>;
type Selected<P extends CodecMap, S extends Partial<Record<keyof P, true>>> = {
	[K in keyof P]: S[K] extends true ? K : never;
}[keyof P];
type ObjectMembers<P extends CodecMap> = {
	[K in keyof P as P[K] extends Codec<unknown, CodecKind, "optional">
		? never
		: K]: CodecValue<P[K]>;
} & {
	[K in keyof P as P[K] extends Codec<unknown, CodecKind, "optional">
		? K
		: never]?: CodecValue<P[K]>;
};
type ObjectValue<P extends CodecMap> = Readonly<{
	[K in keyof ObjectMembers<P>]: ObjectMembers<P>[K];
}>;

type InlineDepth = readonly [1, 1, 1, 1, 1, 1, 1, 1];
type Descend<Depth extends readonly unknown[]> = Depth extends readonly [
	unknown,
	...infer Rest,
]
	? Rest
	: readonly [];

type CreateInlineCodec<
	Fields extends FieldMap,
	Depth extends readonly unknown[],
	Properties extends CodecMap = CreatePropertiesFor<Fields, Depth>,
> = keyof Properties extends never
	? never
	: HasRequiredMember<Properties> extends true
		? TypedCodec<ObjectValue<Properties>, "object">
		: Optional<TypedCodec<ObjectValue<Properties>, "object">>;

type CreateNodeCodec<Node, Depth extends readonly unknown[]> =
	Node extends FieldDefinition<
		unknown,
		infer Nullable,
		infer Default,
		FieldDefinition["scalar"],
		boolean,
		infer Server,
		Readonly<Record<string, unknown>>,
		infer OnUpdate
	>
		? OnUpdate extends "now"
			? never
			: Server extends true
				? never
				: Nullable extends true
					? Optional<FieldCodec<Node>>
					: Default extends null
						? FieldCodec<Node>
						: Optional<FieldCodec<Node>>
		: Node extends InlineShapeDefinition<infer Fields>
			? Depth extends readonly []
				? never
				: CreateInlineCodec<Fields, Descend<Depth>>
			: never;

type UpdateInlineCodec<
	Fields extends FieldMap,
	Depth extends readonly unknown[],
	Properties extends CodecMap = UpdatePropertiesFor<Fields, Depth>,
> = keyof Properties extends never
	? never
	: Optional<TypedCodec<ObjectValue<Properties>, "object">>;

type UpdateNodeCodec<Node, Depth extends readonly unknown[]> =
	Node extends FieldDefinition<
		unknown,
		boolean,
		FieldDefinition["default"],
		FieldDefinition["scalar"],
		infer Immutable,
		infer Server,
		Readonly<Record<string, unknown>>,
		infer OnUpdate
	>
		? OnUpdate extends "now"
			? never
			: Server extends true
				? never
				: Immutable extends true | "database"
					? never
					: Optional<FieldCodec<Node>>
		: Node extends InlineShapeDefinition<infer Fields>
			? Depth extends readonly []
				? never
				: UpdateInlineCodec<Fields, Descend<Depth>>
			: never;

type HasRequiredMember<Properties extends CodecMap> = {
	[Key in keyof Properties]: Properties[Key] extends Codec<
		unknown,
		CodecKind,
		"optional"
	>
		? false
		: true;
}[keyof Properties] extends false
	? false
	: true;

export type CreatePropertiesFor<
	F extends FieldMap,
	Depth extends readonly unknown[] = InlineDepth,
> = Readonly<{
	[K in keyof F as CreateNodeCodec<F[K], Depth> extends never
		? never
		: K]: CreateNodeCodec<F[K], Depth>;
}>;
export type UpdatePropertiesFor<
	F extends FieldMap,
	Depth extends readonly unknown[] = InlineDepth,
> = Readonly<{
	[K in keyof F as UpdateNodeCodec<F[K], Depth> extends never
		? never
		: K]: UpdateNodeCodec<F[K], Depth>;
}>;

export interface CollectionInputCodec<P extends CodecMap> extends Codec<
	ObjectValue<P>,
	"object"
> {
	/** Type-only value carried by the public Codec contract. */
	readonly [codecValueType]: ObjectValue<P>;
	readonly properties: P;
	pick<const S extends Partial<Record<keyof P, true>>>(
		selection: S,
	): CollectionInputCodec<Pick<P, Selected<P, S>>>;
	omit<const S extends Partial<Record<keyof P, true>>>(
		selection: S,
	): CollectionInputCodec<Omit<P, keyof S>>;
}

function inputCodec<P extends CodecMap>(
	properties: P,
): CollectionInputCodec<P> {
	const build = (next: CodecMap) => inputCodec(Object.freeze(next));
	const selected = (selection: Readonly<Record<string, true>>) =>
		Object.fromEntries(
			Object.keys(selection).map((key) => {
				if (selection[key] !== true)
					throw new TypeError(
						`Collection input selector must select ${key} with true`,
					);
				if (!Object.hasOwn(properties, key))
					throw new TypeError(
						`Collection input selector has unknown Field: ${key}`,
					);
				return [key, properties[key]!];
			}),
		);
	return Object.freeze({
		kind: "object" as const,
		properties: Object.freeze(properties),
		pick: (selection: Readonly<Record<string, true>>) =>
			build(selected(selection)),
		omit: (selection: Readonly<Record<string, true>>) => {
			selected(selection);
			return build(
				Object.fromEntries(
					Object.entries(properties).filter(
						([key]) => !Object.hasOwn(selection, key),
					),
				),
			);
		},
	}) as unknown as CollectionInputCodec<P>;
}

type DefinitionOptions = Readonly<Record<string, unknown>>;

function frozenProperties(
	entries: readonly (readonly [string, AnyCodec])[],
): CodecMap {
	const result: Record<string, AnyCodec> = Object.create(null);
	for (const [key, descriptor] of entries) result[key] = descriptor;
	return Object.freeze(result);
}

function boundedMembers(
	options: DefinitionOptions,
	minimum: "minLength" | "minimum",
	maximum: "maxLength" | "maximum",
): DefinitionOptions {
	return {
		...(options[minimum] === undefined ? {} : { [minimum]: options[minimum] }),
		...(options[maximum] === undefined ? {} : { [maximum]: options[maximum] }),
	};
}

function descriptor(kind: string, options: DefinitionOptions): AnyCodec {
	if (kind === "text")
		return Object.freeze({
			kind,
			...boundedMembers(options, "minLength", "maxLength"),
		}) as AnyCodec;
	if (kind === "integer")
		return Object.freeze({
			kind,
			...boundedMembers(options, "minimum", "maximum"),
		}) as AnyCodec;
	if (kind === "bigint")
		return Object.freeze({
			kind,
			...boundedMembers(options, "minimum", "maximum"),
		}) as AnyCodec;
	if (kind === "numeric")
		return Object.freeze({
			kind,
			precision: options.precision,
			scale: options.scale,
		}) as AnyCodec;
	if (kind === "timestamp")
		return Object.freeze({
			kind,
			withTimezone: options.withTimezone ?? false,
		}) as AnyCodec;
	if (kind === "object") {
		const properties = options.properties as Readonly<
			Record<string, ValueDefinition>
		>;
		return Object.freeze({
			kind,
			properties: frozenProperties(
				Object.entries(properties).map(([key, definition]) => [
					key,
					embeddedDescriptor(definition),
				]),
			),
		}) as AnyCodec;
	}
	if (kind === "array")
		return Object.freeze({
			kind,
			items: embeddedDescriptor(options.items as ValueDefinition),
			maximum: options.maximumItems,
		}) as AnyCodec;
	return Object.freeze({ kind }) as AnyCodec;
}

function embeddedDescriptor(definition: ValueDefinition): AnyCodec {
	const value = descriptor(definition.kind, definition.options);
	return definition.nullable ? codec.nullable(value) : value;
}

function nodeDescriptor(
	node: FieldNode,
	mode: "create" | "update",
): AnyCodec | null {
	if (node.kind === "inlineShape") {
		const nested = properties(node.fields, mode);
		if (Object.keys(nested).length === 0) return null;
		const object = Object.freeze({
			kind: "object",
			properties: nested,
		}) as AnyCodec;
		const hasRequiredMember = Object.values(nested).some(
			(member) => member.kind !== "optional",
		);
		return mode === "update" || !hasRequiredMember
			? codec.optional(object)
			: object;
	}
	if (
		node.onUpdate === "now" ||
		node.server ||
		(mode === "update" && node.immutable)
	)
		return null;
	const scalar = descriptor(node.scalar, node.options);
	const value = node.nullable ? codec.nullable(scalar) : scalar;
	return mode === "update" || node.nullable || node.default !== null
		? codec.optional(value)
		: value;
}

function properties(fields: FieldMap, mode: "create" | "update"): CodecMap {
	return frozenProperties(
		Object.entries(fields).flatMap(([name, node]) => {
			const member = nodeDescriptor(node, mode);
			return member === null ? [] : [[name, member] as const];
		}),
	);
}

export const collectionCreateInput = <F extends FieldMap>(fields: F) =>
	inputCodec(properties(fields, "create")) as unknown as CollectionInputCodec<
		CreatePropertiesFor<F>
	>;
export const collectionUpdateInput = <F extends FieldMap>(fields: F) =>
	inputCodec(properties(fields, "update")) as unknown as CollectionInputCodec<
		UpdatePropertiesFor<F>
	>;
