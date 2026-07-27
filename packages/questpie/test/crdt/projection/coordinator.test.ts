import { describe, expect, it } from "bun:test";

import {
	createCrdtProjectionCoordinator,
	type CrdtPreparedProjection,
	type CrdtProjectionAdapter,
	type CrdtProjectionClaim,
} from "../../../src/server/modules/core/integrated/crdt/projection.js";

const claim = {
	id: "projection-p",
	resourceId: "resource",
	resourceEpochId: "epoch",
	aggregateEpoch: 3n,
	schemaId: "schema",
	targetCommitSeq: 8n,
	leaseGeneration: 2n,
} satisfies CrdtProjectionClaim;

describe("CRDT projection coordinator", () => {
	it("materializes and commits the exact claimed cut", async () => {
		let committed: CrdtPreparedProjection | undefined;
		const coordinator = createCrdtProjectionCoordinator(
			adapter({
				commit: async (prepared) => {
					committed = prepared;
					return { status: "applied", projectedCommitSeq: 8n };
				},
			}),
		);

		await expect(coordinator.runOnce()).resolves.toEqual({
			status: "applied",
			projectedCommitSeq: 8n,
		});
		expect(committed?.claim.targetCommitSeq).toBe(8n);
		expect(committed?.basisProjectedCommitSeq).toBe(4n);
	});

	it("makes an N job a no-op after M was projected first", async () => {
		const coordinator = createCrdtProjectionCoordinator(
			adapter({
				commit: async () => ({ status: "noop", projectedCommitSeq: 12n }),
			}),
		);

		await expect(coordinator.runOnce()).resolves.toEqual({
			status: "noop",
			projectedCommitSeq: 12n,
		});
	});

	it("requires reprepare when K advances but remains below P", async () => {
		const coordinator = createCrdtProjectionCoordinator(
			adapter({
				commit: async () => ({
					status: "reprepare",
					projectedCommitSeq: 6n,
				}),
			}),
		);

		await expect(coordinator.runOnce()).resolves.toEqual({
			status: "reprepare",
			projectedCommitSeq: 6n,
		});
	});

	it("rejects a materializer that substitutes head M for claimed N", async () => {
		const coordinator = createCrdtProjectionCoordinator(
			adapter({
				commit: async () => ({
					status: "applied",
					projectedCommitSeq: 12n,
				}),
			}),
		);

		await expect(coordinator.runOnce()).rejects.toThrow("invalid result");
	});

	it("sorts every active binding before the transactional seam", async () => {
		let order: string[] = [];
		const coordinator = createCrdtProjectionCoordinator(
			adapter({
				prepareExactCut: async () => ({
					basisProjectedCommitSeq: 4n,
					fields: [field("z"), field("a")],
				}),
				commit: async (prepared) => {
					order = prepared.fields.map((field) => field.bindingId);
					return { status: "applied", projectedCommitSeq: 8n };
				},
			}),
		);

		await coordinator.runOnce();
		expect(order).toEqual(["a", "z"]);
	});
});

function adapter(
	overrides: Partial<CrdtProjectionAdapter>,
): CrdtProjectionAdapter {
	return {
		claimDue: async () => claim,
		prepareExactCut: async () => ({
			basisProjectedCommitSeq: 4n,
			fields: [field("binding")],
		}),
		commit: async () => ({ status: "applied", projectedCommitSeq: 8n }),
		...overrides,
	};
}

function field(bindingId: string) {
	return {
		bindingId,
		stableFieldId: `stable-${bindingId}`,
		fieldEpoch: 1n,
		targetFieldCursor: 3n,
		canonicalHash: new Uint8Array(32),
		canonicalRevision: 2n,
		value: "value",
		shouldWrite: true,
	};
}
