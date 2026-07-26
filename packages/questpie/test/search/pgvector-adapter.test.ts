/**
 * PgVectorSearchAdapter — semantic path + embedding-on-index, mock-tested.
 *
 * These tests exercise the adapter's QUERY CONSTRUCTION and the embedding wiring
 * with a MOCK db + MOCK embedding provider — NO live Postgres / pgvector / OpenAI.
 * They prove: (1) `index()` generates an embedding and issues the vector-store
 * UPDATE; (2) the `semantic` search embeds the query and runs a cosine ORDER BY;
 * (3) `toVectorLiteral` formats + guards the vector. The live pgvector round-trip
 * (real cosine ranking against a real index) is a separate live e2e — see the task
 * report. The base-adapter delegation (lexical → Postgres) is covered by the
 * Postgres adapter's own behavior.
 */
import { describe, expect, it, mock } from "bun:test";

import { collection } from "../../src/exports/index.js";
import {
	PgVectorSearchAdapter,
	toVectorLiteral,
} from "../../src/server/modules/core/integrated/search/adapters/pgvector.js";
import type { EmbeddingProvider } from "../../src/server/modules/core/integrated/search/types.js";

/** A deterministic embedding provider double (records the texts it embeds). */
function fakeProvider(vector: number[] = [0.1, 0.2, 0.3]): EmbeddingProvider & {
	calls: string[];
} {
	const calls: string[] = [];
	return {
		name: "fake",
		model: "fake-embed",
		dimensions: vector.length,
		async generate(text: string) {
			calls.push(text);
			return vector;
		},
		calls,
	};
}

/**
 * A recording mock db. Captures `.execute()` SQL fragments and serves a fluent
 * `.select().from().where().orderBy().limit().offset()` chain that resolves to the
 * provided rows. The chain is thenable so `await db.select()...` works.
 */
function fakeDb(rows: any[] = []) {
	const executed: any[] = [];
	const selectChainCalls: Record<string, number> = {};

	const makeThenable = () => {
		const chain: any = {};
		for (const method of ["from", "where", "orderBy", "limit", "offset"]) {
			chain[method] = mock((..._args: any[]) => {
				selectChainCalls[method] = (selectChainCalls[method] ?? 0) + 1;
				return chain;
			});
		}
		// The drizzle select chain is awaited directly, so the mock terminal must be
		// thenable to resolve the rows. This is a deliberate test double.
		// oxlint-disable-next-line no-thenable -- intentional thenable mock of the drizzle query builder
		chain.then = (resolve: (v: any[]) => void) => resolve(rows);
		return chain;
	};

	// The base PostgresSearchAdapter.index() does an upsert:
	//   db.insert(t).values(...).onConflictDoUpdate(...).returning(...) → [{ id }]
	// We stub that chain to resolve a single returned row so the lexical upsert
	// succeeds and control returns to the pgvector embedding-store step.
	const makeInsertChain = () => {
		const chain: any = {};
		chain.values = mock(() => chain);
		chain.onConflictDoUpdate = mock(() => chain);
		chain.returning = mock(() => Promise.resolve([{ id: "search-row-1" }]));
		return chain;
	};

	const db = {
		execute: mock((fragment: any) => {
			executed.push(fragment);
			return Promise.resolve({ rows: [] });
		}),
		select: mock((_columns?: any) => makeThenable()),
		insert: mock((_table?: any) => makeInsertChain()),
		delete: mock((_table?: any) => ({
			where: mock(() => Promise.resolve()),
		})),
		executed,
		selectChainCalls,
	};
	return db;
}

/** Build an initialized adapter over a mock db + provider. */
async function makeAdapter(rows: any[] = [], vector?: number[]) {
	const provider = fakeProvider(vector);
	const adapter = new PgVectorSearchAdapter({ embeddingProvider: provider });
	const db = fakeDb(rows);
	await adapter.initialize({
		db: db as any,
		logger: { debug() {}, info() {}, warn() {}, error() {} },
	});
	return { adapter, db, provider };
}

describe("toVectorLiteral", () => {
	it("formats a number[] as a bracketed pgvector literal", () => {
		expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
	});

	it("throws on a non-finite value (fail-closed on a bad provider response)", () => {
		expect(() => toVectorLiteral([0.1, Number.NaN])).toThrow("non-finite");
		expect(() => toVectorLiteral([Number.POSITIVE_INFINITY])).toThrow();
	});
});

describe("capabilities", () => {
	it("advertises semantic but not unimplemented hybrid fusion", async () => {
		const { adapter } = await makeAdapter();
		expect(adapter.capabilities.semantic).toBe(true);
		expect(adapter.capabilities.hybrid).toBe(false);
		expect(adapter.capabilities.lexical).toBe(true);
	});
});

describe("getMigrations — pgvector steps appended", () => {
	it("includes the 007/008/009 vector migrations after the base ones", async () => {
		const { adapter } = await makeAdapter();
		const names = adapter.getMigrations().map((m) => m.name);
		expect(names).toContain("search_007_pgvector_extension");
		expect(names).toContain("search_008_embedding_column");
		expect(names).toContain("search_009_embedding_index");
		// The embedding column migration pins the provider's dimensions.
		const col = adapter
			.getMigrations()
			.find((m) => m.name === "search_008_embedding_column");
		expect(col?.up).toContain("vector(3)"); // fakeProvider default = 3 dims
	});
});

describe("index() — generates + stores the embedding", () => {
	it("embeds title+content and issues a vector-store UPDATE", async () => {
		const { adapter, db, provider } = await makeAdapter();
		await adapter.index({
			collection: "agent_memory",
			recordId: "m1",
			locale: "en",
			title: "Lesson",
			content: "stagger posts >=15s",
		});

		// The provider embedded the concatenated title + content.
		expect(provider.calls).toEqual(["Lesson stagger posts >=15s"]);
		// An UPDATE ... SET embedding was issued (the vector-store step). The base
		// adapter's lexical upsert uses .insert (not captured by this mock), so the
		// ONLY db.execute is the embedding UPDATE.
		expect(db.execute).toHaveBeenCalledTimes(1);
	});

	it("accepts a precomputed embedding without calling the provider", async () => {
		const { adapter, db, provider } = await makeAdapter();
		await adapter.index({
			collection: "agent_memory",
			recordId: "m2",
			locale: "en",
			title: "T",
			content: "C",
			embedding: [0.9, 0.8, 0.7],
		});
		// Provider NOT called (the caller supplied the vector).
		expect(provider.calls).toEqual([]);
		expect(db.execute).toHaveBeenCalledTimes(1);
	});

	it("skips the embedding when there is no text (column stays NULL)", async () => {
		const { adapter, db, provider } = await makeAdapter();
		await adapter.index({
			collection: "agent_memory",
			recordId: "m3",
			locale: "en",
			title: "",
			content: "",
		});
		expect(provider.calls).toEqual([]);
		// No UPDATE issued — nothing to store.
		expect(db.execute).toHaveBeenCalledTimes(0);
	});
});

describe("search({ mode: 'semantic' }) — embeds query + cosine ORDER BY", () => {
	it("embeds the query and runs a scoped vector select", async () => {
		const rows = [
			{
				id: "s1",
				collection_name: "agent_memory",
				record_id: "m1",
				title: "Lesson",
				content: "stagger posts",
				metadata: { importance: 8 },
				locale: "en",
				updated_at: new Date(),
				score: 0.92,
				count: 7,
			},
		];
		const { adapter, db, provider } = await makeAdapter(rows);

		const response = await adapter.search({
			query: "how to schedule posts",
			mode: "semantic",
			collections: ["agent_memory"],
			filters: { status: "active", scopeType: "company" },
			limit: 5,
		});

		// The query was embedded once.
		expect(provider.calls).toEqual(["how to schedule posts"]);
		// A fluent select chain was built (from→where→orderBy→limit→offset).
		expect(db.select).toHaveBeenCalledTimes(2);
		expect(db.selectChainCalls.where).toBe(2);
		expect(db.selectChainCalls.orderBy).toBe(1);
		expect(db.selectChainCalls.limit).toBe(1);

		// The row is mapped into the SearchResult shape (record_id → recordId, etc.).
		expect(response.results).toHaveLength(1);
		expect(response.results[0]).toMatchObject({
			recordId: "m1",
			collection: "agent_memory",
			score: 0.92,
			metadata: { importance: 8 },
		});
		expect(response.total).toBe(7);
	});

	it("rejects hybrid instead of silently delegating to lexical", async () => {
		const { adapter, provider } = await makeAdapter();
		await expect(
			adapter.search({ query: "x", mode: "hybrid", collections: ["c"] }),
		).rejects.toThrow('does not support "hybrid"');
		expect(provider.calls).toEqual([]);
	});

	it("applies canonical access candidates before semantic ordering and counting", async () => {
		const memories = collection("agent_memory").fields(({ f }) => ({
			title: f.text(255),
			tenantId: f.text(64),
		}));
		const rows = [
			{
				id: "s1",
				collection_name: "agent_memory",
				record_id: "m1",
				title: "Allowed",
				content: null,
				metadata: {},
				locale: "en",
				updated_at: new Date(),
				score: 0.9,
				count: 1,
			},
		];
		const { adapter, db } = await makeAdapter(rows);

		const response = await adapter.search({
			query: "allowed",
			mode: "semantic",
			collections: ["agent_memory"],
			accessFilters: [
				{
					collection: "agent_memory",
					table: memories.table,
					state: memories.state,
					accessWhere: { tenantId: { in: ["tenant-a"] } },
					context: { locale: "en", accessMode: "user" },
				},
			],
		});

		expect(response.results.map((result) => result.recordId)).toEqual(["m1"]);
		expect(response.total).toBe(1);
		expect(db.selectChainCalls.where).toBe(2);
		expect(db.selectChainCalls.orderBy).toBe(1);
	});

	it("throws if used before initialize() (no db)", async () => {
		const provider = fakeProvider();
		const adapter = new PgVectorSearchAdapter({ embeddingProvider: provider });
		await expect(
			adapter.search({ query: "x", mode: "semantic" }),
		).rejects.toThrow("not initialized");
	});
});
