import { describe, expect, it } from "bun:test";

import {
	createCrdtReplaceCoordinator,
	type CrdtReplaceAdapter,
} from "../../../src/server/modules/core/integrated/crdt/replace.js";

describe("CRDT replace coordinator", () => {
	it("keeps field replacement partial and requires one replace outbox", async () => {
		let inputFields = 0;
		const coordinator = createCrdtReplaceCoordinator(
			adapter({
				commitField: async () => {
					inputFields++;
					return result(4n, 9n);
				},
			}),
		);

		await expect(
			coordinator.replaceField({
				resourceId: "resource",
				stableFieldId: "title",
				value: "replacement",
				expected: { fieldEpoch: 2n, canonicalRevision: 7n },
				reason: "restore",
			}),
		).resolves.toEqual(result(4n, 9n));
		expect(inputFields).toBe(1);
	});

	it("rejects missing, extra, or phantom aggregate fields before staging", async () => {
		let staged = false;
		const coordinator = createCrdtReplaceCoordinator(
			adapter({
				stageAggregate: async () => {
					staged = true;
					return {};
				},
			}),
		);

		await expect(
			coordinator.replaceAggregate({
				resourceId: "resource",
				values: { title: "x", phantom: "y" },
				expected: {
					aggregateEpoch: 3n,
					canonicalRevisions: { title: 1n, tags: 1n },
				},
				reason: "import",
			}),
		).rejects.toThrow("every collaborative field");
		expect(staged).toBe(false);
	});

	it("snapshots mutable set values before asynchronous staging", async () => {
		const tags = ["a"];
		let captured: readonly string[] = [];
		const coordinator = createCrdtReplaceCoordinator(
			adapter({
				stageAggregate: async (input) => {
					tags.push("forged");
					captured = input.values.tags as readonly string[];
					return {};
				},
			}),
		);
		await coordinator.replaceAggregate({
			resourceId: "resource",
			values: { title: "x", tags },
			expected: {
				aggregateEpoch: 3n,
				canonicalRevisions: { title: 1n, tags: 1n },
			},
			reason: "agent",
		});
		expect(captured).toEqual(["a"]);
	});

	it("rejects duplicate or missing outbox effects from the transaction seam", async () => {
		const coordinator = createCrdtReplaceCoordinator(
			adapter({
				commitField: async () => ({
					...result(4n, 9n),
					outboxChanges: 2 as 1,
				}),
			}),
		);
		await expect(
			coordinator.replaceField({
				resourceId: "resource",
				stableFieldId: "title",
				value: "x",
				expected: { fieldEpoch: 2n, canonicalRevision: 7n },
				reason: "resolve",
			}),
		).rejects.toThrow("atomic result");
	});
});

function adapter(
	overrides: Partial<CrdtReplaceAdapter<object>>,
): CrdtReplaceAdapter<object> {
	return {
		fieldKeys: async () => ["title", "tags"],
		stageField: async () => ({}),
		stageAggregate: async () => ({}),
		commitField: async () => result(4n, 9n),
		commitAggregate: async () => result(4n, 1n),
		...overrides,
	};
}

function result(aggregateEpoch: bigint, commitSeq: bigint) {
	return {
		resourceId: "resource",
		aggregateEpoch,
		commitSeq,
		outboxChanges: 1 as const,
		origin: "crdt_replace" as const,
	};
}
