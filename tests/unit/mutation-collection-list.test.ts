import { expect, test } from "bun:test";

import { createCollectionMutationData } from "../../packages/runtime/src/mutation/collection";
import { createCollectionExecutionBudget } from "../../packages/runtime/src/mutation/collection-budget";
import { createCollectionLifecycleDoom } from "../../packages/runtime/src/mutation/lifecycle";

// This test owns the private Collection adapter contract. PostgreSQL integration
// separately supplies compiler-linked plans and the real transaction query owner.
function listData(maxRows = 100) {
	const operation = {
		identity: "query:records.page",
		member: "list",
		target: "collection:records",
		dataQueryDigest: "a".repeat(64),
	};
	const doom = createCollectionLifecycleDoom();
	const budget = createCollectionExecutionBudget({
		doom,
		maxStatements: 2,
		maxDependencies: 20,
		maxRows,
		maxDurationMilliseconds: 5_000,
	});
	const page = Object.freeze({
		nodes: Object.freeze([{ id: "visible" }]),
		pageInfo: Object.freeze({ endCursor: "opaque-cursor", hasNextPage: true }),
	});
	let reads = 0;
	const data = createCollectionMutationData({
		plans: { plans: [], byIdentity: new Map() },
		collectionOperations: {
			operations: [operation],
			byIdentity: new Map([[operation.identity, operation]]),
			byTarget: new Map([[operation.target, new Map([["list", operation]])]]),
		} as never,
		facts: {
			principal: { kind: "user", id: "actor" },
			authority: { kind: "ordinary" },
			tenant: { id: "tenant" },
		},
		operationTime: new Date("2026-09-06T00:00:00.000Z"),
		resultValuesDecoded: true,
		lifecycleDoom: doom,
		executionBudget: budget,
		consumeRows() {},
		executeLeaf: async () => {
			throw new Error("Unexpected Collection leaf");
		},
		executeList: async (identity, request) => {
			expect(identity).toBe("query:records.page");
			expect(request).toEqual({ first: 1, after: null });
			reads++;
			return { ...page, observed: 2 };
		},
	});
	return { data, page, doom, reads: () => reads };
}

test("Mutation Collection list preserves its authorized page and opaque cursor", async () => {
	const { data, page } = listData();
	expect(await data.records!.list!({ first: 1, after: null })).toEqual(page);
	expect(Object.keys(data.records!)).toEqual(["list"]);
});

test("Mutation Collection list charges observed rows and shares terminal budgets", async () => {
	const { data, doom, reads } = listData(1);
	await expect(data.records!.list!({ first: 1, after: null })).rejects.toThrow(
		"row budget",
	);
	expect(() => doom.throwIfDoomed()).toThrow("row budget");
	await expect(data.records!.list!({ first: 1, after: null })).rejects.toThrow(
		"row budget",
	);
	expect(reads()).toBe(1);
});
