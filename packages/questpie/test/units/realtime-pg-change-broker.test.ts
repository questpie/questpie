import { describe, expect, spyOn, test } from "bun:test";

import {
	PgNotifyChangeBroker,
	PgNotifyEphemeralBroker,
} from "../../src/server/modules/core/integrated/realtime/adapters/pg-notify.js";
import { RealtimeService } from "../../src/server/modules/core/integrated/realtime/service.js";
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

class BlockingReconnectClient extends FakePgClient {
	private releaseReconnect = () => {};
	private resolveReconnectStarted = () => {};
	readonly reconnectStarted = new Promise<void>((resolve) => {
		this.resolveReconnectStarted = resolve;
	});

	override async connect(): Promise<void> {
		this.connectCalls += 1;
		if (this.connectCalls !== 2) return;
		this.resolveReconnectStarted();
		await new Promise<void>((resolve) => {
			this.releaseReconnect = resolve;
		});
	}

	release(): void {
		this.releaseReconnect();
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

	test("batches a concurrent burst in one autocommit without changing wake payloads", async () => {
		const publisher = new FakePgClient();
		const broker = new PgNotifyChangeBroker({
			client: new FakePgClient() as any,
			publisherClient: publisher as any,
		});
		await broker.start({ onWake: () => {}, onError: () => {} });
		const wakes = Array.from({ length: 50 }, (_, desiredRevision) => ({
			...topologyWake,
			desiredRevision,
		}));
		await Promise.all(wakes.map((wake) => broker.publish(wake)));
		expect(publisher.queries).toEqual([
			{
				text: "select pg_notify($1, message) from unnest($2::text[]) as message",
				params: [
					"questpie_realtime_v2",
					wakes.map((wake) => JSON.stringify(wake)),
				],
			},
		]);
		await broker.stop();
	});

	test("rejects every caller of a failed batch and admits a later publish", async () => {
		const publisher = new FakePgClient();
		const query = spyOn(publisher, "query").mockRejectedValueOnce(
			new Error("batch failed"),
		);
		const broker = new PgNotifyChangeBroker({
			client: new FakePgClient() as any,
			publisherClient: publisher as any,
		});
		await broker.start({
			onWake: () => {},
			onError: () => {
				throw new Error("observer failed");
			},
		});
		const outcomes = await Promise.allSettled(
			Array.from({ length: 10 }, () => broker.publish(topologyWake)),
		);
		expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(
			true,
		);
		expect(query).toHaveBeenCalledTimes(1);
		await broker.publish(topologyWake);
		expect(query).toHaveBeenCalledTimes(2);
		await broker.stop();
	});

	test("bounds admission during a stalled batch and drains accumulated work in one query", async () => {
		const publisher = new FakePgClient();
		let release!: () => void;
		let started!: () => void;
		const queryStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const query = spyOn(publisher, "query").mockImplementationOnce(async () => {
			started();
			await blocked;
		});
		const broker = new PgNotifyChangeBroker({
			client: new FakePgClient() as any,
			publisherClient: publisher as any,
		});
		await broker.start({ onWake: () => {}, onError: () => {} });
		const active = broker.publish(topologyWake);
		await queryStarted;
		const queued = Array.from({ length: 255 }, () =>
			broker.publish(topologyWake),
		);
		await expect(broker.publish(topologyWake)).rejects.toThrow("queue is full");
		expect(query).toHaveBeenCalledTimes(1);
		release();
		await Promise.all([active, ...queued]);
		expect(query).toHaveBeenCalledTimes(2);
		expect(query.mock.calls[1]![1]![1]).toHaveLength(255);
		await broker.stop();
	});

	test("folds queued re-read wakes per log without joining a notice already sent", async () => {
		const publisher = new FakePgClient();
		let release!: () => void;
		let started!: () => void;
		const queryStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const query = spyOn(publisher, "query").mockImplementationOnce(async () => {
			started();
			await blocked;
		});
		const broker = new PgNotifyChangeBroker({
			client: new FakePgClient() as any,
			publisherClient: publisher as any,
		});
		await broker.start({ onWake: () => {}, onError: () => {} });
		// Normalized key order, so payloads compare as sent.
		const outbox = (highWaterSeq: number): ChangeWake => ({
			kind: "outbox-maybe-advanced",
			reason: "publish",
			highWaterSeq,
		});
		const channelEvents = (channelHash: string, seq: number): ChangeWake => ({
			kind: "channel-events-maybe-advanced",
			reason: "publish",
			channelHash,
			highWaterEventId: `${channelHash}:${seq}`,
		});
		const roomA = "a".repeat(64);
		const roomB = "b".repeat(64);

		// The notice on the wire may predate the commits behind the wakes below,
		// so they queue behind it instead of joining it.
		const active = broker.publish(outbox(1));
		await queryStarted;
		const queued = [
			broker.publish(outbox(2)),
			broker.publish(channelEvents(roomA, 1)),
			broker.publish(outbox(3)),
			broker.publish(channelEvents(roomB, 1)),
			broker.publish(channelEvents(roomA, 2)),
			broker.publish(topologyWake),
			broker.publish({ ...topologyWake, desiredRevision: 5 }),
			broker.publish(outbox(4)),
		];
		release();
		await Promise.all([active, ...queued]);

		expect(query).toHaveBeenCalledTimes(2);
		expect(query.mock.calls[0]![1]).toEqual([
			"questpie_realtime_v2",
			JSON.stringify(outbox(1)),
		]);
		expect(query.mock.calls[1]![1]).toEqual([
			"questpie_realtime_v2",
			[
				JSON.stringify(outbox(2)),
				JSON.stringify(channelEvents(roomA, 1)),
				JSON.stringify(channelEvents(roomB, 1)),
				JSON.stringify(topologyWake),
				JSON.stringify({ ...topologyWake, desiredRevision: 5 }),
			],
		]);

		await broker.publish(outbox(5));
		expect(query).toHaveBeenCalledTimes(3);
		await broker.stop();
	});

	test("rejects every caller folded into a failed notice", async () => {
		const publisher = new FakePgClient();
		const query = spyOn(publisher, "query").mockRejectedValueOnce(
			new Error("notice failed"),
		);
		const broker = new PgNotifyChangeBroker({
			client: new FakePgClient() as any,
			publisherClient: publisher as any,
		});
		await broker.start({ onWake: () => {}, onError: () => {} });
		const outcomes = await Promise.allSettled(
			Array.from({ length: 10 }, (_, highWaterSeq) =>
				broker.publish({
					kind: "outbox-maybe-advanced",
					highWaterSeq,
					reason: "publish",
				}),
			),
		);

		expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(
			true,
		);
		expect(query).toHaveBeenCalledTimes(1);
		expect(query.mock.calls[0]![0]).toBe("select pg_notify($1, $2)");
		await broker.stop();
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

	test("awaits an in-flight LISTEN reconnect before shutdown completes", async () => {
		const listener = new BlockingReconnectClient();
		const publisher = new FakePgClient();
		const states: ChangeBrokerState[] = [];
		let reconnect: (() => void) | undefined;
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
				onError: () => {},
				onStateChange: (state) => states.push(state),
			});
			listener.emit("error", new Error("listener lost"));
			reconnect?.();
			await listener.reconnectStarted;

			let stopped = false;
			const stopping = broker.stop().then(() => {
				stopped = true;
			});
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
			expect(stopped).toBe(false);

			listener.release();
			await stopping;
			expect(
				listener.queries.filter(({ text }) => text.startsWith("LISTEN")),
			).toHaveLength(1);
			expect(states).toEqual([
				"connecting",
				"connected",
				"unavailable",
				"disconnected",
			]);
		} finally {
			listener.release();
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
			publisher.queries.filter(({ text }) =>
				text.startsWith("select pg_notify"),
			),
		).toHaveLength(1);
	});

	test("rejects non-positive connection timeouts and health check intervals", () => {
		for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(
				() => new PgNotifyChangeBroker({ connectionTimeoutMs: value }),
			).toThrow("connectionTimeoutMs must be a positive number");
			expect(
				() => new PgNotifyChangeBroker({ healthCheckIntervalMs: value }),
			).toThrow("healthCheckIntervalMs must be a positive number");
		}
	});
});

describe("pg-notify ephemeral broker", () => {
	test("hands packets over as published and reports failures to onError", async () => {
		const listener = new FakePgClient();
		const errors: unknown[] = [];
		const broker = new PgNotifyEphemeralBroker({
			connectionString: "postgres://unused",
			onError: (error) => errors.push(error),
		});
		const driver = (broker as any).driver;
		driver.listenerClient = listener;
		driver.ownsListenerClient = false;
		const messages: string[] = [];
		const disconnects: unknown[] = [];
		await broker.start(
			(message) => messages.push(message),
			(error) => disconnects.push(error),
		);

		// A parse and re-serialize would normalize this spacing; the ephemeral
		// runtime decodes each packet exactly once.
		const packet = '{"channel": "presence-room", "entries": [ {"json": 1} ]}';
		listener.emit("notification", {
			channel: "questpie_ephemeral_v1",
			payload: packet,
		});
		expect(messages).toEqual([packet]);

		const consoleError = spyOn(console, "error").mockImplementation(() => {});
		try {
			listener.emit("error", new Error("listener lost"));
			expect(errors).toEqual([
				expect.objectContaining({ message: "listener lost" }),
			]);
			expect(consoleError).not.toHaveBeenCalled();
			expect(disconnects).toHaveLength(1);
		} finally {
			consoleError.mockRestore();
			await broker.stop();
		}
	});

	test("the realtime service routes ephemeral broker failures to its logger", () => {
		const logged: unknown[][] = [];
		const realtime = new RealtimeService({} as any, {}, "postgres://unused", {
			error: (...args: unknown[]) => logged.push(args),
			warn: () => {},
		});
		const driver = (realtime as any).ephemeral.broker.driver;
		driver.onError(new Error("notify failed"));

		expect(logged).toEqual([
			[
				"[Realtime] Ephemeral broker failed",
				expect.objectContaining({ message: "notify failed" }),
			],
		]);
	});
});
