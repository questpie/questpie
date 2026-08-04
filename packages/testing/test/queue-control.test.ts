import { describe, expect, it } from "bun:test";

import {
	createEvidence,
	drainQueue,
	QueueDrainError,
} from "../src/scenario.js";

/*
 * UC-TEST-021, 022, 024. The drain is a generic lever: the caller says what to
 * count, so nothing here names a queue, an adapter or a channel.
 */

function counts(values: readonly number[]): () => number {
	let index = 0;
	return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

describe("UC-TEST-021 deterministic-queue-drain", () => {
	it("returns once the queue has been quiet for several consecutive polls", async () => {
		const result = await drainQueue({
			pending: counts([3, 1, 0, 0, 0]),
			pollIntervalMs: 1,
			quietPolls: 3,
		});

		expect(result.polls).toBe(5);
		expect(result.lastPending).toBe(0);
	});

	it("does not settle on the first zero, because a follow-up job reads as empty in the gap", async () => {
		// Zero, then work appears again: a job enqueued its successor.
		const result = await drainQueue({
			pending: counts([0, 2, 0, 0, 0]),
			pollIntervalMs: 1,
			quietPolls: 3,
		});

		expect(result.polls).toBe(5);
		expect(result.observed).toEqual([0, 2, 0, 0, 0]);
	});

	it("accepts an async probe", async () => {
		const result = await drainQueue({
			pending: async () => 0,
			pollIntervalMs: 1,
			quietPolls: 2,
		});

		expect(result.lastPending).toBe(0);
	});

	it("requires at least one quiet poll", () => {
		expect(() => drainQueue({ pending: () => 0, quietPolls: 0 })).toThrow(
			TypeError,
		);
	});
});

describe("UC-TEST-022 bounded-queue-drain-failure", () => {
	it("fails on a bounded timeout naming the last count it saw", async () => {
		try {
			await drainQueue({
				pending: () => 7,
				pollIntervalMs: 1,
				timeoutMs: 30,
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(QueueDrainError);
			expect((error as QueueDrainError).lastPending).toBe(7);
			expect((error as QueueDrainError).message).toContain("7");
		}
	});

	it("fails with the cause when the probe itself throws", async () => {
		const failure = new Error("adapter is not connected");

		await expect(
			drainQueue({
				pending: () => {
					throw failure;
				},
				pollIntervalMs: 1,
				timeoutMs: 30,
			}),
		).rejects.toThrow("adapter is not connected");
	});

	it("rejects a negative count rather than treating it as quiet", async () => {
		await expect(
			drainQueue({ pending: () => -1, pollIntervalMs: 1, timeoutMs: 30 }),
		).rejects.toThrow(TypeError);
	});
});

describe("UC-TEST-024 fault-controls-carry-evidence", () => {
	it("records the counts it saw", async () => {
		const evidence = createEvidence({});
		await drainQueue({
			pending: counts([2, 0, 0]),
			pollIntervalMs: 1,
			quietPolls: 2,
			evidence,
		});

		const log = evidence.tail().join("\n");
		expect(log).toContain("pending=2");
		expect(log).toContain("drained");
	});

	it("records the counts it saw before giving up", async () => {
		const evidence = createEvidence({});
		await drainQueue({
			pending: () => 4,
			pollIntervalMs: 1,
			timeoutMs: 20,
			evidence,
		}).catch(() => undefined);

		expect(evidence.tail().join("\n")).toContain("pending=4");
	});
});
