import { describe, expect, test } from "bun:test";

import type { SQL } from "bun";

import { createPostgresLiveQueryRetention } from "../../packages/runtime/src/live-query/postgres-retention";

const digest = (value: string): string => value.repeat(64);
const binding = {
	applicationName: "collaboration",
	deploymentDigest: digest("a"),
	authorityPartitionDigest: digest("b"),
	queryIdentity: "messages.page",
	inputDigest: digest("c"),
	wireVersion: 2,
	retainedGeneration: 7n,
} as const;
const completeResult = {
	binding,
	resultBytes: new TextEncoder().encode('{"messages":[]}\n'),
	dependencyPlanBytes: new TextEncoder().encode('{"tokens":[]}\n'),
} as const;

describe("BETA-07 PostgreSQL retained Live Query result", () => {
	test("mints one opaque authenticated token bound to the complete acknowledged result", () => {
		const retention = createPostgresLiveQueryRetention({
			sql: {} as SQL,
			hmacKey: new Uint8Array(32).fill(17),
		});
		const first = retention.mint(completeResult);
		const repeated = retention.mint(completeResult);
		const nextGeneration = retention.mint({
			...completeResult,
			binding: { ...binding, retainedGeneration: 8n },
		});

		expect(first).toBe(repeated);
		expect(first).not.toBe(nextGeneration);
		expect(first).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
		expect(first).not.toContain("collaboration");
	});

	test("rejects weak keys and oversized complete results before PostgreSQL", () => {
		expect(() =>
			createPostgresLiveQueryRetention({
				sql: {} as SQL,
				hmacKey: new Uint8Array(31),
			}),
		).toThrow(/HMAC key/);
		const retention = createPostgresLiveQueryRetention({
			sql: {} as SQL,
			hmacKey: new Uint8Array(32),
		});
		expect(() =>
			retention.mint({
				...completeResult,
				resultBytes: new Uint8Array(1_048_577),
			}),
		).toThrow(/result byte limit/);
		expect(() =>
			retention.mint({
				...completeResult,
				binding: {
					...binding,
					retainedGeneration: 9_223_372_036_854_775_808n,
				},
			}),
		).toThrow(/retained generation/);
	});

	test("rejects caller-supplied generation from the opaque resume lookup", async () => {
		const retention = createPostgresLiveQueryRetention({
			sql: {} as SQL,
			hmacKey: new Uint8Array(32),
		});
		await expect(
			retention.resume({
				binding,
				resumeToken: "opaque",
			}),
		).rejects.toThrow("lookup binding keys are invalid");
	});
});
