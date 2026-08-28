import { codec } from "./codec";
import type { codecValueType, Codec, CodecKind, CodecValue } from "./codec";
import type { FieldDefinition } from "./field-contract";
import type { FieldNode } from "./shape";
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
type FieldOperationValue<Node> =
	Node extends FieldDefinition<
		infer Value,
		boolean,
		FieldDefinition["default"],
		infer Scalar,
		boolean,
		boolean,
		infer Options
	>
		? Scalar extends "timestamp"
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
					: Value
		: never;
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
type CreateKey<F extends FieldMap> = {
	[K in keyof F]: F[K] extends FieldDefinition<
		unknown,
		boolean,
		FieldDefinition["default"],
		FieldDefinition["scalar"],
		boolean,
		infer S
	>
		? S extends true
			? never
			: K
		: never;
}[keyof F];
type UpdateKey<F extends FieldMap> = {
	[K in keyof F]: F[K] extends FieldDefinition<
		unknown,
		boolean,
		FieldDefinition["default"],
		FieldDefinition["scalar"],
		infer I,
		infer S
	>
		? S extends true
			? never
			: I extends true
				? never
				: K
		: never;
}[keyof F];
type Optional<C extends AnyCodec> = TypedCodec<
	CodecValue<C>,
	"optional",
	"optional"
>;
export type CreatePropertiesFor<F extends FieldMap> = Readonly<{
	[K in CreateKey<F>]: F[K] extends FieldDefinition<unknown, infer N, infer D>
		? N extends true
			? Optional<FieldCodec<F[K]>>
			: D extends null
				? FieldCodec<F[K]>
				: Optional<FieldCodec<F[K]>>
		: never;
}>;
export type UpdatePropertiesFor<F extends FieldMap> = Readonly<{
	[K in UpdateKey<F>]: Optional<FieldCodec<F[K]>>;
}>;
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

function properties(fields: FieldMap, mode: "create" | "update"): CodecMap {
	return Object.freeze(
		Object.fromEntries(
			Object.entries(fields).flatMap(([name, field]) => {
				if (
					field.kind !== "field" ||
					field.server ||
					(mode === "update" && field.immutable)
				)
					return [];
				const scalar = descriptor(field.scalar, field.options);
				const value = field.nullable ? codec.nullable(scalar) : scalar;
				return [
					[
						name,
						mode === "update" || field.nullable || field.default !== null
							? codec.optional(value)
							: value,
					],
				];
			}),
		),
	);
}

export const collectionCreateInput = <F extends FieldMap>(fields: F) =>
	inputCodec(properties(fields, "create")) as CollectionInputCodec<
		CreatePropertiesFor<F>
	>;
export const collectionUpdateInput = <F extends FieldMap>(fields: F) =>
	inputCodec(properties(fields, "update")) as CollectionInputCodec<
		UpdatePropertiesFor<F>
	>;
