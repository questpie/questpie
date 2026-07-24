import { describe, expect, it } from "bun:test";

import { CoreNoticeRouter } from "../../src/server/modules/core/integrated/collaboration/notice-router.js";
import {
	type ChangeBroker,
	normalizeChangeWake,
} from "../../src/server/modules/core/integrated/realtime/transport.js";

type ChangeBrokerStartInput = Parameters<ChangeBroker["start"]>[0];

class Broker implements ChangeBroker {
	private input?: ChangeBrokerStartInput;

	async start(input: ChangeBrokerStartInput): Promise<void> {
		this.input = input;
	}

	async publish(): Promise<void> {}

	async stop(): Promise<void> {
		this.input = undefined;
	}

	wake(value: unknown): void {
		const wake = normalizeChangeWake(value);
		if (wake) this.input?.onWake(wake);
	}
}

describe("realtime and CRDT notice compatibility", () => {
	it("keeps the existing realtime wake union additive and cross-delivery free", async () => {
		const broker = new Broker();
		const router = new CoreNoticeRouter(broker);
		const realtime: string[] = [];
		const crdt: string[] = [];
		const releaseRealtime = await router.subscribe({
			kind: "realtime",
			onNotice: (notice) => realtime.push(notice.wake.kind),
		});
		const releaseCrdt = await router.subscribe({
			kind: "crdt",
			onNotice: (notice) => crdt.push(notice.wake.kind),
		});

		broker.wake({
			kind: "outbox-maybe-advanced",
			highWaterSeq: 4,
			reason: "publish",
		});
		broker.wake({
			kind: "crdt",
			aggregateHash: "a".repeat(64),
			aggregateEpoch: 1,
			head: 2,
			fenceGeneration: 3,
			reason: "publish",
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(realtime).toEqual(["outbox-maybe-advanced"]);
		expect(crdt).toEqual(["crdt"]);
		await releaseCrdt();
		await releaseRealtime();
	});
});
