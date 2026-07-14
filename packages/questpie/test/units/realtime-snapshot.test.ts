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

	it("runs global gets without rebuilding CRUD", async () => {
		let getCalls = 0;
		const context = { locale: "sk" };
		const result = { siteName: "Questpie" };

		await expect(
			computeRealtimeSnapshot(
				{
					type: "global",
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
