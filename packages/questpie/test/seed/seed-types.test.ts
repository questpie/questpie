import { describe, expect, it } from "bun:test";
import { resolveAutoSeedCategories } from "../../src/server/seed/types.js";

describe("resolveAutoSeedCategories", () => {
	it("returns undefined for true (run all)", () => {
		expect(resolveAutoSeedCategories(true)).toBeUndefined();
	});

	it("returns undefined for false (run none)", () => {
		expect(resolveAutoSeedCategories(false)).toBeUndefined();
	});

	it('resolves "required" to ["required"]', () => {
		expect(resolveAutoSeedCategories("required")).toEqual(["required"]);
	});

	it('resolves "dev" to ["required", "dev"]', () => {
		expect(resolveAutoSeedCategories("dev")).toEqual(["required", "dev"]);
	});

	it('resolves "test" to ["required", "test"]', () => {
		expect(resolveAutoSeedCategories("test")).toEqual(["required", "test"]);
	});

	it("passes through arrays unchanged", () => {
		expect(resolveAutoSeedCategories(["dev", "test"])).toEqual(["dev", "test"]);
	});
});
