import { describe, expect, it, vi } from "vitest";

import {
	injectMemoriesIntoInstructions,
	type MemoryInjectionCollections,
	type MemorySearchService,
} from "../lib/memory-injection";

/** A semantic-search double over `agent_memory` returning `{recordId, score}` hits. */
function fakeSearch(
	hits: Array<{ recordId: string; score: number }>,
): MemorySearchService & { calls: any[] } {
	const calls: any[] = [];
	return {
		calls,
		async search(args) {
			calls.push(args);
			return { results: hits };
		},
	};
}

/**
 * An `agent_memory` collection double: `find` returns the authoritative rows for the
 * requested ids; `findOne`/`updateById` back the access bump.
 */
function fakeCollections(
	rows: Array<Record<string, unknown>> = [],
): MemoryInjectionCollections & {
	updates: Array<{ id: string; data: Record<string, unknown> }>;
} {
	const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
	const byId = new Map(rows.map((r) => [String(r.id), r]));
	return {
		updates,
		agent_memory: {
			find: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
				const idFilter = where.id as { in?: string[] } | undefined;
				const ids = idFilter?.in ?? [];
				return { docs: ids.map((id) => byId.get(id)).filter(Boolean) as any[] };
			}),
			findOne: vi.fn(async () => ({ accessCount: 0 })),
			updateById: vi.fn(
				async (args: { id: string; data: Record<string, unknown> }) => {
					updates.push(args);
				},
			),
		},
	};
}

function memoryRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "m1",
		content: "stagger posts >=15s",
		importance: 8,
		status: "active",
		scopeType: "company",
		scopeRef: null,
		type: "semantic",
		lastAccessedAt: null,
		...overrides,
	};
}

describe("injectMemoriesIntoInstructions", () => {
	it("returns base instructions UNCHANGED when no search backend is configured", async () => {
		const collections = fakeCollections();
		const out = await injectMemoriesIntoInstructions(
			{ search: null, collections },
			"Do the task.",
			"the query",
		);
		expect(out).toBe("Do the task.");
	});

	it("returns base instructions unchanged when search yields nothing", async () => {
		const search = fakeSearch([]);
		const collections = fakeCollections();
		const out = await injectMemoriesIntoInstructions(
			{ search, collections },
			"Do the task.",
			"the query",
		);
		expect(out).toBe("Do the task.");
	});

	it("PREPENDS the delimited memory block (as DATA) above the base instructions", async () => {
		const search = fakeSearch([{ recordId: "m1", score: 0.9 }]);
		const collections = fakeCollections([memoryRow()]);
		const out = await injectMemoriesIntoInstructions(
			{ search, collections },
			"Do the task.",
			"the query",
		);
		expect(out.startsWith("===== BEGIN WHAT I'VE LEARNED")).toBe(true);
		expect(out).toContain("## What I've learned (relevant)");
		expect(out).toContain("- (semantic) stagger posts >=15s");
		expect(out.endsWith("Do the task.")).toBe(true);
	});

	it("issues a SEMANTIC search over agent_memory", async () => {
		const search = fakeSearch([]);
		const collections = fakeCollections();
		await injectMemoriesIntoInstructions(
			{ search, collections, projectId: "p1" },
			"base",
			"my query",
		);
		expect(search.calls).toHaveLength(1);
		expect(search.calls[0].mode).toBe("semantic");
		expect(search.calls[0].collections).toEqual(["agent_memory"]);
		expect(search.calls[0].query).toBe("my query");
	});

	it("excludes a stale row even if it is a semantic hit (authoritative status join)", async () => {
		const search = fakeSearch([
			{ recordId: "m1", score: 0.9 },
			{ recordId: "m2", score: 0.95 },
		]);
		const collections = fakeCollections([
			memoryRow({ id: "m1", status: "active", content: "active lesson" }),
			memoryRow({ id: "m2", status: "stale", content: "stale lesson" }),
		]);
		const out = await injectMemoriesIntoInstructions(
			{ search, collections },
			"base",
			"q",
		);
		expect(out).toContain("active lesson");
		expect(out).not.toContain("stale lesson");
	});

	it("bumps access on the injected memories", async () => {
		const search = fakeSearch([{ recordId: "m1", score: 0.9 }]);
		const collections = fakeCollections([memoryRow()]);
		await injectMemoriesIntoInstructions(
			{ search, collections },
			"base",
			"query",
		);
		expect(collections.updates).toHaveLength(1);
		expect(collections.updates[0].id).toBe("m1");
		expect(collections.updates[0].data).toHaveProperty("lastAccessedAt");
		expect(collections.updates[0].data.accessCount).toBe(1);
	});

	it("DEGRADES to base instructions when semantic search throws (e.g. not implemented)", async () => {
		const throwingSearch: MemorySearchService = {
			async search() {
				throw new Error("Semantic search not yet implemented");
			},
		};
		const collections = fakeCollections();
		const warn = vi.fn();
		const out = await injectMemoriesIntoInstructions(
			{ search: throwingSearch, collections },
			"Do the task.",
			"query",
			{ warn },
		);
		expect(out).toBe("Do the task.");
		expect(warn).toHaveBeenCalled();
	});

	it("still injects even if the access bump fails (best-effort bump)", async () => {
		const search = fakeSearch([{ recordId: "m1", score: 0.9 }]);
		const collections = fakeCollections([memoryRow()]);
		collections.agent_memory.updateById = vi.fn(async () => {
			throw new Error("db down");
		});
		const warn = vi.fn();
		const out = await injectMemoriesIntoInstructions(
			{ search, collections },
			"Do the task.",
			"query",
			{ warn },
		);
		expect(out).toContain("## What I've learned (relevant)");
		expect(warn).toHaveBeenCalled();
	});
});
