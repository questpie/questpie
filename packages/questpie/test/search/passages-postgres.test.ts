import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { sql } from "drizzle-orm";

import { PostgresPassageSearchAdapter } from "../../src/exports/adapters/postgres-passage-search.js";
import { collection } from "../../src/exports/index.js";
import { PassageSearch } from "../../src/exports/search.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const documents = collection("documents")
	.fields(({ f }) => ({
		title: f.text().required(),
		body: f.textarea(),
		tenant: f.text().required(),
		version: f.number().required().default(1),
		readable: f.boolean().required().default(true),
	}))
	.access({
		read: ({ session }) =>
			session ? { tenant: session.user.id, readable: true } : false,
	});
const privateFields = collection("private_fields").fields(({ f }) => ({
	body: f.textarea().access({ read: false }),
}));
const url = process.env.RAG_TEST_DATABASE_URL;

describe.skipIf(!url)("Revision-pinned passages on PostgreSQL", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let search: PassageSearch;
	let control: SQL;
	const database = `rag_${crypto.randomUUID().replaceAll("-", "")}`;
	const profile = { id: "test-3d-v1", dimensions: 3 };
	const source = {
		collection: "documents",
		tokenFields: ["version", "title", "body", "tenant"],
		projectionFields: ["title", "body"],
	};
	const reader = (id: string) =>
		({ session: { user: { id }, session: { id: `session-${id}` } } }) as any;
	beforeAll(async () => {
		control = new SQL(url!);
		await control.unsafe(`CREATE DATABASE ${database}`);
		const testUrl = new URL(url!);
		testUrl.pathname = `/${database}`;
		setup = await buildMockApp(
			{ collections: { documents, privateFields } },
			{ db: { url: testUrl.href }, search: new PostgresPassageSearchAdapter() },
		);
		await setup.app.db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
		await setup.app.db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
		await runTestDbMigrations(setup.app);
		search = new PassageSearch(setup.app, [source], profile);
	}, 60000);
	afterAll(async () => {
		await setup?.cleanup();
		await control?.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
		await control?.close();
	});
	async function indexed(
		tenant: string,
		title: string,
		vector = [1, 0, 0],
		partition = tenant,
	) {
		const row = await setup.app.collections.documents.create(
			{ title, body: "orchid policy", tenant },
			{ accessMode: "system" },
		);
		const token = (await search.writer.sourceToken("documents", row.id))!;
		const input = {
			collection: "documents",
			recordId: row.id,
			partition,
			representation: "live",
			expectedSourceToken: token,
			title,
			metadata: {},
			blocks: [
				{
					field: "content" as const,
					text: "orchid policy",
					locator: { page: 1 },
					embedding: vector,
				},
			],
		};
		expect(await search.writer.replace(input)).toBe("replaced");
		return { row, input, token };
	}

	test("folds case and accents without changing source text", async () => {
		const a = await indexed("accent", "Žltá zmluva o spolupráci");
		await search.writer.replace({
			...a.input,
			blocks: [{ field: "title", text: a.input.title, locator: {} }],
		});
		for (const query of [
			"zlta zmluva o spolupraci",
			"ŽLTÁ ZMLUVA O SPOLUPRÁCI",
			"Žltá zmluva o spolupráci".normalize("NFD"),
		]) {
			const hits = await search.search(
				{ partition: "accent", query },
				reader("accent"),
			);
			expect(hits.map((hit) => hit.recordId)).toEqual([a.row.id]);
			expect(hits[0]!.text).toBe(a.input.title);
		}
		const b = await indexed("accent-reverse", "Uloha");
		await search.writer.replace({
			...b.input,
			blocks: [{ field: "title", text: b.input.title, locator: {} }],
		});
		expect(
			(
				await search.search(
					{ partition: "accent-reverse", query: "úloha" },
					reader("accent-reverse"),
				)
			).map((hit) => hit.recordId),
		).toEqual([b.row.id]);
	});

	test("bounded title typos follow exact hits and obey authority before limit", async () => {
		const typo = await indexed("typo", "Projekt");
		const exact = await indexed("typo", "Projket");
		for (const entry of [typo, exact])
			await search.writer.replace({
				...entry.input,
				blocks: [{ field: "title", text: entry.input.title, locator: {} }],
			});
		for (let i = 0; i < 4; i++) {
			const hidden = await indexed("hidden-typo", "Projket", [1, 0, 0], "typo");
			await search.writer.replace({
				...hidden.input,
				blocks: [{ field: "title", text: hidden.input.title, locator: {} }],
			});
		}
		const query = {
			partition: "typo",
			query: "projket",
			typoTolerance: "bounded" as const,
			limit: 2,
		};
		expect(
			(await search.search(query, reader("typo"))).map((hit) => hit.recordId),
		).toEqual([exact.row.id, typo.row.id]);
		expect(
			(
				await search.search({ ...query, typoTolerance: "none" }, reader("typo"))
			).map((hit) => hit.recordId),
		).toEqual([exact.row.id]);
		const id = await indexed("typo-id", "RAG-12345");
		await search.writer.replace({
			...id.input,
			blocks: [{ field: "title", text: id.input.title, locator: {} }],
		});
		expect(
			await search.search(
				{ partition: "typo-id", query: "RAG-13245", typoTolerance: "bounded" },
				reader("typo-id"),
			),
		).toEqual([]);
		const invoice = await indexed("typo-id", "INVOICE-12345 draft");
		await search.writer.replace({
			...invoice.input,
			blocks: [{ field: "title", text: invoice.input.title, locator: {} }],
		});
		for (const query of [
			"INVOICCE/12345",
			"INVOICCE 12345",
			"INVOICCE-12345 draft",
		])
			expect(
				await search.search(
					{ partition: "typo-id", query, typoTolerance: "bounded" },
					reader("typo-id"),
				),
			).toEqual([]);
	});

	test("typo fallback shares the document cap with primary passages", async () => {
		const mixed = await indexed("typo-cap", "Projket");
		const other = await indexed("typo-cap", "Projekt report");
		await search.writer.replace({
			...mixed.input,
			blocks: [
				{ field: "title", text: "Projket", locator: {} },
				{ field: "title", text: "Projekt", locator: {} },
			],
		});
		await search.writer.replace({
			...other.input,
			blocks: [{ field: "title", text: other.input.title, locator: {} }],
		});
		const hits = await search.search(
			{
				partition: "typo-cap",
				query: "projket",
				typoTolerance: "bounded",
				limit: 2,
				maxPassagesPerDocument: 1,
			},
			reader("typo-cap"),
		);
		expect(hits.map((hit) => hit.recordId)).toEqual([
			mixed.row.id,
			other.row.id,
		]);
	});

	test("hybrid fusion preserves the per-document passage cap", async () => {
		const first = await indexed("hybrid-cap", "Needle");
		const second = await indexed("hybrid-cap", "Needle other");
		for (const entry of [first, second])
			await search.writer.replace({
				...entry.input,
				blocks: [
					{
						field: "title",
						text: entry.input.title,
						locator: {},
						embedding: [0, 1, 0],
					},
					{
						field: "content",
						text: "semantic evidence",
						locator: {},
						embedding: [1, 0, 0],
					},
				],
			});
		const hits = await search.search(
			{
				partition: "hybrid-cap",
				query: "needle",
				mode: "hybrid",
				vector: [1, 0, 0],
				limit: 4,
				maxPassagesPerDocument: 1,
			},
			reader("hybrid-cap"),
		);
		expect(hits).toHaveLength(2);
		expect(new Set(hits.map((hit) => hit.recordId)).size).toBe(2);
	});

	test("bounded typos change at most one query term", async () => {
		const entry = await indexed("typo-budget", "Projekt report");
		await search.writer.replace({
			...entry.input,
			blocks: [{ field: "title", text: entry.input.title, locator: {} }],
		});
		for (const query of ["projket report", "projekt repotr"])
			expect(
				(
					await search.search(
						{ partition: "typo-budget", query, typoTolerance: "bounded" },
						reader("typo-budget"),
					)
				).map((hit) => hit.recordId),
			).toEqual([entry.row.id]);
		expect(
			await search.search(
				{
					partition: "typo-budget",
					query: "projket repotr",
					typoTolerance: "bounded",
				},
				reader("typo-budget"),
			),
		).toEqual([]);
	});

	test("filters tenant and live authority before exact vector top-k", async () => {
		for (let i = 0; i < 9; i++)
			await indexed("forbidden", `hidden-${i}`, [1, 0, 0], "visible");
		await indexed("visible", "Visible", [0.2, 0.8, 0]);
		const query = {
			partition: "visible",
			query: "orchid",
			vector: [1, 0, 0],
			mode: "semantic" as const,
			limit: 1,
		};
		const hits = await search.search(query, reader("visible"));
		expect(hits.map((h) => h.title)).toEqual(["Visible"]);
		expect(
			await search.search(
				{ ...query, partition: "forbidden" },
				reader("visible"),
			),
		).toEqual([]);
		expect(await search.search(query, {})).toEqual([]);
	});

	test("source edits immediately withdraw old text and reject delayed workers", async () => {
		const { row, input, token } = await indexed("edits", "Original");
		const [hit] = await search.search(
			{ partition: "edits", query: "orchid" },
			reader("edits"),
		);
		expect(hit).toBeDefined();
		expect(await search.writer.replace(input)).toBe("unchanged");
		await setup.app.collections.documents.update(
			{ where: { id: row.id }, data: { version: 2, body: "new text" } },
			{ accessMode: "system" },
		);
		expect(
			await search.search(
				{ partition: "edits", query: "orchid" },
				reader("edits"),
			),
		).toEqual([]);
		expect(await search.writer.replace(input)).toBe("stale");
		expect(
			(
				await search.read(
					{
						partition: "edits",
						documentId: hit!.documentId,
						sourceToken: token,
						manifestHash: hit!.manifestHash,
					},
					reader("edits"),
				)
			).status,
		).toBe("unavailable");
	});

	test("exact reads repeat authority and profile generations do not mix", async () => {
		const { token } = await indexed("reads", "Read me");
		const [hit] = await search.search(
			{ partition: "reads", query: "orchid" },
			reader("reads"),
		);
		const selector = {
			partition: "reads",
			documentId: hit!.documentId,
			sourceToken: token,
			manifestHash: hit!.manifestHash,
		};
		expect(
			(await search.read(selector, reader("reads"))).blocks[0]?.locator,
		).toEqual({ page: 1 });
		expect((await search.read(selector, reader("someone-else"))).status).toBe(
			"unavailable",
		);
		const next = new PassageSearch(setup.app, [source], {
			id: "test-2d-v2",
			dimensions: 2,
		});
		expect(
			await next.search(
				{ partition: "reads", query: "orchid" },
				reader("reads"),
			),
		).toEqual([]);
		expect((await next.read(selector, reader("reads"))).status).toBe(
			"unavailable",
		);
	});

	test("a replacement manifest cannot silently change a previously cited passage", async () => {
		const { input } = await indexed("manifests", "Evidence");
		const [hit] = await search.search(
			{ partition: "manifests", query: "orchid" },
			reader("manifests"),
		);
		await search.writer.replace({
			...input,
			blocks: [{ ...input.blocks[0]!, text: "different extraction" }],
		});
		expect(
			(
				await search.read(
					{
						partition: "manifests",
						documentId: hit!.documentId,
						sourceToken: hit!.sourceToken,
						manifestHash: hit!.manifestHash,
					},
					reader("manifests"),
				)
			).status,
		).toBe("unavailable");
		const [replacement] = await search.search(
			{ partition: "manifests", query: "different" },
			reader("manifests"),
		);
		expect(replacement!.id).not.toBe(hit!.id);
	});

	test("revocation hides search and exact reads even when the content token is unchanged", async () => {
		const { row, token } = await indexed("revocation", "Restricted later");
		const [hit] = await search.search(
			{ partition: "revocation", query: "orchid" },
			reader("revocation"),
		);
		await setup.app.collections.documents.update(
			{ where: { id: row.id }, data: { readable: false } },
			{ accessMode: "system" },
		);
		expect(await search.writer.sourceToken("documents", row.id)).toBe(token);
		expect(
			await search.search(
				{ partition: "revocation", query: "orchid" },
				reader("revocation"),
			),
		).toEqual([]);
		expect(
			(
				await search.read(
					{
						partition: "revocation",
						documentId: hit!.documentId,
						sourceToken: token,
						manifestHash: hit!.manifestHash,
					},
					reader("revocation"),
				)
			).status,
		).toBe("unavailable");
	});

	test("rejects fields whose content is not safe for every row reader", () => {
		expect(
			() =>
				new PassageSearch(
					setup.app,
					[
						{
							collection: "privateFields",
							tokenFields: ["body"],
							projectionFields: ["body"],
						},
					],
					profile,
				),
		).toThrow();
	});

	test("reconciliation respects retry deadlines, source edits and eligibility", async () => {
		const { row, input, token } = await indexed("retry", "Retry policy");
		const pending = () =>
			search.writer.pending("documents", "retry", { tenant: "retry" });
		expect(await search.writer.isCurrent("documents", row.id, token)).toBe(
			true,
		);
		expect(await pending()).toEqual([]);
		await search.writer.replace({
			...input,
			retryAt: new Date(Date.now() + 60000),
		});
		expect(await pending()).toEqual([]);
		await search.writer.replace({
			...input,
			retryAt: new Date(Date.now() - 1000),
		});
		expect(await search.writer.isCurrent("documents", row.id, token)).toBe(
			false,
		);
		expect(await pending()).toEqual([row.id]);
		await setup.app.collections.documents.update(
			{ where: { id: row.id }, data: { readable: false } },
			{ accessMode: "system" },
		);
		const eligible = new PassageSearch(
			setup.app,
			[{ ...source, where: { readable: true } }],
			profile,
		);
		expect(await eligible.writer.sourceToken("documents", row.id)).toBeNull();
		expect(await eligible.writer.replace(input)).toBe("stale");
		expect(
			await eligible.writer.pending("documents", "retry", { tenant: "retry" }),
		).toEqual([]);
		await search.writer.remove("documents", row.id);
		expect(await search.writer.isCurrent("documents", row.id, token)).toBe(
			false,
		);
	});

	test("passage caps preserve document diversity before the candidate limit", async () => {
		const { input } = await indexed("diversity", "Long document");
		await search.writer.replace({
			...input,
			blocks: Array.from({ length: 20 }, (_, page) => ({
				...input.blocks[0]!,
				locator: { page },
			})),
		});
		await indexed("diversity", "Short document", [0.8, 0.2, 0]);
		const hits = await search.search(
			{
				partition: "diversity",
				query: "orchid",
				vector: [1, 0, 0],
				mode: "semantic",
				limit: 2,
				maxPassagesPerDocument: 1,
			},
			reader("diversity"),
		);
		expect(hits.map((hit) => hit.title)).toEqual([
			"Long document",
			"Short document",
		]);
	});

	test("live discovery excludes other representations", async () => {
		const { row, input } = await indexed("representation", "Live document");
		await search.writer.replace({ ...input, representation: "published" });
		expect(
			await search.search(
				{ partition: "representation", query: "orchid" },
				reader("representation"),
			),
		).toHaveLength(1);
		await search.writer.remove("documents", row.id);
		await search.writer.replace({ ...input, representation: "published" });
		expect(
			await search.search(
				{ partition: "representation", query: "orchid" },
				reader("representation"),
			),
		).toEqual([]);
	});

	test.skipIf(!process.env.RAG_SCALE_PROOF)(
		"measures authorized 768d retrieval across 1000 tenants with skew",
		async () => {
			const table = setup.app.getCollections().documents.table;
			await setup.app.db
				.execute(sql`INSERT INTO ${table} (id, title, body, tenant, version, readable)
			SELECT 'load-' || n, 'Load document', 'load needle', 'load-tenant-' || (n % 1000), 1, true
			FROM generate_series(1, 100000) n`);
			await setup.app.db
				.execute(sql`INSERT INTO ${table} (id, title, body, tenant, version, readable)
			SELECT 'skew-' || n, 'Load document', 'load needle', 'load-tenant-0', 1, true
			FROM generate_series(1, 10000) n`);
			await setup.app.db.execute(sql`INSERT INTO questpie_search_documents
			(id, collection_name, record_id, partition_key, representation, profile, source_token, manifest_hash, title, metadata)
			SELECT 'index-' || id, 'documents', id, tenant, 'live', 'load-768-v1',
			md5(jsonb_build_array(version, title, body, tenant)::text), 'load-manifest', title, '{}'::jsonb
			FROM ${table} WHERE tenant LIKE 'load-tenant-%'`);
			const vector = Array.from({ length: 768 }, (_, index) =>
				index === 0 ? 1 : 0,
			);
			await setup.app.db.execute(sql`INSERT INTO questpie_search_passages
			(id, document_id, ordinal, field, text, locator, embedding)
			SELECT 'passage-' || id, id, 0, 'content', 'load needle', '{}'::jsonb, ${JSON.stringify(vector)}::vector
			FROM questpie_search_documents WHERE profile = 'load-768-v1'`);
			await setup.app.db.execute(sql`ANALYZE`);
			const loaded = new PassageSearch(setup.app, [source], {
				id: "load-768-v1",
				dimensions: 768,
			});
			for (const tenant of ["load-tenant-42", "load-tenant-0"]) {
				const samples: number[] = [];
				for (let repeat = 0; repeat < 12; repeat++) {
					const start = performance.now();
					const hits = await loaded.search(
						{
							partition: tenant,
							query: "load",
							vector,
							mode: "hybrid",
							limit: 20,
							maxPassagesPerDocument: 1,
						},
						reader(tenant),
					);
					samples.push(performance.now() - start);
					expect(hits).toHaveLength(20);
				}
				samples.sort((a, b) => a - b);
				console.log(
					JSON.stringify({
						tenants: 1000,
						totalPassages: 110000,
						dimensions: 768,
						tenant,
						samples: samples.length,
						p50Ms: samples[6],
						p95Ms: samples[11],
					}),
				);
			}
		},
		180000,
	);
});
