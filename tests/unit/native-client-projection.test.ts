import { expect, test } from "bun:test";

import {
	attachClientScope,
	projectionVersion,
	readClientScope,
} from "../../packages/questpie/src/internal/client-projection";

test("a generated scope capability preserves its exact projection without public string members", () => {
	const projection = Object.freeze({
		version: projectionVersion,
		canonicalScope: "internal canonical material",
		queries: {},
		mutations: {},
	});
	const scope = Object.freeze(
		attachClientScope({ context: {} }, () => projection),
	);
	expect(readClientScope(scope)).toBe(projection);
	expect(Object.keys(scope)).toEqual(["context"]);
	expect(Object.getOwnPropertySymbols(scope)).toEqual([
		Symbol.for("questpie.client-scope.v1"),
	]);
	expect(projectionVersion).toBe("questpie.client-projection.v1");
});

test("missing and incompatible capabilities fail without invoking their readers", () => {
	let reads = 0;
	const invalid = Object.defineProperty(
		{},
		Symbol.for("questpie.client-scope.v1"),
		{
			value: {
				version: "questpie.client-scope.prototype.v4",
				read() {
					reads++;
					throw new Error("MUST_NOT_READ");
				},
			},
		},
	);
	expect(() => readClientScope({} as never)).toThrow(
		"CLIENT_PROJECTION_INCOMPATIBLE",
	);
	expect(() => readClientScope(invalid as never)).toThrow(
		"CLIENT_PROJECTION_INCOMPATIBLE",
	);
	expect(reads).toBe(0);
});
