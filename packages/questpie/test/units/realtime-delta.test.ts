import { describe, expect, it } from "bun:test";

import {
	classifyRealtimeDelivery,
	classifyRealtimeDeliveryDecision,
	deriveDeltaOp,
	whereReferencesRelations,
} from "../../src/server/modules/core/integrated/realtime/delta.js";

describe("realtime delta delivery", () => {
	it("requires an explicit opt-in and the unwindowed own-column find shape", () => {
		const eligible = {
			resourceType: "collection" as const,
			operation: "find" as const,
			where: { AND: [{ status: { eq: "open" } }, { priority: { gte: 2 } }] },
		};

		expect(classifyRealtimeDelivery(eligible, new Set(["author"]))).toBe(
			"snapshot",
		);
		expect(
			classifyRealtimeDelivery(
				{ ...eligible, mode: "delta" },
				new Set(["author"]),
			),
		).toBe("delta");

		for (const topic of [
			{ ...eligible, mode: "delta" as const, limit: 10 },
			{ ...eligible, mode: "delta" as const, offset: 1 },
			{ ...eligible, mode: "delta" as const, orderBy: { id: "asc" } },
			{ ...eligible, mode: "delta" as const, with: { author: true } },
			{ ...eligible, mode: "delta" as const, columns: { id: false } },
			{
				...eligible,
				mode: "delta" as const,
				where: { author: { name: { eq: "Ada" } } },
			},
			{
				...eligible,
				mode: "delta" as const,
				where: { RAW: "status = 'open'" },
			},
		]) {
			expect(classifyRealtimeDelivery(topic, new Set(["author"]))).toBe(
				"snapshot",
			);
		}
	});

	it("reports one stable machine-readable classification reason", () => {
		const base = {
			mode: "delta" as const,
			resourceType: "collection" as const,
			operation: "find" as const,
		};
		expect(classifyRealtimeDeliveryDecision(base)).toEqual({
			mode: "delta",
			reason: "eligible",
		});
		expect(
			classifyRealtimeDeliveryDecision(
				{ ...base, where: { author: { eq: "user-a" } } },
				new Set(["author"]),
			),
		).toEqual({ mode: "snapshot", reason: "relation_where" });
		expect(
			classifyRealtimeDeliveryDecision({
				...base,
				where: { RAW: "opaque" },
			}),
		).toEqual({ mode: "snapshot", reason: "raw_where" });
		expect(classifyRealtimeDeliveryDecision({ ...base, limit: 10 })).toEqual({
			mode: "snapshot",
			reason: "limit",
		});
		expect(
			classifyRealtimeDeliveryDecision({ ...base, orderBy: { id: "asc" } }),
		).toEqual({ mode: "snapshot", reason: "order_by" });
		expect(
			classifyRealtimeDeliveryDecision({ ...base, with: { author: true } }),
		).toEqual({ mode: "snapshot", reason: "with" });
	});

	it("walks logical where branches using relation metadata", () => {
		expect(
			whereReferencesRelations(
				{ OR: [{ status: "open" }, { author: { id: "user-1" } }] },
				new Set(["author"]),
			),
		).toBe(true);
		expect(
			whereReferencesRelations(
				{ OR: [{ status: "open" }, { authorId: "user-1" }] },
				new Set(["author"]),
			),
		).toBe(false);
	});

	it("derives idempotent keyed operations from authoritative hydration", () => {
		expect(
			deriveDeltaOp({ present: true, operation: "create", beforeMatch: false }),
		).toEqual({ op: "insert" });
		expect(
			deriveDeltaOp({ present: true, operation: "update", beforeMatch: true }),
		).toEqual({ op: "update" });
		expect(
			deriveDeltaOp({ present: true, operation: "update", beforeMatch: false }),
		).toEqual({ op: "insert" });
		expect(
			deriveDeltaOp({ present: false, operation: "update", beforeMatch: true }),
		).toMatchObject({ op: "delete" });
		expect(
			deriveDeltaOp({
				present: false,
				operation: "create",
				beforeMatch: false,
			}),
		).toEqual({ op: "noop" });
	});

	it("separates a removed row from one that only left the predicate", () => {
		const removed = { present: false, beforeMatch: true } as const;

		for (const operation of ["delete", "bulk_delete"] as const) {
			expect(deriveDeltaOp({ ...removed, operation })).toEqual({
				op: "delete",
				reason: "deleted",
			});
		}
		for (const operation of ["update", "bulk_update"] as const) {
			expect(deriveDeltaOp({ ...removed, operation })).toEqual({
				op: "delete",
				reason: "left_predicate",
			});
		}

		// One hydration answers for the whole batch, so a delete anywhere in it
		// outranks an earlier predicate exit for the same key.
		expect(
			deriveDeltaOp({ ...removed, operation: "update", deletedInBatch: true }),
		).toEqual({ op: "delete", reason: "deleted" });
	});
});
