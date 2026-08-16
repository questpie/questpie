import { expect, expectTypeOf, test } from "bun:test";

import { operation } from "questpie";
import type { ValueProgramOperand } from "questpie";

test("builds immutable closed text normalization values", () => {
	const required = { kind: "valueOperand", value: "  Message  " } as const;
	const optional = {
		kind: "valueOperand",
		value: undefined as string | undefined,
	} as const;

	const trimmed = operation.text.trim(required);
	const trimmedIfPresent = operation.text.trimIfPresent(optional);

	expect(trimmed).toEqual({
		kind: "normalizedValue",
		transform: "trim",
		source: required,
	});
	expect(trimmedIfPresent).toEqual({
		kind: "normalizedValue",
		transform: "trimIfPresent",
		source: optional,
	});
	expect(Object.isFrozen(trimmed)).toBe(true);
	expect(Object.isFrozen(trimmedIfPresent)).toBe(true);
	expect(Object.isFrozen(operation.text)).toBe(true);
	expect(trimmed.source).toBe(required);
	expect(trimmedIfPresent.source).toBe(optional);
	expectTypeOf(trimmed).toEqualTypeOf<
		Readonly<{
			kind: "normalizedValue";
			transform: "trim";
			source: ValueProgramOperand<string>;
		}>
	>();
	expectTypeOf(trimmedIfPresent).toEqualTypeOf<
		Readonly<{
			kind: "normalizedValue";
			transform: "trimIfPresent";
			source: ValueProgramOperand<string | undefined>;
		}>
	>();
});
