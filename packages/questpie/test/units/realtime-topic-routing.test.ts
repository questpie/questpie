import { describe, expect, test } from "bun:test";

import {
	compileRealtimeTopicRouting,
	evaluateRealtimeChangeRouting,
	RealtimeCandidateRouter,
} from "../../src/server/modules/core/integrated/realtime/topic-routing.js";
import type { RealtimeChangeEvent } from "../../src/server/modules/core/integrated/realtime/types.js";

function event(
	operation: RealtimeChangeEvent["operation"],
	before?: Record<string, string | number | boolean | null> | null,
	after?: Record<string, string | number | boolean | null> | null,
): RealtimeChangeEvent {
	return {
		seq: 1,
		resourceType: "collection",
		resource: "items",
		operation,
		payload: { before, after },
		createdAt: new Date(0),
	};
}

describe("conservative realtime topic routing", () => {
	test("proves misses only for supported own-column predicates", () => {
		const plan = compileRealtimeTopicRouting({
			scopeId: "scope-a",
			status: { in: ["open", "pending"] },
		});

		expect(
			evaluateRealtimeChangeRouting(
				plan,
				event("create", null, { scopeId: "scope-b", status: "open" }),
			),
		).toBe("miss");
		expect(
			evaluateRealtimeChangeRouting(
				plan,
				event("create", null, { scopeId: "scope-a", status: "open" }),
			),
		).toBe("match");
		expect(
			evaluateRealtimeChangeRouting(
				plan,
				event("create", null, { scopeId: "scope-a" }),
			),
		).toBe("unknown");
	});

	test("keeps RAW, relations, unsupported operators, and oversized in unknown", () => {
		const relationNames = new Set(["members"]);
		for (const where of [
			{ RAW: "opaque" },
			{ members: { eq: "user-a" } },
			{ createdAt: { gt: 10 } },
			{ scopeId: { in: Array.from({ length: 129 }, (_, index) => index) } },
		]) {
			const plan = compileRealtimeTopicRouting(where, relationNames);
			expect(
				evaluateRealtimeChangeRouting(
					plan,
					event("create", null, {
						scopeId: "scope-b",
						members: "user-b",
						createdAt: 5,
					}),
				),
			).toBe("unknown");
		}
	});

	test("composes AND, OR, and NOT without false-negative shortcuts", () => {
		const andPlan = compileRealtimeTopicRouting({
			AND: [
				{ scopeId: "scope-a" },
				{ OR: [{ status: "open" }, { status: "pending" }] },
			],
		});
		expect(
			evaluateRealtimeChangeRouting(
				andPlan,
				event("create", null, { scopeId: "scope-b", status: "open" }),
			),
		).toBe("miss");

		const orPlan = compileRealtimeTopicRouting({
			OR: [{ scopeId: "scope-a" }, { RAW: "server predicate" }],
		});
		expect(
			evaluateRealtimeChangeRouting(
				orPlan,
				event("create", null, { scopeId: "scope-b" }),
			),
		).toBe("unknown");

		const notPlan = compileRealtimeTopicRouting({
			NOT: { scopeId: "scope-a" },
		});
		expect(
			evaluateRealtimeChangeRouting(
				notPlan,
				event("create", null, { scopeId: "scope-a" }),
			),
		).toBe("miss");
		expect(
			evaluateRealtimeChangeRouting(notPlan, event("create", null, {})),
		).toBe("unknown");
	});

	test("keeps malformed logical shapes conservative", () => {
		const malformedAnd = compileRealtimeTopicRouting({
			AND: { scopeId: "scope-a" },
		});
		const malformedOr = compileRealtimeTopicRouting({
			OR: { scopeId: "scope-a" },
		});
		const emptyNot = compileRealtimeTopicRouting({ NOT: {} });
		const arrayNot = compileRealtimeTopicRouting({
			NOT: [{ scopeId: "scope-a" }],
		});
		const change = event("create", null, { scopeId: "scope-b" });

		expect(evaluateRealtimeChangeRouting(malformedAnd, change)).toBe("unknown");
		expect(evaluateRealtimeChangeRouting(malformedOr, change)).toBe("unknown");
		expect(evaluateRealtimeChangeRouting(emptyNot, change)).toBe("unknown");
		expect(evaluateRealtimeChangeRouting(arrayNot, change)).toBe("unknown");
	});

	test("updates skip only when both before and after are proven misses", () => {
		const plan = compileRealtimeTopicRouting({ scopeId: "scope-a" });

		expect(
			evaluateRealtimeChangeRouting(
				plan,
				event("update", { scopeId: "scope-a" }, { scopeId: "scope-b" }),
			),
		).toBe("match");
		expect(
			evaluateRealtimeChangeRouting(
				plan,
				event("update", { scopeId: "scope-b" }, { scopeId: "scope-c" }),
			),
		).toBe("miss");
		expect(
			evaluateRealtimeChangeRouting(
				plan,
				event("update", { scopeId: "scope-b" }, {}),
			),
		).toBe("unknown");
	});

	test("indexes only positive required anchors and preserves unknown fallbacks", () => {
		const router = new RealtimeCandidateRouter<string>();
		const a = compileRealtimeTopicRouting({
			scopeId: "scope-a",
			RAW: "expensive",
		});
		const b = compileRealtimeTopicRouting({
			scopeId: { eq: "scope-b" },
		});
		const unanchored = compileRealtimeTopicRouting({
			OR: [{ scopeId: "scope-c" }, { recipientId: "user-a" }],
		});
		router.add("a", a);
		router.add("b", b);
		router.add("unanchored", unanchored);

		expect([
			...router.candidates(event("create", null, { scopeId: "scope-a" })),
		]).toEqual(["unanchored", "a"]);
		expect([
			...router.candidates(event("create", null, { title: "missing anchor" })),
		]).toEqual(["unanchored", "a", "b"]);

		router.delete("a");
		expect([
			...router.candidates(event("create", null, { scopeId: "scope-a" })),
		]).toEqual(["unanchored"]);
	});

	test("never proves miss when a generated supported predicate matches", () => {
		let state = 0x5eed;
		const random = (maximum: number) => {
			state = (state * 1_664_525 + 1_013_904_223) >>> 0;
			return state % maximum;
		};
		const values = ["a", "b", "c"] as const;
		for (let iteration = 0; iteration < 2_000; iteration += 1) {
			const left = values[random(values.length)]!;
			const right = values[random(values.length)]!;
			const projection = {
				scopeId: values[random(values.length)]!,
				status: values[random(values.length)]!,
			};
			const where =
				iteration % 3 === 0
					? {
							AND: [
								{ scopeId: { eq: left } },
								{ status: { in: [left, right] } },
							],
						}
					: iteration % 3 === 1
						? {
								OR: [{ scopeId: left }, { status: { eq: right } }],
							}
						: { NOT: { scopeId: left } };
			const matches =
				iteration % 3 === 0
					? projection.scopeId === left &&
						(left === projection.status || right === projection.status)
					: iteration % 3 === 1
						? projection.scopeId === left || projection.status === right
						: projection.scopeId !== left;
			const outcome = evaluateRealtimeChangeRouting(
				compileRealtimeTopicRouting(where),
				event("create", null, projection),
			);
			if (matches) expect(outcome).not.toBe("miss");
		}
	});

	test("routes a bulk change by its row images only while they are complete", () => {
		const plan = compileRealtimeTopicRouting({ scopeId: "scope-a" });
		const bulk = (
			operation: "bulk_update" | "bulk_delete",
			rows?: Array<{ before: Record<string, string> | null; after: Record<string, string> | null }>,
			count = rows?.length ?? 2,
		): RealtimeChangeEvent => ({
			seq: 1,
			resourceType: "collection",
			resource: "items",
			operation,
			payload: { count, recordIds: ["a", "b"].slice(0, count), ...(rows ? { rows } : {}) },
			createdAt: new Date(0),
		});
		const other = { scopeId: "scope-b" };
		const own = { scopeId: "scope-a" };

		// Every row proven unrelated: the watcher skips the change.
		expect(evaluateRealtimeChangeRouting(plan, bulk("bulk_update", [{ before: other, after: other }, { before: other, after: other }]))).toBe("miss");
		// One row enters or leaves the watched range: the watcher refreshes.
		expect(evaluateRealtimeChangeRouting(plan, bulk("bulk_update", [{ before: other, after: other }, { before: other, after: own }]))).toBe("match");
		expect(evaluateRealtimeChangeRouting(plan, bulk("bulk_update", [{ before: own, after: other }, { before: other, after: other }]))).toBe("match");
		// A delete reads only the rows as they were.
		expect(evaluateRealtimeChangeRouting(plan, bulk("bulk_delete", [{ before: other, after: null }, { before: other, after: null }]))).toBe("miss");
		expect(evaluateRealtimeChangeRouting(plan, bulk("bulk_delete", [{ before: own, after: null }, { before: other, after: null }]))).toBe("match");
		// No images (over the limit), a partial set, or a row missing the field: unknown.
		expect(evaluateRealtimeChangeRouting(plan, bulk("bulk_update"))).toBe("unknown");
		expect(evaluateRealtimeChangeRouting(plan, bulk("bulk_update", [{ before: other, after: other }], 2))).toBe("unknown");
		expect(evaluateRealtimeChangeRouting(plan, bulk("bulk_update", [{ before: other, after: other }, { before: {}, after: {} }]))).toBe("unknown");
		expect(evaluateRealtimeChangeRouting(plan, bulk("bulk_update", []  , 0))).toBe("unknown");
	});

	test("narrows bulk candidates by row images and falls back to every anchored watcher without them", () => {
		const router = new RealtimeCandidateRouter<string>();
		router.add("a", compileRealtimeTopicRouting({ scopeId: "scope-a" }));
		router.add("b", compileRealtimeTopicRouting({ scopeId: "scope-b" }));
		router.add("c", compileRealtimeTopicRouting({ scopeId: "scope-c" }));
		const bulk = (rows?: Array<{ before: Record<string, string>; after: Record<string, string> }>): RealtimeChangeEvent => ({
			seq: 1,
			resourceType: "collection",
			resource: "items",
			operation: "bulk_update",
			payload: { count: 2, recordIds: ["x", "y"], ...(rows ? { rows } : {}) },
			createdAt: new Date(0),
		});

		// A move from scope-a to scope-b and an edit inside scope-b reach a and b, never c.
		expect([...router.candidates(bulk([
			{ before: { scopeId: "scope-a" }, after: { scopeId: "scope-b" } },
			{ before: { scopeId: "scope-b" }, after: { scopeId: "scope-b" } },
		]))].sort()).toEqual(["a", "b"]);
		expect([...router.candidates(bulk())].sort()).toEqual(["a", "b", "c"]);
	});
});
