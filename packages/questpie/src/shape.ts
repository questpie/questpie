import type { FieldDefinition } from "./field-contract";

export type FieldNode = FieldDefinition | InlineShapeDefinition;

export interface InlineShapeDefinition<
	Fields extends Readonly<Record<string, FieldNode>> = Readonly<
		Record<string, FieldNode>
	>,
> {
	readonly kind: "inlineShape";
	readonly fields: Fields;
}

export const shape = Object.freeze({
	inline: <const Fields extends Readonly<Record<string, FieldNode>>>(
		input: Readonly<{ fields: Fields }> &
			(keyof Fields extends never ? never : unknown),
	): InlineShapeDefinition<Fields> =>
		Object.freeze({ kind: "inlineShape", fields: input.fields }),
});
