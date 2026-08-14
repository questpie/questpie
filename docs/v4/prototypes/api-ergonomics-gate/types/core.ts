export interface Codec<Value> {
	readonly value?: Value;
}

export type CodecValue<ValueCodec> =
	ValueCodec extends Codec<infer Value> ? Value : never;

type StructuralDefinition<Kind extends string, Name extends string> = Readonly<{
	kind: Kind;
	name: Name;
}>;

export function defineCollection<const Name extends string>(input: {
	readonly name: Name;
}): StructuralDefinition<"collection", Name> {
	return Object.freeze({ kind: "collection", name: input.name });
}

export function defineContext<const Name extends string>(input: {
	readonly name: Name;
}): StructuralDefinition<"context", Name> {
	return Object.freeze({ kind: "context", name: input.name });
}

export function defineSeed<const Name extends string>(input: {
	readonly name: Name;
}): StructuralDefinition<"seed", Name> {
	return Object.freeze({ kind: "seed", name: input.name });
}

export const define = Object.freeze({
	collection: defineCollection,
	context: defineContext,
	seed: defineSeed,
});

export const codec = Object.freeze({
	text: (): Codec<string> => Object.freeze({}),
	uuid: (): Codec<string> => Object.freeze({}),
});
