import { expect, test } from "bun:test";

import { type DiscriminatedValue, matchDiscriminated } from "./helpers";

test("dispatches own prototype-like kinds without inherited lookup", () => {
	type Hostile = DiscriminatedValue<{
		constructor: { value: number };
		prototype: { value: number };
	}>;
	const value: Hostile = { kind: "constructor", value: 7 };
	expect(
		matchDiscriminated(value as Hostile, {
			constructor: ({ value: current }) => current,
			prototype: ({ value: current }) => current + 1,
		}),
	).toBe(7);
	expect(() =>
		matchDiscriminated(
			{ kind: "missing" } as never,
			Object.create({ missing: () => "inherited" }) as never,
		),
	).toThrow("invalid discriminated value");
});
