import { describe, expect, it } from "bun:test";

import {
	realtimeEventResolvesTxid,
	RealtimeTxidTracker,
} from "../../src/client/realtime/txid.js";
import { attachTxid } from "../../src/shared/txid.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("realtime txid reconciliation", () => {
	it("never resolves from an equal or older watermark", () => {
		const frame = (upToDate: string) => ({
			type: "up-to-date" as const,
			topicId: "posts",
			seq: 1,
			upToDate,
		});
		expect(realtimeEventResolvesTxid("42", frame("41"))).toBe(false);
		expect(realtimeEventResolvesTxid("42", frame("42"))).toBe(false);
		expect(realtimeEventResolvesTxid("42", frame("43"))).toBe(true);
	});

	it("resolves by exact delta txid even while the watermark is not newer", () => {
		expect(
			realtimeEventResolvesTxid("42", {
				type: "update",
				topicId: "posts",
				seq: 2,
				txid: "42",
				key: "post-1",
				row: { id: "post-1" },
			}),
		).toBe(true);
	});

	it("keeps a pending tx open until a strictly newer watermark arrives", async () => {
		const tracker = new RealtimeTxidTracker();
		let settled = false;
		const pending = tracker.awaitTxId("42").then(() => {
			settled = true;
		});
		tracker.observe({
			type: "up-to-date",
			topicId: "posts",
			seq: 1,
			upToDate: "42",
		});
		await tick();
		expect(settled).toBe(false);

		tracker.observe({
			type: "up-to-date",
			topicId: "posts",
			seq: 2,
			upToDate: "43",
		});
		await pending;
		expect(settled).toBe(true);
	});

	it("waits for every active topic instead of resolving from an unrelated one", async () => {
		const tracker = new RealtimeTxidTracker();
		const posts = tracker.registerTopic();
		const unrelated = tracker.registerTopic();
		let settled = false;
		const pending = tracker.awaitTxId("42").then(() => {
			settled = true;
		});

		tracker.observe(
			{
				type: "up-to-date",
				topicId: "unrelated",
				seq: 1,
				upToDate: "43",
			},
			unrelated,
		);
		await tick();
		expect(settled).toBe(false);

		tracker.observe(
			{
				type: "up-to-date",
				topicId: "posts",
				seq: 2,
				upToDate: "43",
			},
			posts,
		);
		await pending;
		expect(settled).toBe(true);
	});

	it("rejects instead of falsely resolving when its last required topic is removed", async () => {
		const tracker = new RealtimeTxidTracker();
		const posts = tracker.registerTopic();
		const pending = tracker.awaitTxId("42");

		tracker.unregisterTopic(posts);

		await expect(pending).rejects.toThrow(
			"Realtime txid topic was removed before reconciliation",
		);
	});

	it("binds a waiter created before the first topic to that topic's watermark", async () => {
		const tracker = new RealtimeTxidTracker();
		const controller = new AbortController();
		const pending = tracker
			.awaitTxId("42", controller.signal)
			.then(() => "resolved" as const)
			.catch(() => "rejected" as const);

		const posts = tracker.registerTopic();
		tracker.observe(
			{
				type: "up-to-date",
				topicId: "posts",
				seq: 1,
				upToDate: "43",
			},
			posts,
		);

		const outcome = await Promise.race([
			pending,
			new Promise<"pending">((resolve) =>
				setTimeout(() => resolve("pending"), 20),
			),
		]);
		if (outcome === "pending") controller.abort();
		expect(outcome).toBe("resolved");
	});

	it("extracts mutation txids and remembers an early exact frame", async () => {
		const tracker = new RealtimeTxidTracker();
		tracker.observe({
			type: "delete",
			topicId: "posts",
			seq: 3,
			txid: "51",
			key: "post-1",
		});
		const result = attachTxid({ success: true }, "51");
		await expect(tracker.awaitMutation(result)).resolves.toBeUndefined();
	});
});
