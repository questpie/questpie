import { describe, expect, it } from "bun:test";

import { extractAppServices } from "../../src/server/config/app-context.js";

/**
 * `tables` was declared on the emitted context type, on `JobHandlerContext` and
 * on `WorkflowContext`, and nothing ever assigned it. So `ctx.tables`
 * typechecked and came back `undefined`, which is worse than not existing.
 *
 * It is a getter because `app.tables` rebuilds its record on every read, and
 * most handlers never touch it.
 */
const fakeApp = () => {
	let reads = 0;
	return {
		get tables() {
			reads += 1;
			return { posts: { __brand: "table" } };
		},
		get reads() {
			return reads;
		},
		db: {},
		queue: {},
		email: {},
		storage: {},
		kv: {},
		executor: {},
		logger: {},
		observability: {},
		search: {},
		realtime: {},
		collections: {},
		globals: {},
		t: () => "",
	} as any;
};

describe("the context carries tables", () => {
	it("resolves to the app's tables", () => {
		const ctx = extractAppServices(fakeApp()) as any;

		expect(ctx.tables).toEqual({ posts: { __brand: "table" } });
	});

	it("does not read them until you ask", () => {
		const app = fakeApp();
		extractAppServices(app);

		expect(app.reads).toBe(0);
	});
});
