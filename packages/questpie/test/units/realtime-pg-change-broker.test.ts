import { describe, expect, spyOn, test } from "bun:test";

import { PgNotifyChangeBroker } from "../../src/server/modules/core/integrated/realtime/adapters/pg-notify.js";
import type {
	ChangeBrokerState,
	ChangeWake,
} from "../../src/server/modules/core/integrated/realtime/transport.js";

class FakePgClient {
	connectCalls = 0;
	endCalls = 0;
	queries: Array<{ text: string; params?: unknown[] }> = [];
	private handlers = new Map<string, Set<(...args: any[]) => void>>();

	async connect(): Promise<void> {
		this.connectCalls += 1;
	}

	async query(text: string, params?: unknown[]): Promise<void> {
		this.queries.push({ text, params });
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
}

class BlockingPublisherClient extends FakePgClient {
	private releaseNotify = () => {};
	private resolveNotifyStarted = () => {};
	readonly notifyStarted = new Promise<void>((resolve) => {
		this.resolveNotifyStarted = resolve;
	});

	override async query(text: string, params?: unknown[]): Promise<void> {
		this.queries.push({ text, params });
		if (!text.startsWith("select pg_notify")) return;
		this.resolveNotifyStarted();
		await new Promise<void>((resolve) => {
			this.releaseNotify = resolve;
		});
	}

	release(): void {
		this.releaseNotify();
	}
}

const topologyWake: ChangeWake = {
	kind: "topology-maybe-advanced",
	sessionKey: "sha256-session-key",
	ownerId: "owner-a",
	ownerGeneration: 12,
	desiredRevision: 4,
	reason: "submit",
};

describe("pg-notify change broker", () => {
	test("publishes and receives metadata-only topology wakes", async () => {
		const listener = new FakePgClient();
		const publisher = new FakePgClient();
		const wakes: ChangeWake[] = [];
		const states: ChangeBrokerState[] = [];
		const broker = new PgNotifyChangeBroker({
			client: listener as any,
			publisherClient: publisher as any,
		});

		await broker.start({
			onWake: (wake) => wakes.push(wake),
			onError: (error) => {
				throw error;
			},
			onStateChange: (state) => states.push(state),
		});
		await broker.publish({
			...topologyWake,
			token: "must-not-cross-the-broker",
			topics: [{ resource: "posts" }],
		} as ChangeWake);

		expect(listener.queries).toEqual([{ text: "LISTEN questpie_realtime_v2" }]);
		expect(publisher.queries).toEqual([
			{
				text: "select pg_notify($1, $2)",
				params: ["questpie_realtime_v2", JSON.stringify(topologyWake)],
			},
		]);
		expect(JSON.parse(String(publisher.queries[0]!.params![1]))).toEqual(
			topologyWake,
		);

		listener.emit("notification", {
			channel: "questpie_realtime_v2",
			payload: JSON.stringify(topologyWake),
		});
		expect(wakes).toEqual([topologyWake]);
		expect(states).toEqual(["connecting", "connected"]);

		await broker.stop();
		expect(states).toEqual(["connecting", "connected", "disconnected"]);
	});

	test("reports unavailable and reconnects the LISTEN connection", async () => {
		const listener = new FakePgClient();
		const publisher = new FakePgClient();
		const states: ChangeBrokerState[] = [];
		const errors: unknown[] = [];
		let reconnect: (() => void) | undefined;
		let resolveConnected = () => {};
		const connectedAgain = new Promise<void>((resolve) => {
			resolveConnected = resolve;
		});
		const timeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(
			(handler) => {
				reconnect = () => {
					if (typeof handler === "function") handler();
				};
				return 1 as unknown as ReturnType<typeof setTimeout>;
			},
		);
		const broker = new PgNotifyChangeBroker({
			client: listener as any,
			publisherClient: publisher as any,
		});

		try {
			await broker.start({
				onWake: () => {},
				onError: (error) => errors.push(error),
				onStateChange: (state) => {
					states.push(state);
					if (state === "connected" && states.includes("unavailable")) {
						resolveConnected();
					}
				},
			});
			listener.emit("error", new Error("listener lost"));
			expect(reconnect).toBeDefined();
			reconnect?.();
			await connectedAgain;

			expect(states).toEqual([
				"connecting",
				"connected",
				"unavailable",
				"connected",
			]);
			expect(errors).toHaveLength(1);
			expect(
				listener.queries.filter(({ text }) => text.startsWith("LISTEN")),
			).toHaveLength(2);
		} finally {
			timeoutSpy.mockRestore();
			await broker.stop();
		}
	});

	test("ignores payloads that are not valid ChangeWake metadata", async () => {
		const listener = new FakePgClient();
		const publisher = new FakePgClient();
		const wakes: ChangeWake[] = [];
		const errors: unknown[] = [];
		const broker = new PgNotifyChangeBroker({
			client: listener as any,
			publisherClient: publisher as any,
		});

		await broker.start({
			onWake: (wake) => wakes.push(wake),
			onError: (error) => errors.push(error),
		});
		listener.emit("notification", {
			channel: "questpie_realtime_v2",
			payload: JSON.stringify({
				kind: "topology-maybe-advanced",
				token: "must-not-cross-the-broker",
				topics: [{ resource: "posts" }],
			}),
		});

		expect(wakes).toEqual([]);
		expect(errors).toHaveLength(1);
		await broker.stop();
	});

	test("drains the active publish and cancels queued work on stop", async () => {
		const listener = new FakePgClient();
		const publisher = new BlockingPublisherClient();
		const errors: unknown[] = [];
		const broker = new PgNotifyChangeBroker({
			client: listener as any,
			publisherClient: publisher as any,
		});
		await broker.start({
			onWake: () => {},
			onError: (error) => errors.push(error),
		});

		const active = broker.publish(topologyWake);
		await publisher.notifyStarted;
		const queued = broker.publish({
			...topologyWake,
			desiredRevision: topologyWake.desiredRevision + 1,
		});
		const stopping = broker.stop();
		publisher.release();

		await active;
		await expect(queued).rejects.toThrow("stopping");
		await stopping;
		expect(
			publisher.queries.filter(({ text }) => text.startsWith("select pg_notify")),
		).toHaveLength(1);
	});
});
