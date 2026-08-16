import { describe, expect, test } from "bun:test";

import {
	createLiveQueryInvalidation,
	type ChangeLedgerFactV1,
	type LinkedLiveQueryProgramV1,
	type ObservedLiveQueryPlanV1,
} from "../../packages/runtime/src/live-query";

const sha = (digit: string) => digit.repeat(64);

const program: LinkedLiveQueryProgramV1 = {
	format: "questpie.live-query-program",
	version: 1,
	queries: new Map(),
	limits: {
		activePerPrincipal: 64,
		bufferedBytesPerClient: 2_097_152,
		dependencyTokensPerPlan: 256,
		fanoutPerBatch: 1024,
		ledgerLagMilliseconds: 30_000,
		resultBytes: 1_048_576,
		retainedTokensPerPrincipal: 128,
		retentionMilliseconds: 86_400_000,
	},
};

function plan(
	collection: string,
	digestDigit: string,
): ObservedLiveQueryPlanV1 {
	return Object.freeze({
		format: "questpie.observed-live-query-plan",
		version: 1,
		query: "query:messages.page",
		tokens: Object.freeze([
			Object.freeze({
				kind: "collectionRange" as const,
				collection,
				detail: Object.freeze({}),
			}),
		]),
		digest: sha(digestDigit),
	});
}

function fact(collection: string): ChangeLedgerFactV1 {
	return Object.freeze({
		factIdentity: "00000000-0000-0000-0000-000000000001",
		factId: "1",
		transactionId: "1",
		collection,
		kind: "update",
		oldKey: Object.freeze({ id: "before" }),
		newKey: Object.freeze({ id: "after" }),
		conservative: false,
		capturedAt: new Date(0),
	});
}

function planWithTokenCount(count: number): ObservedLiveQueryPlanV1 {
	return Object.freeze({
		format: "questpie.observed-live-query-plan",
		version: 1,
		query: "query:messages.page",
		tokens: Object.freeze(
			Array.from({ length: count }, (_, index) =>
				Object.freeze({
					kind: "collectionPoint" as const,
					collection: "collection:messages",
					detail: Object.freeze({ id: `message-${index}` }),
				}),
			),
		),
		digest: sha("3"),
	});
}

describe("BETA-07 Runtime Live Query invalidation", () => {
	test("conservatively matches a Change Ledger Collection and replaces only a successful plan", async () => {
		const initial = plan("collection:messages", "1");
		const replacement = plan("collection:memberships", "2");
		const outcomes = [
			{ status: "success" as const, plan: replacement },
			{ status: "failed" as const },
			{ status: "revoked" as const },
		];
		const invalidation = createLiveQueryInvalidation(program);
		invalidation.register({
			watch: "watch:alice:messages",
			plan: initial,
			recompute: () => outcomes.shift()!,
		});

		await invalidation.invalidate([fact("collection:messageEvents")]);
		expect(invalidation.currentPlan("watch:alice:messages")).toBe(initial);

		await invalidation.invalidate([fact("collection:messages")]);
		expect(invalidation.currentPlan("watch:alice:messages")).toBe(replacement);

		await invalidation.invalidate([fact("collection:memberships")]);
		expect(invalidation.currentPlan("watch:alice:messages")).toBe(replacement);

		await invalidation.invalidate([fact("collection:memberships")]);
		expect(invalidation.currentPlan("watch:alice:messages")).toBe(replacement);
	});

	test("rejects an oversized initial plan and preserves the prior plan when recomputation exceeds 256 tokens", async () => {
		const invalidation = createLiveQueryInvalidation(program);
		expect(() =>
			invalidation.register({
				watch: "watch:oversized",
				plan: planWithTokenCount(257),
				recompute: () => ({ status: "failed" }),
			}),
		).toThrow("Live Query dependency token limit exceeded");

		const initial = plan("collection:messages", "1");
		invalidation.register({
			watch: "watch:alice:messages",
			plan: initial,
			recompute: () => ({
				status: "success",
				plan: planWithTokenCount(257),
			}),
		});
		const result = await invalidation.invalidate([fact("collection:messages")]);

		expect(result.failed).toEqual(["watch:alice:messages"]);
		expect(invalidation.currentPlan("watch:alice:messages")).toBe(initial);
	});

	test("coalesces dirty watches and recomputes 2,050 watches in bounded fanout batches", async () => {
		const invalidation = createLiveQueryInvalidation(program);
		const initial = plan("collection:messages", "1");
		let recomputations = 0;
		for (let index = 0; index < 2_050; index += 1) {
			invalidation.register({
				watch: `watch:${index.toString().padStart(4, "0")}`,
				plan: initial,
				recompute: () => {
					recomputations += 1;
					return { status: "success", plan: initial };
				},
			});
		}

		const first = invalidation.invalidate([fact("collection:messages")]);
		const coalesced = invalidation.invalidate([
			fact("collection:messages"),
			fact("collection:messages"),
		]);
		const [firstResult, coalescedResult] = await Promise.all([
			first,
			coalesced,
		]);

		expect(firstResult.batches).toEqual([1024, 1024, 2]);
		expect(coalescedResult.batches).toEqual([1024, 1024, 2]);
		expect(recomputations).toBe(2_050);
	});
});
