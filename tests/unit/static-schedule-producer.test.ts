import { expect, test } from "bun:test";

import { createStaticScheduleProducer } from "../../packages/runtime/src/durable/schedule/producer";

test("worker producer joins overlapping polls and drain cancels its current transaction", async () => {
	let calls = 0;
	let signal: AbortSignal | undefined;
	const entered = Promise.withResolvers<void>();
	const producer = createStaticScheduleProducer({
		signal: new AbortController().signal,
		reconcile: (request) => {
			calls++;
			signal = request.signal;
			entered.resolve();
			return new Promise((_, reject) =>
				request.signal.addEventListener(
					"abort",
					() => reject(request.signal.reason),
					{ once: true },
				),
			);
		},
	});
	const first = producer.poll();
	await entered.promise;
	const second = producer.poll();
	expect(calls).toBe(1);
	producer.beginDrain();
	expect(signal!.aborted).toBe(true);
	expect(await first).toEqual({ status: "draining" });
	expect(await second).toEqual({ status: "draining" });
	expect(await producer.poll()).toEqual({ status: "draining" });
	expect(calls).toBe(1);
});

test("producer failure is safe operational data and the next ordinary poll can reconcile", async () => {
	let calls = 0;
	const producer = createStaticScheduleProducer({
		signal: new AbortController().signal,
		reconcile: async () => {
			if (++calls === 1) throw new Error("secret Context or SQL exception");
			return { status: "active", accepted: 1, examined: 2 };
		},
	});
	expect(await producer.poll()).toEqual({
		status: "failed",
		code: "SCHEDULE_PRODUCER_FAILED",
	});
	expect(await producer.poll()).toEqual({
		status: "active",
		accepted: 1,
		examined: 2,
	});
});

test("Runtime root cancellation stops producer work without activation", async () => {
	const root = new AbortController();
	root.abort(new Error("closed"));
	let called = false;
	const producer = createStaticScheduleProducer({
		signal: root.signal,
		reconcile: async () => {
			called = true;
			return { status: "inactive", accepted: 0, examined: 0 };
		},
	});
	expect(await producer.poll()).toEqual({ status: "draining" });
	expect(called).toBe(false);
});

test("producer outcome projection strips extra data and rejects invalid counts", async () => {
	let invalid = false;
	const producer = createStaticScheduleProducer({
		signal: new AbortController().signal,
		reconcile: async () => ({
			status: "active",
			accepted: invalid ? 65 : 1,
			examined: 1,
			secret: "not operational data",
		}),
	});
	expect(await producer.poll()).toEqual({
		status: "active",
		accepted: 1,
		examined: 1,
	});
	invalid = true;
	expect(await producer.poll()).toEqual({
		status: "failed",
		code: "SCHEDULE_PRODUCER_FAILED",
	});
});
