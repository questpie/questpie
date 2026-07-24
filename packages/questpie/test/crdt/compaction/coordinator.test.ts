import { describe, expect, it } from "bun:test";

import {
	createCrdtCompactionCoordinator,
	planCrdtGarbageCollection,
	shouldCompactCrdtAggregate,
	type CrdtCompactionAdapter,
} from "../../../src/server/modules/core/integrated/crdt/compaction.js";

const cut = {
	resourceId: "resource",
	resourceEpochId: "epoch",
	schemaId: "schema",
	coversCommitSeq: 700n,
	leaseOwnerId: "worker-a",
	leaseGeneration: 3n,
};

describe("CRDT compaction coordinator", () => {
	it("triggers at either 512 commits or 4 MiB", () => {
		expect(
			shouldCompactCrdtAggregate({
				headCommitSeq: 512n,
				currentSnapshotCommitSeq: 0n,
				updateBytesSinceSnapshot: 0n,
			}),
		).toBe(true);
		expect(
			shouldCompactCrdtAggregate({
				headCommitSeq: 1n,
				currentSnapshotCommitSeq: 0n,
				updateBytesSinceSnapshot: 4n * 1024n * 1024n,
			}),
		).toBe(true);
	});

	it("collects garbage only after the verified pointer publishes", async () => {
		const calls: string[] = [];
		const coordinator = createCrdtCompactionCoordinator(
			adapter({
				materializeExactCut: async () => {
					calls.push("materialize");
					return "snapshot";
				},
				persistVerifiedCandidate: async () => {
					calls.push("persist");
				},
				publishVerifiedCandidate: async () => {
					calls.push("publish");
					return true;
				},
				collectGarbage: async () => {
					calls.push("gc");
					return 2;
				},
			}),
		);

		await expect(coordinator.runOnce()).resolves.toEqual({
			status: "published",
			deleted: 2,
		});
		expect(calls).toEqual(["materialize", "persist", "publish", "gc"]);
	});

	it("leaves an orphan candidate recoverable after a stale publish", async () => {
		let gc = false;
		const coordinator = createCrdtCompactionCoordinator(
			adapter({
				publishVerifiedCandidate: async () => false,
				collectGarbage: async () => {
					gc = true;
					return 1;
				},
			}),
		);

		await expect(coordinator.runOnce()).resolves.toEqual({
			status: "stale",
			deleted: 0,
		});
		expect(gc).toBe(false);
	});

	it("bounds every GC batch", async () => {
		const coordinator = createCrdtCompactionCoordinator(
			adapter({ collectGarbage: async () => 257 }),
		);
		await expect(coordinator.runOnce()).rejects.toThrow("bounded batch");
	});
});

describe("CRDT retention plan", () => {
	it("retains all commits until a previous verified basis exists", () => {
		expect(
			planCrdtGarbageCollection({
				currentManifestId: "current",
				previousManifestId: null,
				manifests: [manifest("current", 10n)],
				commits: [commit("update", 1n, 1)],
				expiredReceiptIds: [],
			}).commitIds,
		).toEqual([]);
	});

	it("retains control headers and everything after the previous cut", () => {
		const plan = planCrdtGarbageCollection({
			currentManifestId: "current",
			previousManifestId: "previous",
			manifests: [manifest("current", 20n), manifest("previous", 10n)],
			commits: [
				commit("old-update", 9n, 1),
				commit("control", 8n, 2),
				commit("new-update", 11n, 1),
			],
			expiredReceiptIds: [],
		});
		expect(plan.commitIds).toEqual(["old-update"]);
	});

	it("retains retired-field and recovery-held snapshot bases", () => {
		const plan = planCrdtGarbageCollection({
			currentManifestId: "current",
			previousManifestId: "previous",
			manifests: [
				manifest("current", 20n),
				manifest("previous", 10n),
				{ ...manifest("retired", 5n), hasRecentlyRetiredField: true },
				{ ...manifest("held", 4n), hasRecoveryHold: true },
				manifest("garbage", 3n),
			],
			commits: [],
			expiredReceiptIds: [],
		});
		expect(plan.manifestIds).toEqual(["garbage"]);
	});

	it("shares one hard 256-row bound across deletion classes", () => {
		const plan = planCrdtGarbageCollection({
			currentManifestId: "current",
			previousManifestId: "previous",
			manifests: [manifest("current", 400n), manifest("previous", 300n)],
			commits: Array.from({ length: 200 }, (_, index) =>
				commit(`commit-${index}`, BigInt(index), 1),
			),
			expiredReceiptIds: Array.from(
				{ length: 200 },
				(_, index) => `receipt-${index}`,
			),
		});
		expect(plan.commitIds.length + plan.receiptIds.length).toBe(256);
	});
});

function adapter(
	overrides: Partial<CrdtCompactionAdapter<string>>,
): CrdtCompactionAdapter<string> {
	return {
		captureCut: async () => cut,
		materializeExactCut: async () => "snapshot",
		persistVerifiedCandidate: async () => {},
		publishVerifiedCandidate: async () => true,
		collectGarbage: async () => 0,
		...overrides,
	};
}

function manifest(id: string, coversCommitSeq: bigint) {
	return {
		id,
		coversCommitSeq,
		hasRecentlyRetiredField: false,
		hasRecoveryHold: false,
	};
}

function commit(id: string, commitSeq: bigint, kind: 1 | 2 | 3 | 4) {
	return { id, commitSeq, kind };
}
