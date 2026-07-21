import { describe, expect, test } from "bun:test";

import {
	RealtimeObservability,
	type RealtimeObservation,
} from "../../src/server/modules/core/integrated/realtime/observer.js";
import { RealtimeRefreshScheduler } from "../../src/server/modules/core/integrated/realtime/refresh-scheduler.js";
import { RealtimeService } from "../../src/server/modules/core/integrated/realtime/service.js";
import { SseClientTransport } from "../../src/server/modules/core/integrated/realtime/sse-client-transport.js";
import type { ChangeBroker } from "../../src/server/modules/core/integrated/realtime/transport.js";
import type { RealtimeChangeEvent } from "../../src/server/modules/core/integrated/realtime/types.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("realtime matrix observability", () => {
	test("records bounded rejected-topic dimensions without query payloads", () => {
		const events: RealtimeObservation[] = [];
		const warnings: unknown[] = [];
		const observability = new RealtimeObservability({
			observer: { record: (event) => events.push(event) },
			logger: {
				warn: (_message, fields) => warnings.push(fields),
				error: () => {},
			},
		});

		observability.record({
			type: "admission.rejected",
			reason: "query_limit",
			resource: "media",
			operation: "find",
			requestedLimit: 240,
			configuredLimit: 100,
			rolloutMode: "v2",
		});

		expect(events).toEqual([
			{
				type: "admission.rejected",
				reason: "query_limit",
				resource: "media",
				operation: "find",
				requestedLimit: 240,
				configuredLimit: 100,
				rolloutMode: "v2",
			},
		]);
		expect(observability.snapshot().counters).toMatchObject({
			"admission.rejected|reason=query_limit|resource=media|rollout_mode=v2": 1,
		});
		expect(JSON.stringify(warnings)).not.toContain("where");
	});

	test("records bounded topology lifecycle metrics and warnings", () => {
		const warnings: unknown[] = [];
		const observability = new RealtimeObservability({
			logger: {
				warn: (_message, fields) => warnings.push(fields),
				error: () => {},
			},
		});

		observability.record({
			type: "topology.lifecycle",
			phase: "submit",
			outcome: "conflict",
			desiredRevision: 4,
			appliedRevision: 3,
		});

		expect(observability.snapshot().counters).toMatchObject({
			"topology.lifecycle|outcome=conflict|phase=submit": 1,
		});
		expect(warnings).toHaveLength(1);
		expect(JSON.stringify(warnings)).not.toContain("sessionId");
		expect(JSON.stringify(warnings)).not.toContain("token");
		expect(JSON.stringify(warnings)).not.toContain("identity");
	});

	test("isolates observer and logger failures while exposing bounded metrics", () => {
		const events: RealtimeObservation[] = [];
		const observability = new RealtimeObservability({
			observer: {
				record(event) {
					events.push(event);
					throw new Error("observer failed");
				},
			},
			logger: {
				warn() {
					throw new Error("logger failed");
				},
				error() {
					throw new Error("logger failed");
				},
			},
		});

		expect(() =>
			observability.record({
				type: "broker.publish",
				seam: "v2",
				outcome: "failed",
			}),
		).not.toThrow();
		expect(events).toHaveLength(1);
		expect(observability.snapshot()).toEqual({
			counters: {
				"broker.publish|outcome=failed|seam=v2": 1,
			},
			gauges: {
				activeSessions: 0,
				bufferedBytes: 0,
				deltaBufferedEvents: 0,
				deltaBufferedBytes: 0,
			},
		});
	});

	test("aggregates bounded delta memory gauges by internal buffer key", () => {
		const observability = new RealtimeObservability();
		observability.record({
			type: "delta.buffer",
			scope: "group",
			key: "group-a",
			events: 2,
			bytes: 64,
		});
		observability.record({
			type: "delta.buffer",
			scope: "subscriber",
			key: "subscriber-b",
			events: 1,
			bytes: 32,
		});
		expect(observability.snapshot().gauges).toMatchObject({
			deltaBufferedEvents: 3,
			deltaBufferedBytes: 96,
		});
		observability.record({
			type: "delta.buffer",
			scope: "group",
			key: "group-a",
			events: 0,
			bytes: 0,
		});
		expect(observability.snapshot().gauges).toMatchObject({
			deltaBufferedEvents: 1,
			deltaBufferedBytes: 32,
		});
	});

	test("records refresh sharing and snapshot suppression without topic labels", async () => {
		const observations: RealtimeObservation[] = [];
		const listeners = new Set<(event: RealtimeChangeEvent) => void>();
		const source = {
			getLatestSeq: async () => 1,
			subscribe: (listener: (event: RealtimeChangeEvent) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};
		const scheduler = new RealtimeRefreshScheduler(source, 2, {
			record: (event) => observations.push(event),
		});
		let computes = 0;
		const subscribe = () =>
			scheduler.subscribe({
				key: "contains-private-session-id",
				topicId: "contains-private-topic-id",
				topics: {
					resourceType: "collection",
					resource: "private-collection-name",
					operation: "find",
				},
				compute: async () => {
					computes += 1;
					return { stable: true };
				},
				onFrame: () => {},
				onError: () => {},
			});
		const first = subscribe();
		const second = subscribe();
		await tick();
		for (const listener of listeners) {
			listener({
				seq: 2,
				resourceType: "collection",
				resource: "private-collection-name",
				operation: "update",
				createdAt: new Date(),
			});
		}
		await tick();

		expect(computes).toBe(2);
		expect(observations).toContainEqual(
			expect.objectContaining({
				type: "refresh.completed",
				operation: "find",
				subscribers: 2,
			}),
		);
		expect(observations).toContainEqual({
			type: "refresh.suppressed",
			operation: "find",
			subscribers: 2,
		});
		expect(JSON.stringify(observations)).not.toContain("private");
		first();
		second();
	});

	test("exposes poll healing and compute-once sharing counters", () => {
		const observability = new RealtimeObservability();
		observability.record({
			type: "drain.completed",
			reason: "poll",
			rows: 4,
			seqDelta: 7,
			lagMs: 20,
			durationMs: 5,
			healed: true,
		});
		observability.record({
			type: "refresh.started",
			operation: "find",
			subscribers: 3,
		});
		observability.record({
			type: "refresh.completed",
			operation: "find",
			subscribers: 3,
			durationMs: 2,
			frameBytes: 100,
		});

		expect(observability.snapshot().counters).toMatchObject({
			"drain.poll_healing": 1,
			"drain.rows|reason=poll": 4,
			"drain.seq_delta|reason=poll": 7,
			"refresh.started|operation=find": 1,
			"refresh.subscriber_deliveries|operation=find": 3,
		});
	});

	test("wires broker publish failures through the service seam", async () => {
		const observations: RealtimeObservation[] = [];
		const broker: ChangeBroker = {
			start: async () => {},
			publish: async () => {
				throw new Error("broker unavailable");
			},
			stop: async () => {},
		};
		const realtime = new RealtimeService({} as never, {
			changeBroker: broker,
			pollIntervalMs: 0,
			observer: { record: (event) => observations.push(event) },
		});

		await expect(
			realtime.notify({
				seq: 1,
				resourceType: "collection",
				resource: "posts",
				operation: "update",
				createdAt: new Date(),
			}),
		).rejects.toThrow("broker unavailable");
		expect(observations).toContainEqual({
			type: "broker.publish",
			seam: "v2",
			outcome: "failed",
		});
		expect(realtime.getMetrics().counters).toMatchObject({
			"broker.publish|outcome=failed|seam=v2": 1,
		});
	});

	test("observes bounded SSE backpressure and teardown reasons", async () => {
		const observations: RealtimeObservation[] = [];
		let desiredSize = 0;
		const transport = new SseClientTransport(
			{
				get desiredSize() {
					return desiredSize;
				},
				enqueue() {},
				close() {},
			},
			1024,
			{ record: (event) => observations.push(event) },
		);
		await transport.start({ onError: () => {} });
		const sink = await transport.openSession({
			sessionId: "must-not-be-observed",
			principal: null,
			resolvePrincipal: async () => null,
		});
		await expect(
			sink.write(new Uint8Array(16), "latest-snapshot"),
		).resolves.toEqual({ status: "busy", bufferedBytes: 1024 });
		desiredSize = 1024;
		await sink.write(new Uint8Array(16), "ordered-channel-event");
		await sink.close("slow_consumer");

		expect(observations).toContainEqual({
			type: "sink.write",
			delivery: "latest-snapshot",
			outcome: "busy",
			bufferedBytes: 1024,
		});
		expect(observations).toContainEqual({
			type: "session.closed",
			transport: "sse",
			reason: "slow_consumer",
		});
		expect(JSON.stringify(observations)).not.toContain("must-not-be-observed");
	});
});
