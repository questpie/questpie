import { describe, expect, test } from "bun:test";
import {
	computeMatchHash,
	getMatchHashesForDispatch,
	WILDCARD_HASH,
} from "../../src/server/engine/match-hash.js";

describe("computeMatchHash", () => {
	test("returns wildcard for null criteria", () => {
		expect(computeMatchHash(null)).toBe(WILDCARD_HASH);
	});

	test("returns wildcard for undefined criteria", () => {
		expect(computeMatchHash(undefined)).toBe(WILDCARD_HASH);
	});

	test("returns wildcard for empty object", () => {
		expect(computeMatchHash({})).toBe(WILDCARD_HASH);
	});

	test("returns hash prefixed with 'mh:'", () => {
		const hash = computeMatchHash({ orderId: "abc" });
		expect(hash.startsWith("mh:")).toBe(true);
	});

	test("same criteria produces same hash", () => {
		const h1 = computeMatchHash({ orderId: "abc" });
		const h2 = computeMatchHash({ orderId: "abc" });
		expect(h1).toBe(h2);
	});

	test("different criteria produces different hash", () => {
		const h1 = computeMatchHash({ orderId: "abc" });
		const h2 = computeMatchHash({ orderId: "def" });
		expect(h1).not.toBe(h2);
	});

	test("key order does not affect hash", () => {
		const h1 = computeMatchHash({ a: 1, b: 2 });
		const h2 = computeMatchHash({ b: 2, a: 1 });
		expect(h1).toBe(h2);
	});

	test("nested objects are hashed deterministically", () => {
		const h1 = computeMatchHash({ user: { id: 1, name: "foo" } });
		const h2 = computeMatchHash({ user: { name: "foo", id: 1 } });
		expect(h1).toBe(h2);
	});

	test("different types produce different hashes", () => {
		const h1 = computeMatchHash({ x: 1 });
		const h2 = computeMatchHash({ x: "1" });
		expect(h1).not.toBe(h2);
	});
});

describe("getMatchHashesForDispatch", () => {
	test("always includes wildcard hash", () => {
		const hashes = getMatchHashesForDispatch({ orderId: "abc" });
		expect(hashes).toContain(WILDCARD_HASH);
	});

	test("includes specific hash when match data is provided", () => {
		const hashes = getMatchHashesForDispatch({ orderId: "abc" });
		expect(hashes.length).toBe(2);
		expect(hashes[1]!.startsWith("mh:")).toBe(true);
	});

	test("returns only wildcard for null match data", () => {
		const hashes = getMatchHashesForDispatch(null);
		expect(hashes).toEqual([WILDCARD_HASH]);
	});

	test("returns only wildcard for empty match data", () => {
		const hashes = getMatchHashesForDispatch({});
		expect(hashes).toEqual([WILDCARD_HASH]);
	});
});
