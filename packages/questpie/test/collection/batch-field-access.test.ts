import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";

import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { z } from "zod";

import {
	batchRead,
	collection,
	global,
	route,
} from "../../src/exports/index.js";
import { getRestrictedReadFields } from "../../src/server/collection/crud/shared/access-control.js";
import { getCurrentTransaction } from "../../src/server/collection/crud/shared/transaction.js";
import { executeJsonRoute } from "../../src/server/routes/execute.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createMockSession, createTestContext } from "../utils/test-context.js";
import { createTestDb, runTestDbMigrations } from "../utils/test-db.js";

describe("batch field read access", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let client: Awaited<ReturnType<typeof createTestDb>>;
	const statements: string[] = [];
	const batches: (readonly Record<string, unknown>[])[] = [];
	const observations: {
		db: unknown;
		ambient: unknown;
		isolation?: string;
		readOnly?: string;
	}[] = [];
	let rowCalls = 0;
	let hookCalls = 0;
	let malformed: "short" | "long" | "nonboolean" | undefined;
	const system = createTestContext();
	const user = createTestContext({
		accessMode: "user",
		session: createMockSession({ id: "reader" }),
	});
	const grants = collection("batch_grants").fields(({ f }) => ({
		document: f.text().required(),
		reader: f.text().required(),
	}));
	const grantTable = grants.build().table;
	const policy = batchRead(async ({ docs, db, user: identity, actor }) => {
		batches.push(docs.map((doc) => ({ ...doc })));
		if (malformed === "short") return [];
		if (malformed === "long") return docs.map(() => true).concat(true);
		if (malformed === "nonboolean") {
			return docs.map(() => "yes") as unknown as boolean[];
		}
		const reader =
			actor?.subjectId ?? (identity as { id?: string } | undefined)?.id;
		const facts = await db
			.select({
				document: grantTable.document,
				isolation: sql<string>`current_setting('transaction_isolation')`,
				readOnly: sql<string>`current_setting('transaction_read_only')`,
			})
			.from(grantTable)
			.where(
				inArray(
					grantTable.document,
					docs.map((doc) => String(doc.id)),
				),
			);
		observations.push({
			db,
			ambient: getCurrentTransaction(),
			isolation: facts[0]?.isolation,
			readOnly: facts[0]?.readOnly,
		});
		const allowed = new Set(
			facts.map((fact: { document: string }) => fact.document),
		);
		return docs.map((doc) => reader === "reader" && allowed.has(doc.id));
	});
	const documents = collection("batch_documents")
		.fields(({ f }) => ({
			parent: f.relation("batchParents").relationName("parent"),
			rank: f.number().required(),
			visible: f.boolean().required(),
			secret: f.text().access({ read: policy }),
			legacy: f.text().access({
				read: ({ doc }) => {
					rowCalls++;
					return Number(doc?.rank) % 2 === 0;
				},
			}),
			hidden: f.text().outputFalse().access({ read: policy }),
			serverOnly: f.text().inputFalse(),
			profile: f.object({ secret: f.text().access({ read: policy }) }),
			entries: f.object({ secret: f.text().access({ read: policy }) }).array(),
		}))
		.access({ read: () => ({ visible: true }) })
		.hooks({
			afterRead: ({ data, accessMode, operation }) => {
				hookCalls++;
				if (accessMode !== "system" && operation === "read") {
					expect(data).not.toHaveProperty("hidden");
					if (data.rank !== undefined && Number(data.rank) % 2 !== 0) {
						expect(data).not.toHaveProperty("secret");
					}
				}
			},
		});
	const documentTable = documents.build().table;
	const parents = collection("batch_parents")
		.fields(({ f }) => ({
			target: f.relation("batchDocuments"),
			children: f
				.relation("batchDocuments")
				.hasMany({ foreignKey: "parent", relationName: "parent" }),
		}))
		.access({ read: true });
	const settings = global("batch_settings")
		.fields(({ f }) => ({ secret: f.text().access({ read: policy }) }))
		.access({ read: true, update: true });
	const readPage = route()
		.post()
		.schema(z.object({ limit: z.number().int().min(1).max(100) }))
		.outputSchema(
			z.array(z.object({ id: z.string(), secret: z.string().optional() })),
		)
		.access(true)
		.query()
		.handler(async ({ input, collections }) => {
			const page = await collections.batchDocuments.find({
				limit: input.limit,
				orderBy: { rank: "asc" },
			});
			return page.docs;
		});

	beforeAll(async () => {
		client = await createTestDb();
		const db = drizzle({
			client,
			logger: { logQuery: (statement) => statements.push(statement) },
		});
		setup = await buildMockApp(
			{
				globals: { batchSettings: settings },
				collections: {
					batchDocuments: documents,
					batchGrants: grants,
					batchParents: parents,
				},
			},
			{ db: { drizzle: db } },
		);
		await runTestDbMigrations(setup.app);
		await db.insert(documentTable).values(
			Array.from({ length: 101 }, (_, rank) => ({
				id: String(rank),
				rank,
				visible: rank !== 100,
				secret: "secret",
				legacy: "legacy",
				hidden: "hidden",
				serverOnly: "server",
				profile: { secret: "nested" },
				entries: [{ secret: "nested" }],
			})),
		);
		await db.insert(grantTable).values(
			Array.from({ length: 50 }, (_, index) => ({
				id: String(index),
				document: String(index * 2),
				reader: "reader",
			})),
		);
		await db.insert(parents.build().table).values([
			{ id: "allowed", target: "0" },
			{ id: "redacted", target: "1" },
			{ id: "denied", target: "100" },
		]);
		await setup.app.globals.batchSettings.update(
			{ data: { secret: "global" } },
			system,
		);
	});

	afterAll(async () => {
		await setup?.cleanup();
		await client?.close();
	});
	beforeEach(() => {
		statements.length = 0;
		batches.length = 0;
		observations.length = 0;
		rowCalls = 0;
		hookCalls = 0;
		malformed = undefined;
	});

	for (const limit of [10, 50, 100]) {
		it(`batches ${limit} authorized rows with constant policy and fact SQL calls`, async () => {
			const result = await setup.app.collections.batchDocuments.find(
				{ limit, orderBy: { rank: "asc" } },
				user,
			);
			expect(result.docs).toHaveLength(limit);
			expect(result.totalDocs).toBe(100);
			expect(batches).toHaveLength(3); // secret + the two nested paths
			expect(
				batches.every(
					(docs) =>
						docs.length === limit && docs.every((doc) => doc.visible === true),
				),
			).toBe(true);
			expect(
				statements.filter((statement) =>
					statement.includes('from "batch_grants"'),
				),
			).toHaveLength(3);
			expect(statements).toHaveLength(5); // count + page + one fact lookup per field
			expect(rowCalls).toBe(limit);
			expect(hookCalls).toBe(limit);
			for (const row of result.docs) {
				expect(row).toHaveProperty("serverOnly", "server");
				if (row.rank % 2 === 0) {
					expect(row).toHaveProperty("secret", "secret");
					expect(row.profile).toHaveProperty("secret", "nested");
					expect(row.entries[0]).toHaveProperty("secret", "nested");
				} else {
					expect(row).not.toHaveProperty("secret");
					expect(row).not.toHaveProperty("legacy");
					expect(row.profile).not.toHaveProperty("secret");
					expect(row.entries[0]).not.toHaveProperty("secret");
				}
			}
		});
	}

	for (const limit of [10, 50, 100]) {
		it(`keeps batch fact reads on the query snapshot for ${limit} rows`, async () => {
			const result = await executeJsonRoute(
				setup.app,
				readPage,
				{ limit },
				user,
			);
			expect(result).toHaveLength(limit);
			expect(result[0]).toHaveProperty("secret");
			expect(result[1]).not.toHaveProperty("secret");
			expect(batches).toHaveLength(3);
			expect(observations).toHaveLength(3);
			for (const observation of observations) {
				expect(observation.db).toBe(observation.ambient);
				expect(observation.db).not.toBe(setup.app.db);
				expect(observation.isolation).toBe("repeatable read");
				expect(observation.readOnly).toBe("on");
			}
			expect(
				statements.filter((statement) =>
					statement.includes('from "batch_grants"'),
				),
			).toHaveLength(3);
		});
	}

	it("refreshes batch facts on the next query evaluation", async () => {
		expect(
			(await executeJsonRoute(setup.app, readPage, { limit: 10 }, user))[0],
		).toHaveProperty("secret");
		await setup.app.db.delete(grantTable).where(eq(grantTable.document, "0"));
		try {
			expect(
				(await executeJsonRoute(setup.app, readPage, { limit: 10 }, user))[0],
			).not.toHaveProperty("secret");
			expect(batches).toHaveLength(6);
			expect(observations[0].db).not.toBe(observations[3].db);
		} finally {
			await setup.app.db
				.insert(grantTable)
				.values({ id: "0", document: "0", reader: "reader" });
		}
	});

	it("uses the supplied transaction for singleton, global and write-response policies", async () => {
		await setup.app.db.transaction(async (tx: unknown) => {
			const context = { ...user, db: tx };
			const restricted = await getRestrictedReadFields(
				{ id: "0", secret: "secret" },
				context,
				{ db: setup.app.db, fieldAccess: { secret: { read: policy } } },
			);
			expect(restricted).toEqual([]);
			expect(
				await setup.app.globals.batchSettings.get({}, context),
			).not.toHaveProperty("secret");
			const updated = await setup.app.collections.batchDocuments.updateById(
				{ id: "0", data: { legacy: "legacy" } },
				context,
			);
			expect(updated).toHaveProperty("secret");
			expect(observations.length).toBeGreaterThanOrEqual(5);
			expect(observations.every((observation) => observation.db === tx)).toBe(
				true,
			);
		});
	});

	it("refreshes facts and decisions on every read and for another principal", async () => {
		const find = (context = user) =>
			setup.app.collections.batchDocuments.findOne(
				{ where: { id: "0" } },
				context,
			);
		expect(await find()).toHaveProperty("secret");
		await setup.app.db.delete(grantTable).where(eq(grantTable.document, "0"));
		try {
			expect(await find()).not.toHaveProperty("secret");
		} finally {
			await setup.app.db
				.insert(grantTable)
				.values({ id: "0", document: "0", reader: "reader" });
		}
		expect(await find()).toHaveProperty("secret");
		expect(
			await find({ ...user, session: createMockSession({ id: "another" }) }),
		).not.toHaveProperty("secret");
		expect(
			await setup.app.collections.batchDocuments.findOne(
				{ where: { id: "1" } },
				user,
			),
		).not.toHaveProperty("secret");
		expect(batches).toHaveLength(15);
	});

	it("bypasses all field rules in system mode", async () => {
		const result = await setup.app.collections.batchDocuments.find(
			{ limit: 2 },
			system,
		);
		expect(result.docs[0]).toHaveProperty("secret");
		expect(result.docs[0]).toHaveProperty("hidden");
		expect(batches).toHaveLength(0);
		expect(rowCalls).toBe(0);
	});

	it("uses the same policy for human and agent subjects", async () => {
		const human = { kind: "human", subjectId: "reader" } as const;
		const agent = {
			kind: "agent",
			subjectId: "reader",
			credentialId: "credential",
			issuer: "https://issuer.example",
			scopes: [],
			expiresAt: new Date(Date.now() + 60_000),
		} as const;
		for (const actor of [human, agent]) {
			expect(
				await setup.app.collections.batchDocuments.findOne(
					{ where: { id: "0" } },
					{ ...user, session: null, actor },
				),
			).toHaveProperty("secret");
		}
		expect(batches).toHaveLength(6);
	});

	it("preserves partial projections and skips callbacks for an empty page", async () => {
		const row = await setup.app.collections.batchDocuments.findOne(
			{ where: { id: "0" }, columns: { id: true, secret: true } },
			user,
		);
		expect(row).toHaveProperty("secret");
		expect(row).not.toHaveProperty("rank");
		expect(batches[0][0]).not.toHaveProperty("rank");
		batches.length = 0;
		await setup.app.collections.batchDocuments.find(
			{ where: { id: "100" } },
			user,
		);
		expect(batches).toHaveLength(0);
	});

	it("uses the target field policy for populated relations", async () => {
		const result = await setup.app.collections.batchParents.find(
			{ with: { target: true } },
			user,
		);
		const rows = new Map(
			result.docs.map((row: { id: string; target: unknown }) => [
				row.id,
				row.target,
			]),
		);
		expect(rows.get("allowed")).toHaveProperty("secret");
		expect(rows.get("redacted")).not.toHaveProperty("secret");
		expect(rows.get("denied")).toBeNull();
		expect(batches).toHaveLength(3);
		expect(batches[0]).toHaveLength(2);
	});

	it("continues to reject dynamic field policies in SQL aggregates", async () => {
		await expect(
			setup.app.collections.batchParents.find(
				{
					with: { children: { _aggregate: { _min: { secret: true } } } },
				},
				user,
			),
		).rejects.toThrow(
			"Relation aggregates do not support dynamic field read rules",
		);
		expect(batches).toHaveLength(0);
	});

	for (const invalid of ["short", "long", "nonboolean"] as const) {
		it(`fails closed for ${invalid} batch results before hooks`, async () => {
			malformed = invalid;
			await expect(
				setup.app.collections.batchDocuments.find({ limit: 2 }, user),
			).rejects.toThrow("batchRead must return one boolean per document");
			expect(hookCalls).toBe(0);
		});
	}
});
