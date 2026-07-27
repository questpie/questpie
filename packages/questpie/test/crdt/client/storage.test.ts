import { describe, expect, it } from "bun:test";

import { isCrdtPartitionBasisMonotonic } from "../../../src/client/crdt/storage.js";

describe("CRDT IndexedDB partition basis CAS", () => {
	it("allows only monotonic cursors and fenced field resets", () => {
		const current = basis();
		expect(
			isCrdtPartitionBasisMonotonic(current, basis({ fieldCursor: "2" }), [
				bundle(1),
			]),
		).toBe(true);
		expect(
			isCrdtPartitionBasisMonotonic(basis({ fieldCursor: "2" }), current, []),
		).toBe(false);
		expect(
			isCrdtPartitionBasisMonotonic(
				current,
				basis({ fieldEpoch: "2", fieldCursor: "0" }),
				[bundle(2)],
			),
		).toBe(true);
		expect(
			isCrdtPartitionBasisMonotonic(
				current,
				basis({ fieldEpoch: "2", fieldCursor: "0" }),
				[bundle(1)],
			),
		).toBe(false);
	});

	it("keeps old-schema bundles but fences aggregate-epoch changes", () => {
		expect(
			isCrdtPartitionBasisMonotonic(basis(), basis({ schemaVersion: 2 }), [
				bundle(1),
			]),
		).toBe(true);
		expect(
			isCrdtPartitionBasisMonotonic(basis(), basis({ aggregateEpoch: "2" }), [
				bundle(1),
			]),
		).toBe(false);
		expect(
			isCrdtPartitionBasisMonotonic(
				basis(),
				basis({ aggregateEpoch: "2" }),
				[],
			),
		).toBe(true);
	});
});

function bundle(fieldSlot: number) {
	return { parts: [{ fieldSlot }] };
}

function basis(
	overrides: Partial<{
		aggregateEpoch: string;
		schemaVersion: number;
		fieldEpoch: string;
		fieldCursor: string;
	}> = {},
) {
	return {
		aggregateEpoch: overrides.aggregateEpoch ?? "1",
		schemaVersion: overrides.schemaVersion ?? 1,
		fields: [
			{
				fieldSlot: 1,
				fieldEpoch: overrides.fieldEpoch ?? "1",
				fieldCursor: overrides.fieldCursor ?? "1",
			},
		],
		pending: [],
	};
}
