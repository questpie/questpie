import { describe, expect, test } from "bun:test";

import {
	canonicalJsonLine,
	sha256Digest,
} from "../../packages/runtime/src/canonical-json";
import {
	decodeObservedLiveQueryPlan,
	matchesObservedLiveQueryPlan,
	type ChangeLedgerFactV1,
} from "../../packages/runtime/src/live-query";

function encodedPlan(collection: string): Uint8Array {
	const withoutDigest = {
		format: "questpie.observed-live-query-plan" as const,
		version: 1 as const,
		query: "query:messages.page",
		tokens: [
			{
				kind: "collectionRange" as const,
				collection,
				detail: { conservative: true },
			},
		],
	};
	return canonicalJsonLine({
		...withoutDigest,
		digest: sha256Digest(
			Buffer.concat([
				Buffer.from("questpie-observed-live-query-plan-v1\0"),
				canonicalJsonLine(withoutDigest),
			]),
		),
	});
}

const fact = (collection: string, conservative = false): ChangeLedgerFactV1 =>
	Object.freeze({
		factIdentity: "00000000-0000-0000-0000-000000000001",
		factId: "1",
		transactionId: "1",
		collection,
		kind: conservative ? "collection" : "update",
		oldKey: conservative ? null : Object.freeze({ id: "before" }),
		newKey: conservative ? null : Object.freeze({ id: "after" }),
		conservative,
		capturedAt: new Date(0),
	});

describe("BETA-07 observed dependency matching", () => {
	test("strict-decodes a retained plan and conservatively matches row and widened Collection facts", () => {
		const bytes = encodedPlan("collection:messages");
		const plan = decodeObservedLiveQueryPlan({
			bytes,
			bytesDigest: sha256Digest(bytes),
			queryIdentity: "messages.page",
		});

		expect(
			matchesObservedLiveQueryPlan(plan, fact("collection:messages")),
		).toBe(true);
		expect(
			matchesObservedLiveQueryPlan(plan, fact("collection:messages", true)),
		).toBe(true);
		expect(
			matchesObservedLiveQueryPlan(plan, fact("collection:channels")),
		).toBe(false);
	});

	test("rejects altered bytes, embedded digests, Query identities, and token shapes", () => {
		const bytes = encodedPlan("collection:messages");
		const valid = {
			bytes,
			bytesDigest: sha256Digest(bytes),
			queryIdentity: "messages.page",
		} as const;
		expect(() =>
			decodeObservedLiveQueryPlan({ ...valid, bytesDigest: "f".repeat(64) }),
		).toThrow("bytes digest");
		expect(() =>
			decodeObservedLiveQueryPlan({
				...valid,
				queryIdentity: "messages.other",
			}),
		).toThrow("Query identity");

		const parsed = JSON.parse(new TextDecoder().decode(bytes));
		parsed.digest = "f".repeat(64);
		const forged = canonicalJsonLine(parsed);
		expect(() =>
			decodeObservedLiveQueryPlan({
				...valid,
				bytes: forged,
				bytesDigest: sha256Digest(forged),
			}),
		).toThrow("embedded digest");
	});
});
