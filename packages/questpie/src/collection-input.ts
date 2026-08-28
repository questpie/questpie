import { codec } from "./codec";
import type { codecValueType, Codec, CodecKind, CodecValue } from "./codec";
import type { FieldDefinition } from "./field-contract";
import type { FieldNode } from "./shape";

type FieldMap = Readonly<Record<string, FieldNode>>;
type AnyCodec = Codec<unknown, CodecKind, "required" | "optional">;
type CodecMap = Readonly<Record<string, AnyCodec>>;
type TypedCodec<
	Value,
	Kind extends CodecKind = CodecKind,
	Presence extends "required" | "optional" = "required",
> = Codec<Value, Kind, Presence> & Readonly<{ [codecValueType]: Value }>;
type FieldCodec<Node> =
	Node extends FieldDefinition<infer Value, infer Nullable>
		? Nullable extends true
			? TypedCodec<Value | null, "nullable">
			: TypedCodec<Value>
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
				const property = properties[key];
				if (!property)
					throw new TypeError(
						`Collection input selector has unknown Field: ${key}`,
					);
				return [key, property];
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
					Object.entries(properties).filter(([key]) => !(key in selection)),
				),
			);
		},
	}) as unknown as CollectionInputCodec<P>;
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
				const scalar = Object.freeze({ kind: field.scalar }) as AnyCodec;
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
