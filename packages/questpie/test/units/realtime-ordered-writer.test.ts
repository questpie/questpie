import { describe, expect, it } from "bun:test";

import { BoundedOrderedFifoWriter } from "../../src/server/modules/core/integrated/realtime/ordered-fifo-writer.js";

describe("realtime bounded ordered FIFO writer", () => {
	it("retains every frame in FIFO order across backpressure", async () => {
		const accepted: string[] = [];
		let busy = true;
		const writer = new BoundedOrderedFifoWriter<string>({
			maximumItems: 4,
			maximumBytes: 32,
			busyRetryMs: 60_000,
			byteLength: (value) => value.length,
			write: async (value) => {
				if (busy) return { status: "busy", bufferedBytes: 0 };
				accepted.push(value);
				return { status: "accepted", bufferedBytes: 0 };
			},
		});

		expect(writer.enqueue("first")).toBe(true);
		expect(writer.enqueue("second")).toBe(true);
		expect(writer.enqueue("third")).toBe(true);
		expect(await writer.flush()).toBe("busy");
		expect(writer.length).toBe(3);

		busy = false;
		expect(await writer.flush()).toBe("drained");
		expect(accepted).toEqual(["first", "second", "third"]);
		expect(writer.bufferedBytes).toBe(0);
		writer.clear();
	});

	it("overflows coherently against queued and transport bytes", async () => {
		let overflows = 0;
		const writer = new BoundedOrderedFifoWriter<Uint8Array>({
			maximumItems: 4,
			maximumBytes: 16,
			busyRetryMs: 60_000,
			byteLength: (value) => value.byteLength,
			write: async () => ({ status: "busy", bufferedBytes: 8 }),
			onOverflow: () => {
				overflows += 1;
			},
		});

		expect(writer.enqueue(new Uint8Array(9))).toBe(true);
		expect(await writer.flush()).toBe("overflow");
		expect(overflows).toBe(1);
		expect(writer.closed).toBe(true);
	});

	it("enforces both item and byte caps before enqueue", () => {
		let overflows = 0;
		const writer = new BoundedOrderedFifoWriter<Uint8Array>({
			maximumItems: 2,
			maximumBytes: 8,
			busyRetryMs: 60_000,
			byteLength: (value) => value.byteLength,
			write: async () => ({ status: "accepted", bufferedBytes: 0 }),
			onOverflow: () => {
				overflows += 1;
			},
		});

		expect(writer.enqueue(new Uint8Array(4))).toBe(true);
		expect(writer.enqueue(new Uint8Array(4))).toBe(true);
		expect(writer.enqueue(new Uint8Array(0))).toBe(false);
		expect(overflows).toBe(1);
	});

	it("reports retry failures instead of leaking an unhandled rejection", async () => {
		const failure = new Error("sink failed after backpressure");
		let writes = 0;
		const errors: unknown[] = [];
		const writer = new BoundedOrderedFifoWriter<Uint8Array>({
			maximumItems: 2,
			maximumBytes: 8,
			busyRetryMs: 1,
			byteLength: (value) => value.byteLength,
			write: async () => {
				writes += 1;
				if (writes === 1) return { status: "busy", bufferedBytes: 0 };
				throw failure;
			},
			onError: (error) => errors.push(error),
		});

		writer.enqueue(new Uint8Array(1));
		expect(await writer.flush()).toBe("busy");
		await Bun.sleep(10);

		expect(errors).toEqual([failure]);
		writer.clear();
	});

	it("notifies its adapter after a retry drains the queue", async () => {
		let busy = true;
		let retryDrained = 0;
		const writer = new BoundedOrderedFifoWriter<Uint8Array>({
			maximumItems: 2,
			maximumBytes: 8,
			busyRetryMs: 1,
			byteLength: (value) => value.byteLength,
			write: async () => {
				if (busy) {
					busy = false;
					return { status: "busy", bufferedBytes: 0 };
				}
				return { status: "accepted", bufferedBytes: 0 };
			},
			onRetryDrained: () => {
				retryDrained += 1;
			},
		});

		writer.enqueue(new Uint8Array(1));
		expect(await writer.flush()).toBe("busy");
		await Bun.sleep(10);

		expect(retryDrained).toBe(1);
		expect(writer.length).toBe(0);
		writer.clear();
	});
});
