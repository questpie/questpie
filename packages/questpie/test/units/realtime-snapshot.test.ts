import { describe, expect, it } from "bun:test";

import { computeRealtimeSnapshot } from "../../src/server/modules/core/integrated/realtime/snapshot.js";

describe("computeRealtimeSnapshot", () => {
	it("runs collection finds with the resolved topic query", async () => {
		const calls: unknown[] = [];
		const result = { docs: [{ id: "post-1" }], totalDocs: 1 };
		const context = { locale: "en" };

		await expect(
			computeRealtimeSnapshot(
				{
					type: "collection",
					operation: "find",
					crud: {
						find: async (...args: unknown[]) => {
							calls.push(args);
							return result;
						},
					},
					where: { published: true },
					with: { author: true },
					limit: 10,
					offset: 2,
					orderBy: { createdAt: "desc" },
					locale: "en",
				},
				context,
			),
		).resolves.toBe(result);
		expect(calls).toEqual([
			[
				{
					where: { published: true },
					with: { author: true },
					limit: 10,
					offset: 2,
					orderBy: { createdAt: "desc" },
					locale: "en",
				},
				context,
			],
		]);
	});

	it("runs collection counts without materializing matching rows", async () => {
		let findCalls = 0;
		const countCalls: unknown[] = [];
		const context = { locale: "en" };
		const smallCrud = {
			find: async () => {
				findCalls += 1;
				return { docs: Array.from({ length: 10_000 }) };
			},
			count: async (...args: unknown[]) => {
				countCalls.push(args);
				return 1;
			},
		};
		const largeCrud = {
			find: async () => {
				findCalls += 1;
				return { docs: Array.from({ length: 10_000 }) };
			},
			count: async () => 10_000,
		};

		const small = await computeRealtimeSnapshot(
			{
				type: "collection",
				operation: "count",
				crud: smallCrud,
				where: { published: true },
				locale: "en",
			},
			context,
		);
		const large = await computeRealtimeSnapshot(
			{
				type: "collection",
				operation: "count",
				crud: largeCrud,
			},
			context,
		);

		expect(findCalls).toBe(0);
		expect(countCalls).toHaveLength(1);
		expect(small).toBe(1);
		expect(large).toBe(10_000);
		expect(JSON.stringify(large).length).toBeLessThan(16);
	});

	it("runs collection gets through findOne", async () => {
		const calls: unknown[] = [];
		const context = { locale: "sk" };
		const result = { id: "post-1", title: "One" };
		const crud = {
			findOne: async (...args: unknown[]) => {
				calls.push(args);
				return result;
			},
		};

		await expect(
			computeRealtimeSnapshot(
				{
					type: "collection",
					operation: "get",
					recordId: "post-1",
					crud,
					with: { author: true },
					locale: "sk",
				},
				context,
			),
		).resolves.toBe(result);
		expect(calls).toEqual([
			[
				{
					where: { id: "post-1" },
					with: { author: true },
					locale: "sk",
				},
				context,
			],
		]);
	});

	it("runs global gets without rebuilding CRUD", async () => {
		let getCalls = 0;
		const context = { locale: "sk" };
		const result = { siteName: "Questpie" };

		await expect(
			computeRealtimeSnapshot(
				{
					type: "global",
					operation: "get",
					crud: {
						get: async () => {
							getCalls += 1;
							return result;
						},
					},
					with: { logo: true },
					locale: "sk",
				},
				context,
			),
		).resolves.toBe(result);
		expect(getCalls).toBe(1);
	});
});
