import { describe, expect, it } from "bun:test";

import {
	classifyRealtimeDelivery,
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
		).toBe("insert");
		expect(
			deriveDeltaOp({ present: true, operation: "update", beforeMatch: true }),
		).toBe("update");
		expect(
			deriveDeltaOp({ present: true, operation: "update", beforeMatch: false }),
		).toBe("insert");
		expect(
			deriveDeltaOp({ present: false, operation: "update", beforeMatch: true }),
		).toBe("delete");
		expect(
			deriveDeltaOp({
				present: false,
				operation: "create",
				beforeMatch: false,
			}),
		).toBe("noop");
	});
});
