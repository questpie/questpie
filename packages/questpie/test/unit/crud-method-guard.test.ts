/**
 * CRUD method guard
 *
 * Unknown method access on a generated CRUD object must throw an instructive
 * TypeError (typos in untyped glue previously produced `undefined is not a
 * function` — or a silent no-op when swallowed by a bare catch). Everything
 * that exists, plus the legitimate probe patterns (thenables, serializers,
 * matchers, the `crud.upload` capability check), must behave exactly as a
 * plain object.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

const guard_items = collection("guard_items").fields(({ f }) => ({
	name: f.text().required(),
}));

describe("CRUD method guard", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let crud: any;

	beforeAll(async () => {
		setup = await buildMockApp({ collections: { guard_items } });
		await runTestDbMigrations(setup.app);
		crud = setup.app.collections.guard_items;
	});

	afterAll(async () => {
		await setup.cleanup();
	});

	it("throws a TypeError with a suggestion for a typo'd method", () => {
		expect(() => crud.updateMnay).toThrow(TypeError);
		expect(() => crud.updateMnay).toThrow(
			'collections.guard_items.updateMnay is not a CRUD method. Did you mean "updateMany"?',
		);
	});

	it("lists canonical methods and flags deprecated aliases in the error", () => {
		let message = "";
		try {
			(() => crud.bulkUpsert)();
		} catch (error: any) {
			message = error.message;
		}
		expect(message).toContain(
			"Available: find, findOne, count, lockMany, create, updateById, updateMany, updateBatch, deleteById, purgeById, deleteMany, restoreById, findVersions, revertToVersion, transitionStage",
		);
		expect(message).toContain("(deprecated: update, delete)");
		// internals are not advertised
		expect(message).not.toContain("~internalState");
	});

	it("suggests the canonical name over the deprecated alias", () => {
		expect(() => crud.updateManyy).toThrow('Did you mean "updateMany"?');
		expect(() => crud.deleteManu).toThrow('Did you mean "deleteMany"?');
	});

	it("exposes canonical and deprecated bulk methods", () => {
		expect(typeof crud.updateMany).toBe("function");
		expect(typeof crud.deleteMany).toBe("function");
		expect(crud.update).toBe(crud.updateMany);
		expect(crud.delete).toBe(crud.deleteMany);
	});

	it("keeps `in`-operator feature detection working without throwing", () => {
		expect("updateMany" in crud).toBe(true);
		expect("upload" in crud).toBe(false);
		expect("definitelyNotAMethod" in crud).toBe(false);
	});

	it("keeps the upload capability probe returning undefined on non-upload collections", () => {
		expect(crud.upload).toBeUndefined();
		expect(crud.uploadMany).toBeUndefined();
	});

	it("does not break thenable probes (await crud)", async () => {
		expect(crud.then).toBeUndefined();
		// `await` probes `then` — must resolve to the object itself, not throw
		const awaited = await crud;
		expect(awaited).toBe(crud);
	});

	it("does not break serialization and matcher probes", () => {
		expect(crud.toJSON).toBeUndefined();
		expect(crud.$$typeof).toBeUndefined();
		expect(crud.asymmetricMatch).toBeUndefined();
	});

	it("does not break prototype-chain members and symbols", () => {
		expect(String(crud)).toBe("[object Object]");
		expect(typeof crud.constructor).toBe("function");
		expect(typeof crud.hasOwnProperty).toBe("function");
		expect((crud as any)[Symbol.toPrimitive]).toBeUndefined();
	});

	it("keeps spreads and Object.keys intact", () => {
		const keys = Object.keys(crud);
		expect(keys).toContain("updateMany");
		expect(keys).toContain("deleteMany");
		expect(keys).toContain("updateById");

		const spread = { ...crud };
		expect(typeof spread.find).toBe("function");
	});

	it("passes through ~internal state", () => {
		expect(crud["~internalState"]).toBeDefined();
		expect(crud["~internalRelatedTable"]).toBeDefined();
	});
});
