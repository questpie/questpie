import { describe, expect, it } from "bun:test";

import {
	DEFAULT_REALTIME_ADMISSION,
	RealtimeAdmissionRegistry,
	admitRealtimeTopic,
	resolveRealtimeAdmissionConfig,
} from "../../src/server/modules/core/integrated/realtime/admission.js";

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

	it("releases per-principal counters idempotently", () => {
		const registry = new RealtimeAdmissionRegistry(2);
		const first = registry.acquire("user-1");
		const second = registry.acquire("user-1");
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(registry.acquire("user-1")).toBeNull();

		first!();
		first!();
		expect(registry.acquire("user-1")).not.toBeNull();
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
		const registry = new RealtimeAdmissionRegistry(5);
		const releases = Array.from({ length: 500 }, () =>
			registry.acquire("one-principal"),
		);
		expect(releases.filter(Boolean)).toHaveLength(5);
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
		for (const release of releases) release?.();
	});

	it("counts every live stream as a distinct server-owned admission slot", () => {
		const registry = new RealtimeAdmissionRegistry(2);

		const first = registry.acquire("user-1");
		const second = registry.acquire("user-1");
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(registry.acquire("user-1")).toBeNull();

		first!();
		expect(registry.acquire("user-1")).not.toBeNull();
	});
});
