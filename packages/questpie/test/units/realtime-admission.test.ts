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
});
