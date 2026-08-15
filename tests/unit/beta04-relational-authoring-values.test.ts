import { expect, test } from "bun:test";

import { query } from "questpie";

test("preserves integer parameter bounds for compiler normalization", () => {
	expect(
		query.parameter.integer({ nullable: false, minimum: 1, maximum: 100 }),
	).toEqual({
		kind: "parameter",
		parameterKind: "integer",
		nullable: false,
		minimum: 1,
		maximum: 100,
	});
});
