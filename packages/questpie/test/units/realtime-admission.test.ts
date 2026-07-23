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

	it("reclaims a reconnecting connection's prior slot (no leak on reconnect)", () => {
		const registry = new RealtimeAdmissionRegistry(2);
		let firstClosed = 0;
		// A tab reconnecting under the SAME connectionId reoccupies its one slot.
		const first = registry.acquire("user-1", "tab-A");
		first?.setClose(() => {
			firstClosed += 1;
		});
		const reconnect = registry.acquire("user-1", "tab-A");
		expect(first).not.toBeNull();
		expect(reconnect).not.toBeNull();
		expect(firstClosed).toBe(1);
		// Still only ONE slot for user-1 → a second distinct tab fits, a third does not.
		expect(registry.acquire("user-1", "tab-B")).not.toBeNull();
		expect(registry.acquire("user-1", "tab-C")).toBeNull();
		// The dropped pre-reconnect stream closing must NOT evict the live slot.
		first!();
		expect(registry.acquire("user-1", "tab-C")).toBeNull();
		// Releasing the live reconnect slot frees tab-A's cell.
		reconnect!();
		expect(registry.acquire("user-1", "tab-C")).not.toBeNull();
	});

	it("keeps unidentified connections counting independently (backward compatible)", () => {
		const registry = new RealtimeAdmissionRegistry(2);
		// No connectionId → each acquire is its own slot, exactly as before.
		expect(registry.acquire("user-1")).not.toBeNull();
		expect(registry.acquire("user-1")).not.toBeNull();
		expect(registry.acquire("user-1")).toBeNull();
		// Identified and unidentified connections share the same per-principal cap.
		const mixed = new RealtimeAdmissionRegistry(2);
		mixed.acquire("user-1", "tab-A");
		mixed.acquire("user-1");
		expect(mixed.acquire("user-1", "tab-B")).toBeNull();
	});

	it("a reconnect flood under one id fences every displaced stream", () => {
		const registry = new RealtimeAdmissionRegistry(5);
		let closed = 0;
		let last: ReturnType<typeof registry.acquire> = null;
		for (let index = 0; index < 500; index += 1) {
			last = registry.acquire("user-1", "tab-A");
			last?.setClose(() => {
				closed += 1;
			});
		}
		expect(last).not.toBeNull();
		expect(closed).toBe(499);
		// Four more distinct tabs still fit (tab-A already holds one), the sixth does not.
		expect(registry.acquire("user-1", "tab-B")).not.toBeNull();
		expect(registry.acquire("user-1", "tab-C")).not.toBeNull();
		expect(registry.acquire("user-1", "tab-D")).not.toBeNull();
		expect(registry.acquire("user-1", "tab-E")).not.toBeNull();
		expect(registry.acquire("user-1", "tab-F")).toBeNull();
	});

	it("closes a superseded stream that registers its close handler late", () => {
		const registry = new RealtimeAdmissionRegistry(1);
		const first = registry.acquire("user-1", "tab-A");
		const reconnect = registry.acquire("user-1", "tab-A");
		let closed = 0;
		first?.setClose(() => {
			closed += 1;
		});
		expect(reconnect).not.toBeNull();
		expect(closed).toBe(1);
	});

	it("does not let invalid or oversized ids alias an admission slot", () => {
		const registry = new RealtimeAdmissionRegistry(2);
		expect(registry.acquire("user-1", "same id")).not.toBeNull();
		expect(registry.acquire("user-1", "same id")).not.toBeNull();
		expect(registry.acquire("user-1", "same id")).toBeNull();

		const oversized = new RealtimeAdmissionRegistry(1);
		const id = "a".repeat(129);
		expect(oversized.acquire("user-1", id)).not.toBeNull();
		expect(oversized.acquire("user-1", id)).toBeNull();
	});
});
