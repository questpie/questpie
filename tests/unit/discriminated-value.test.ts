import { expect, test } from "bun:test";

import { matchDiscriminated } from "../../packages/questpie/src";

test("matches only own callable discriminated branches", () => {
	expect(
		matchDiscriminated(
			{ kind: "constructor", value: 7 },
			{
				constructor: ({ value }) => value,
				prototype: ({ value }: { value: number }) => value + 1,
			},
		),
	).toBe(7);

	expect(() =>
		matchDiscriminated(
			{ kind: "missing" } as never,
			Object.create({ missing: () => "inherited" }) as never,
		),
	).toThrow(new TypeError("invalid discriminated value"));
	expect(() =>
		matchDiscriminated(
			{ kind: "appointment" } as never,
			{ appointment: "not callable" } as never,
		),
	).toThrow(new TypeError("invalid discriminated value"));
});
