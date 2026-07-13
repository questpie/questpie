import { describe, expect, spyOn, test } from "bun:test";

import { PgNotifyAdapter } from "../../src/server/modules/core/integrated/realtime/adapters/pg-notify.js";

class FakePgClient {
	connectCalls = 0;
	connectOutcomes: Array<"ok" | Error> = [];
	endCalls = 0;
	queryOutcomes: Array<"ok" | Error> = [];
	queries: Array<{ text: string; params?: unknown[] }> = [];
	private handlers = new Map<string, Set<(...args: any[]) => void>>();

	async connect(): Promise<void> {
		this.connectCalls += 1;
		const outcome = this.connectOutcomes.shift();
		if (outcome instanceof Error) throw outcome;
	}

	async query(text: string, params?: unknown[]): Promise<void> {
		this.queries.push({ text, params });
		const outcome = this.queryOutcomes.shift();
		if (outcome instanceof Error) throw outcome;
	}

	on(event: string, handler: (...args: any[]) => void): this {
		const handlers = this.handlers.get(event) ?? new Set();
		handlers.add(handler);
		this.handlers.set(event, handlers);
		return this;
	}

	off(event: string, handler: (...args: any[]) => void): this {
		this.handlers.get(event)?.delete(handler);
		return this;
	}

	async end(): Promise<void> {
		this.endCalls += 1;
	}

	emit(event: string, ...args: any[]): void {
		for (const handler of this.handlers.get(event) ?? []) handler(...args);
	}

	listenerCount(event: string): number {
		return this.handlers.get(event)?.size ?? 0;
	}
}

describe("pg-notify adapter", () => {
	test("uses a dedicated listener connection and separate publisher", async () => {
		const listener = new FakePgClient();
		const publisher = new FakePgClient();
		const adapter = new PgNotifyAdapter({
			client: listener as any,
			publisherClient: publisher as any,
		} as any);

		await adapter.startPublisher();
		await adapter.start();
		await adapter.notify({
			seq: 1,
			resourceType: "collection",
			resource: "posts",
			operation: "update",
			createdAt: new Date("2026-07-13T20:00:00.000Z"),
		});

		expect(listener.queries).toEqual([{ text: "LISTEN questpie_realtime" }]);
		expect(publisher.queries).toEqual([
			{
				text: "select pg_notify($1, $2)",
				params: [
					"questpie_realtime",
					JSON.stringify({
						seq: 1,
						resourceType: "collection",
						resource: "posts",
						operation: "update",
					}),
				],
			},
		]);
	});

	test("rejects and reports notices at the PostgreSQL 8KB limit", async () => {
		const publisher = new FakePgClient();
		const errors: unknown[] = [];
		const adapter = new PgNotifyAdapter({
			publisherClient: publisher as any,
			onError: (error: unknown) => errors.push(error),
		});

		const result = adapter.notify({
			seq: 1,
			resourceType: "collection",
			resource: "x".repeat(8_000),
			operation: "update",
			createdAt: new Date("2026-07-13T20:00:00.000Z"),
		});

		await expect(result).rejects.toThrow("must be smaller than 8000 bytes");
		expect(publisher.queries).toEqual([]);
		expect(errors).toHaveLength(1);
	});

	test("reconnects, re-LISTENs, and signals connected after error/end", async () => {
		const listener = new FakePgClient();
		const publisher = new FakePgClient();
		const errors: unknown[] = [];
		let triggerReconnect: (() => void) | undefined;
		let markReconnected = () => {};
		const reconnected = new Promise<void>((resolve) => {
			markReconnected = resolve;
		});
		const timeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(
			(handler, delay) => {
				expect(delay).toBe(100);
				triggerReconnect = () => {
					if (typeof handler === "function") handler();
				};
				return 1 as unknown as ReturnType<typeof setTimeout>;
			},
		);
		const adapter = new PgNotifyAdapter({
			client: listener as any,
			publisherClient: publisher as any,
			reconnectInitialDelayMs: 100,
			reconnectMaxDelayMs: 1_000,
			onError: (error) => errors.push(error),
		});
		const states: string[] = [];

		try {
			const unsubscribeState = adapter.onStateChange((state) => {
				states.push(state);
				if (state === "connected" && states.includes("disconnected")) {
					markReconnected();
				}
			});
			await adapter.start();
			expect(listener.listenerCount("error")).toBe(1);
			expect(listener.listenerCount("end")).toBe(1);

			listener.emit("error", new Error("connection lost"));
			listener.emit("end");
			expect(triggerReconnect).toBeDefined();
			triggerReconnect?.();
			await reconnected;

			expect(
				listener.queries.filter((query) => query.text.startsWith("LISTEN")),
			).toHaveLength(2);
			expect(states).toEqual(["connected", "disconnected", "connected"]);
			expect(errors).toHaveLength(1);
			unsubscribeState();
		} finally {
			timeoutSpy.mockRestore();
			await adapter.stop();
		}
	});

	test("backs off failed reconnects and caps the delay", async () => {
		const listener = new FakePgClient();
		const publisher = new FakePgClient();
		const delays: number[] = [];
		const reconnects: Array<() => void> = [];
		let markSecondScheduled = () => {};
		let markThirdScheduled = () => {};
		const secondScheduled = new Promise<void>((resolve) => {
			markSecondScheduled = resolve;
		});
		const thirdScheduled = new Promise<void>((resolve) => {
			markThirdScheduled = resolve;
		});
		const timeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(
			(handler, delay) => {
				delays.push(Number(delay));
				reconnects.push(() => {
					if (typeof handler === "function") handler();
				});
				if (delays.length === 2) markSecondScheduled();
				if (delays.length === 3) markThirdScheduled();
				return delays.length as unknown as ReturnType<typeof setTimeout>;
			},
		);
		const adapter = new PgNotifyAdapter({
			client: listener as any,
			publisherClient: publisher as any,
			reconnectInitialDelayMs: 100,
			reconnectMaxDelayMs: 250,
			onError: () => {},
		});
		let disconnected = false;
		let markReconnected = () => {};
		const reconnected = new Promise<void>((resolve) => {
			markReconnected = resolve;
		});
		adapter.onStateChange((state) => {
			if (state === "disconnected") disconnected = true;
			if (state === "connected" && disconnected) markReconnected();
		});

		try {
			await adapter.start();
			listener.connectOutcomes.push(
				new Error("retry one"),
				new Error("retry two"),
				"ok",
			);
			listener.emit("end");

			reconnects[0]!();
			await secondScheduled;
			reconnects[1]!();
			await thirdScheduled;
			reconnects[2]!();
			await reconnected;

			expect(delays).toEqual([100, 200, 250]);
			expect(listener.connectCalls).toBe(4);
		} finally {
			timeoutSpy.mockRestore();
			await adapter.stop();
		}
	});

	test("rate-limits publisher failure reports while preserving rejection", async () => {
		const publisher = new FakePgClient();
		publisher.queryOutcomes.push(
			new Error("publisher unavailable"),
			new Error("publisher unavailable"),
		);
		const errors: unknown[] = [];
		const adapter = new PgNotifyAdapter({
			publisherClient: publisher as any,
			onError: (error) => errors.push(error),
			errorLogIntervalMs: 30_000,
		});
		const change = {
			seq: 1,
			resourceType: "collection" as const,
			resource: "posts",
			operation: "update" as const,
			createdAt: new Date("2026-07-13T20:00:00.000Z"),
		};

		await expect(adapter.notify(change)).rejects.toThrow(
			"publisher unavailable",
		);
		await expect(adapter.notify(change)).rejects.toThrow(
			"publisher unavailable",
		);
		expect(errors).toHaveLength(1);
	});

	test("handles idle publisher disconnects and reconnects on the next notify", async () => {
		const publisher = new FakePgClient();
		const adapter = new PgNotifyAdapter({
			publisherClient: publisher as any,
			onError: () => {},
		});
		await adapter.startPublisher();

		expect(publisher.listenerCount("error")).toBe(1);
		expect(publisher.listenerCount("end")).toBe(1);
		publisher.emit("error", new Error("publisher connection lost"));
		publisher.emit("end");
		await adapter.notify({
			seq: 2,
			resourceType: "collection",
			resource: "posts",
			operation: "create",
			createdAt: new Date("2026-07-13T20:00:00.000Z"),
		});

		expect(publisher.connectCalls).toBe(2);
		expect(
			publisher.queries.filter((query) => query.text.includes("pg_notify")),
		).toHaveLength(1);
	});
});
