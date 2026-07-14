import { describe, expect, it } from "bun:test";

import {
	DEFAULT_REALTIME_ADMISSION,
	RealtimeAdmissionRegistry,
	admitRealtimeTopic,
	resolveRealtimeAdmissionConfig,
} from "../../src/server/modules/core/integrated/realtime/admission.js";

describe("realtime admission", () => {
	it("applies the finite default limit and rejects query caps", () => {
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
		).toMatchObject({ accepted: false });
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
		).toMatchObject({ accepted: false });
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
		expect(
			resolveRealtimeAdmissionConfig({
				maxTopicsPerConnection: Number.POSITIVE_INFINITY,
				maxWithDepth: -1,
				initialSnapshotConcurrency: 0,
			}),
		).toMatchObject({
			maxTopicsPerConnection: 20,
			maxWithDepth: 3,
			initialSnapshotConcurrency: 4,
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
});
