import { describe, expect, it } from "bun:test";

import {
	ANONYMOUS_ADMISSION_KEY,
	DEFAULT_REALTIME_ADMISSION,
	REALTIME_SLOT_KEEPALIVE_BEATS,
	RealtimeAdmissionRegistry,
	admitRealtimeTopic,
	admitRealtimeTopicPolicy,
	realtimeAdmissionBucket,
	realtimeSlotTtlMs,
	resolveRealtimeAdmissionConfig,
} from "../../src/server/modules/core/integrated/realtime/admission.js";

const HOUR = 3_600_000;

/** Non-expiring slots, for the assertions that are only about counting. */
function slot(
	registry: RealtimeAdmissionRegistry,
	key: string,
	maximum: number,
) {
	return registry.acquire(key, { maximum, ttlMs: HOUR });
}

describe("realtime admission", () => {
	it("applies the finite default limit and rejects query caps", () => {
		expect(DEFAULT_REALTIME_ADMISSION.maxFindLimit).toBe(100);
		expect(
			admitRealtimeTopic(
				{ id: "posts", resourceType: "collection", resource: "posts" },
				DEFAULT_REALTIME_ADMISSION,
			),
		).toMatchObject({ accepted: true, topic: { limit: 100 } });
		expect(
			admitRealtimeTopic(
				{
					id: "posts",
					resourceType: "collection",
					resource: "posts",
					limit: 101,
				},
				DEFAULT_REALTIME_ADMISSION,
			),
		).toEqual({
			accepted: false,
			message: "Topic limit must be between 1 and 100",
			reason: "query_limit",
			requestedLimit: 101,
			configuredLimit: 100,
		});
		expect(
			admitRealtimeTopic(
				{
					id: "posts",
					resourceType: "collection",
					resource: "posts",
					with: {
						author: {
							with: { team: { with: { company: { with: { owner: true } } } } },
						},
					},
				},
				DEFAULT_REALTIME_ADMISSION,
			),
		).toEqual({
			accepted: false,
			message: "Topic exceeds maximum relation depth of 3",
			reason: "relation_depth",
			configuredLimit: 3,
		});
		expect(
			admitRealtimeTopic(
				{
					id: "posts-count",
					resourceType: "collection",
					resource: "posts",
					operation: "count",
				},
				DEFAULT_REALTIME_ADMISSION,
			),
		).toEqual({
			accepted: true,
			topic: {
				id: "posts-count",
				resourceType: "collection",
				resource: "posts",
				operation: "count",
			},
		});
	});

	it("releases per-principal slots idempotently", () => {
		const registry = new RealtimeAdmissionRegistry();
		const first = slot(registry, "user-1", 2);
		const second = slot(registry, "user-1", 2);
		expect(first.admitted).toBe(true);
		expect(second.admitted).toBe(true);
		expect(slot(registry, "user-1", 2)).toMatchObject({
			admitted: false,
			observed: 2,
			configuredLimit: 2,
		});

		expect(first.admitted).toBe(true);
		if (!first.admitted) return;
		first.lease.release();
		first.lease.release();
		expect(registry.observed("user-1")).toBe(1);
		expect(slot(registry, "user-1", 2).admitted).toBe(true);
	});

	it("reclaims a slot whose lease lapsed, and closes the stream behind it", () => {
		const registry = new RealtimeAdmissionRegistry();
		const closed: string[] = [];
		const leaked = registry.acquire("user-1", {
			maximum: 1,
			ttlMs: 1000,
			now: 0,
		});
		expect(leaked.admitted).toBe(true);
		if (!leaked.admitted) return;
		leaked.lease.setClose(() => closed.push("leaked"));

		// Nothing released it and nothing renewed it — the runtime never told us.
		expect(
			registry.acquire("user-1", { maximum: 1, ttlMs: 1000, now: 999 }),
		).toMatchObject({ admitted: false, observed: 1, configuredLimit: 1 });
		expect(closed).toEqual([]);

		const readmitted = registry.acquire("user-1", {
			maximum: 1,
			ttlMs: 1000,
			now: 1001,
		});
		expect(readmitted.admitted).toBe(true);
		expect(closed).toEqual(["leaked"]);
		// The evicted lease must not vacate its successor's cell.
		leaked.lease.release();
		expect(registry.observed("user-1", 1001)).toBe(1);
	});

	it("keeps a renewed slot forever, so a live idle stream is never evicted", () => {
		const registry = new RealtimeAdmissionRegistry();
		const live = registry.acquire("user-1", { maximum: 1, ttlMs: 100, now: 0 });
		expect(live.admitted).toBe(true);
		if (!live.admitted) return;
		live.lease.setClose(() => {
			throw new Error("a renewed slot must never be evicted");
		});

		// One renewal per keepalive beat, well past many TTL windows.
		for (let beat = 1; beat <= 100; beat += 1) {
			live.lease.renew(beat * 25);
			expect(
				registry.acquire("user-1", {
					maximum: 1,
					ttlMs: 100,
					now: beat * 25,
				}),
			).toMatchObject({ admitted: false, observed: 1 });
		}
	});

	it("ties the slot TTL to the keepalive interval", () => {
		expect(realtimeSlotTtlMs(8000)).toBe(8000 * REALTIME_SLOT_KEEPALIVE_BEATS);
		expect(realtimeSlotTtlMs(250)).toBe(250 * REALTIME_SLOT_KEEPALIVE_BEATS);
		// Longer than the longest legitimate idle stream: an idle stream still
		// gets a ping every interval, so it renews every interval.
		expect(realtimeSlotTtlMs(8000)).toBeGreaterThan(8000);
		expect(realtimeSlotTtlMs(Number.NaN)).toBe(
			8000 * REALTIME_SLOT_KEEPALIVE_BEATS,
		);
	});

	it("caps unauthenticated connections in one shared bucket", () => {
		const config = resolveRealtimeAdmissionConfig({
			maxConnectionsPerPrincipal: 5,
			maxAnonymousConnections: 2,
		});
		expect(realtimeAdmissionBucket({ session: null }, config)).toEqual({
			key: ANONYMOUS_ADMISSION_KEY,
			maximum: 2,
			anonymous: true,
		});
		expect(
			realtimeAdmissionBucket({ session: { user: { id: "u1" } } }, config),
		).toEqual({ key: "user:u1", maximum: 5, anonymous: false });

		// Two anonymous callers share the bucket, so the cap actually binds.
		const registry = new RealtimeAdmissionRegistry();
		const bucket = realtimeAdmissionBucket({ session: null }, config);
		expect(slot(registry, bucket.key, bucket.maximum).admitted).toBe(true);
		expect(slot(registry, bucket.key, bucket.maximum).admitted).toBe(true);
		expect(slot(registry, bucket.key, bucket.maximum)).toMatchObject({
			admitted: false,
			observed: 2,
			configuredLimit: 2,
		});
	});

	it("keeps configured admission limits finite", () => {
		const config = resolveRealtimeAdmissionConfig({
			maxTopicsPerConnection: Number.POSITIVE_INFINITY,
			maxWithDepth: -1,
			initialSnapshotConcurrency: 0,
			maxDeltaFindLimit: 1_000,
			estimatedDeltaRowBytes: 4096,
			maxBufferedSnapshotBytes: 1024 * 1024,
		});
		expect(config).toMatchObject({
			maxTopicsPerConnection: 20,
			maxWithDepth: 3,
			initialSnapshotConcurrency: 4,
			maxDeltaFindLimit: 256,
		});
		expect(
			config.maxDeltaFindLimit * config.estimatedDeltaRowBytes,
		).toBeLessThanOrEqual(config.maxBufferedSnapshotBytes);
	});

	it("uses the smaller snapshot or ordered-delta byte budget", () => {
		const config = resolveRealtimeAdmissionConfig({
			maxBufferedSnapshotBytes: 1024 * 1024,
			maxBufferedDeltaBytes: 16 * 1024,
			estimatedDeltaRowBytes: 2048,
			maxDeltaFindLimit: 384,
		});

		expect(config.maxDeltaFindLimit).toBe(8);
		expect(
			config.maxDeltaFindLimit * config.estimatedDeltaRowBytes,
		).toBeLessThanOrEqual(config.maxBufferedDeltaBytes);
	});

	it("uses coherent finite defaults for delta bootstrap and queue caps", () => {
		expect(DEFAULT_REALTIME_ADMISSION).toMatchObject({
			maxDeltaFindLimit: 384,
			estimatedDeltaRowBytes: 2048,
			maxBufferedDeltaEvents: 512,
			maxBufferedDeltaBytes: 1024 * 1024,
			deltaHydrationConcurrency: 4,
			deltaRebootstrapIntervalMs: 60_000,
		});
		expect(
			DEFAULT_REALTIME_ADMISSION.maxDeltaFindLimit *
				DEFAULT_REALTIME_ADMISSION.estimatedDeltaRowBytes,
		).toBeLessThanOrEqual(DEFAULT_REALTIME_ADMISSION.maxBufferedSnapshotBytes);
	});

	it("preserves an unwindowed explicit delta find for route classification", () => {
		expect(
			admitRealtimeTopic(
				{
					id: "posts-delta",
					resourceType: "collection",
					resource: "posts",
					mode: "delta",
				},
				DEFAULT_REALTIME_ADMISSION,
			),
		).toEqual({
			accepted: true,
			topic: {
				id: "posts-delta",
				resourceType: "collection",
				resource: "posts",
				mode: "delta",
			},
		});
	});

	it("DoS matrix bounds connection, limit, and relation-depth floods", () => {
		const registry = new RealtimeAdmissionRegistry();
		const decisions = Array.from({ length: 500 }, () =>
			slot(registry, "one-principal", 5),
		);
		expect(decisions.filter((decision) => decision.admitted)).toHaveLength(5);
		expect(
			admitRealtimeTopic(
				{
					id: "unbounded",
					resourceType: "collection",
					resource: "posts",
					limit: 1_000_000,
				},
				DEFAULT_REALTIME_ADMISSION,
			),
		).toMatchObject({ accepted: false });
		expect(
			admitRealtimeTopic(
				{
					id: "deep",
					resourceType: "collection",
					resource: "posts",
					with: {
						a: { with: { b: { with: { c: { with: { d: true } } } } } },
					},
				},
				DEFAULT_REALTIME_ADMISSION,
			),
		).toMatchObject({ accepted: false });
		for (const decision of decisions) {
			if (decision.admitted) decision.lease.release();
		}
	});

	it("counts every live stream as a distinct server-owned admission slot", () => {
		const registry = new RealtimeAdmissionRegistry();

		const first = slot(registry, "user-1", 2);
		const second = slot(registry, "user-1", 2);
		expect(first.admitted).toBe(true);
		expect(second.admitted).toBe(true);
		expect(slot(registry, "user-1", 2).admitted).toBe(false);

		if (!first.admitted) return;
		first.lease.release();
		expect(slot(registry, "user-1", 2).admitted).toBe(true);
	});

	it("keeps row-topic policy distinct from collection change capture", () => {
		const topic = {
			id: "posts",
			resourceType: "collection" as const,
			resource: "posts",
		};
		expect(
			admitRealtimeTopicPolicy(topic, { rowLiveQueries: false }),
		).toMatchObject({
			accepted: false,
			reason: "row_live_queries_disabled",
		});
		expect(
			admitRealtimeTopicPolicy(topic, { collectionRealtime: false }),
		).toMatchObject({
			accepted: false,
			reason: "collection_realtime_disabled",
		});
		expect(admitRealtimeTopicPolicy(topic, {})).toEqual({
			accepted: true,
			topic,
		});
		expect(
			admitRealtimeTopicPolicy(
				{
					id: "settings",
					resourceType: "global",
					resource: "settings",
					operation: "get",
				},
				{ rowLiveQueries: false, collectionRealtime: false },
			),
		).toMatchObject({
			accepted: false,
			reason: "row_live_queries_disabled",
		});
	});

	it("reports change capture ahead of the read-side switches", () => {
		// A reader has to be able to tell "the server stopped serving row topics"
		// from "there is no outbox to serve", because only the second one also
		// costs resume and txid correlation. Capture is the stronger switch, so it
		// is the reason reported when both are off.
		for (const topic of [
			{ id: "posts", resourceType: "collection" as const, resource: "posts" },
			{
				id: "settings",
				resourceType: "global" as const,
				resource: "settings",
				operation: "get" as const,
			},
		]) {
			expect(
				admitRealtimeTopicPolicy(topic, { changeCapture: false }),
			).toMatchObject({
				accepted: false,
				reason: "change_capture_disabled",
			});
			expect(
				admitRealtimeTopicPolicy(topic, {
					changeCapture: false,
					rowLiveQueries: false,
					collectionRealtime: false,
				}),
			).toMatchObject({
				accepted: false,
				reason: "change_capture_disabled",
			});
			expect(
				admitRealtimeTopicPolicy(topic, { changeCapture: true }),
			).toMatchObject({ accepted: true });
		}
	});
});
