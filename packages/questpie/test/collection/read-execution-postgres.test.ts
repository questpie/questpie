import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";

import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { collection } from "../../src/exports/index.js";

// Real node-postgres SQL through the generated CRUD: the statement log is the
// evidence, so nothing here runs against PGlite or a mocked driver.
const databaseUrl = process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;
const runPostgresContract = Boolean(databaseUrl);

const user = { accessMode: "user", locale: "en", defaultLocale: "en" } as any;
const system = { ...user, accessMode: "system" } as any;

const statements: string[] = [];
const countStatements = () =>
	statements.filter((statement) => /\bcount\s*\(/i.test(statement));

let scopedAccessCalls = 0;
let scopedBeforeReadCalls = 0;
let rowHook: ((options: any) => void | Promise<void>) | undefined;
let rowAccessGate: Promise<void> | undefined;
let rowAfterReadCalls = 0;

// A hasMany relation finds its foreign key through the target relation whose
// key equals `relationName`, so every child names its field `parent`.
const childOf = (f: any) => f.relation("rx_parents").relationName("parent");
const many = (f: any, target: string) =>
	f.relation(target).hasMany({ foreignKey: "parent", relationName: "parent" });

const parents = collection("rx_parents")
	.fields(({ f }: any) => ({
		title: f.text(),
		denied: many(f, "rx_denied"),
		scoped: many(f, "rx_scoped"),
		hooked: many(f, "rx_hooked"),
		localized: many(f, "rx_localized"),
		staged: many(f, "rx_staged"),
		files: many(f, "rx_files"),
		keyHidden: many(f, "rx_key_hidden"),
	}))
	.access({ read: true });

const denied = collection("rx_denied")
	.fields(({ f }: any) => ({ parent: childOf(f) }))
	.access({ read: false });

const scoped = collection("rx_scoped")
	.fields(({ f }: any) => ({
		parent: childOf(f),
		visible: f.boolean(),
		amount: f.number(),
		secret: f.number(),
		dynamic: f.number(),
	}))
	.options({ softDelete: true })
	.access({
		read: () => {
			scopedAccessCalls++;
			return { visible: true };
		},
		fields: {
			secret: { read: false },
			dynamic: { read: () => true },
		},
	} as any)
	.hooks({
		beforeRead: () => {
			scopedBeforeReadCalls++;
		},
	});

const hooked = collection("rx_hooked")
	.fields(({ f }: any) => ({ parent: childOf(f), amount: f.number() }))
	.access({ read: true })
	.hooks({
		afterRead: ({ data }: any) => {
			data.amount = 0;
		},
	});

const localized = collection("rx_localized")
	.fields(({ f }: any) => ({
		parent: childOf(f),
		label: f.text().localized(),
	}))
	.access({ read: true });

const staged = collection("rx_staged")
	.fields(({ f }: any) => ({ parent: childOf(f) }))
	.options({ versioning: { workflow: true } })
	.access({ read: true });

const files = collection("rx_files")
	.fields(({ f }: any) => ({ parent: childOf(f) }))
	.upload({})
	.access({ read: true });

const keyHidden = collection("rx_key_hidden")
	.fields(({ f }: any) => ({ parent: childOf(f) }))
	.access({ read: true, fields: { parent: { read: false } } } as any);

const rows = collection("rx_rows")
	.fields(({ f }: any) => ({
		name: f.text(),
		visible: f.boolean(),
		secret: f.text(),
	}))
	.title(({ f }: any) => f.name)
	.options({ softDelete: true })
	.access({
		read: async () => {
			await rowAccessGate;
			return { visible: true };
		},
		fields: { secret: { read: false } },
	} as any)
	.hooks({
		beforeRead: async ({ data }: any) => {
			await rowHook?.(data);
		},
		afterRead: () => {
			rowAfterReadCalls++;
		},
	});

const lockedRows = collection("rx_locked_rows")
	.fields(({ f }: any) => ({ name: f.text() }))
	.access({ read: false });

async function status(run: () => Promise<unknown>): Promise<number | "ok"> {
	try {
		await run();
		return "ok";
	} catch (error: any) {
		if (typeof error?.getHTTPStatus !== "function") throw error;
		return error.getHTTPStatus();
	}
}

describe.skipIf(!runPostgresContract)("read execution on PostgreSQL", () => {
	const schema = `rx_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
	let client: pg.Client;
	let db: any;
	const app: any = { collections: {} };
	const tables: Record<string, any> = {};
	const parentIds = [crypto.randomUUID(), crypto.randomUUID()];
	const emptyParentId = crypto.randomUUID();

	const parentFind = (withConfig: any, context = user) =>
		app.collections.rx_parents.find(
			{ with: withConfig, orderBy: { title: "asc" } },
			context,
		);

	beforeAll(async () => {
		client = new pg.Client({ connectionString: databaseUrl });
		await client.connect();
		await client.query(`CREATE SCHEMA "${schema}"`);
		await client.query(`SET search_path TO "${schema}"`);
		db = drizzle({
			client,
			logger: { logQuery: (statement: string) => statements.push(statement) },
		});

		const builders = [
			parents,
			denied,
			scoped,
			hooked,
			localized,
			staged,
			files,
			keyHidden,
			rows,
			lockedRows,
		];
		for (const builder of builders) {
			const built: any = builder.build();
			for (const table of [built.table, built.i18nTable]) {
				if (!table) continue;
				const columns = Object.values(getTableColumns(table)).map(
					(column: any) => `"${column.name}" ${column.getSQLType()}`,
				);
				await client.query(
					`CREATE TABLE "${getTableName(table)}" (${columns.join(", ")})`,
				);
			}
			tables[built.state.name] = built;
			app.collections[built.state.name] = built.generateCRUD(db, app);
		}

		await db.insert(tables.rx_parents.table).values([
			{ id: parentIds[0], title: "a" },
			{ id: parentIds[1], title: "b" },
			{ id: emptyParentId, title: "c" },
		]);
		const child = (parent: string, values: object = {}) => ({
			id: crypto.randomUUID(),
			parent,
			...values,
		});
		await db
			.insert(tables.rx_denied.table)
			.values([child(parentIds[0]), child(parentIds[1])]);
		await db.insert(tables.rx_scoped.table).values([
			child(parentIds[0], { visible: true, amount: 1, secret: 7 }),
			child(parentIds[0], { visible: true, amount: 2, secret: 8 }),
			child(parentIds[0], { visible: false, amount: 100, secret: 9 }),
			child(parentIds[0], {
				visible: true,
				amount: 1000,
				deletedAt: new Date(),
			}),
			child(parentIds[1], { visible: false, amount: 100 }),
		]);
		await db
			.insert(tables.rx_hooked.table)
			.values([child(parentIds[0], { amount: 5 })]);
		const localizedIds = [crypto.randomUUID(), crypto.randomUUID()];
		await db
			.insert(tables.rx_localized.table)
			.values(localizedIds.map((id) => ({ id, parent: parentIds[0] })));
		await db.insert(tables.rx_localized.i18nTable).values(
			localizedIds.flatMap((parentId, index) =>
				["en", "sk"].map((locale) => ({
					id: crypto.randomUUID(),
					parentId,
					locale,
					label: index === 0 ? "match" : "other",
				})),
			),
		);
		await db.insert(tables.rx_staged.table).values([child(parentIds[0])]);
		await db
			.insert(tables.rx_files.table)
			.values([
				child(parentIds[0], { size: 10 }),
				child(parentIds[0], { size: 5 }),
			]);
		await db.insert(tables.rx_key_hidden.table).values([child(parentIds[0])]);
		await db.insert(tables.rx_rows.table).values([
			...Array.from({ length: 5 }, (_, index) => ({
				id: crypto.randomUUID(),
				name: `row ${index}`,
				visible: true,
				secret: "s",
			})),
			{ id: crypto.randomUUID(), name: "hidden", visible: false },
			{
				id: crypto.randomUUID(),
				name: "deleted",
				visible: true,
				deletedAt: new Date(),
			},
		]);
		await db
			.insert(tables.rx_locked_rows.table)
			.values([{ id: crypto.randomUUID(), name: "x" }]);
	});

	afterAll(async () => {
		await client.query(`DROP SCHEMA "${schema}" CASCADE`);
		await client.end();
	});

	beforeEach(() => {
		statements.length = 0;
		scopedAccessCalls = 0;
		scopedBeforeReadCalls = 0;
		rowHook = undefined;
		rowAccessGate = undefined;
		rowAfterReadCalls = 0;
	});

	describe("hasMany relation aggregates", () => {
		it("refuses the aggregate exactly like the ordinary read of a denied target", async () => {
			expect(await status(() => parentFind({ denied: true }))).toBe(403);
			statements.length = 0;
			expect(await status(() => parentFind({ denied: { _count: true } }))).toBe(
				403,
			);
			expect(statements.some((sql) => sql.includes("rx_denied"))).toBe(false);
			expect(
				await status(() =>
					parentFind({ denied: { _aggregate: { _count: true } } }),
				),
			).toBe(403);
		});

		it("counts only the rows the target's access rule and soft delete admit", async () => {
			const ordinary = await parentFind({ scoped: true });
			const counted = await parentFind({ scoped: { _count: true } });
			expect(counted.docs.map((parent: any) => parent.scoped._count)).toEqual(
				ordinary.docs.map((parent: any) => parent.scoped.length),
			);
			expect(counted.docs.map((parent: any) => parent.scoped)).toEqual([
				{ _count: 2 },
				{ _count: 0 },
				{ _count: 0 },
			]);

			const summed = await parentFind({
				scoped: { _aggregate: { _count: true, _sum: { amount: true } } },
			});
			expect(summed.docs[0].scoped).toEqual({ _count: 2, _sum: { amount: 3 } });

			const filtered = await parentFind({
				scoped: { _count: true, where: { amount: { gt: 1 } } },
			});
			expect(filtered.docs[0].scoped).toEqual({ _count: 1 });

			const withDeleted = await parentFind({
				scoped: { _count: true, includeDeleted: true },
			});
			expect(withDeleted.docs[0].scoped).toEqual({ _count: 3 });

			const unrestricted = await parentFind(
				{ scoped: { _count: true } },
				system,
			);
			expect(
				unrestricted.docs.map((parent: any) => parent.scoped._count),
			).toEqual([3, 1, 0]);
		});

		it("runs the target's read lifecycle once per aggregate", async () => {
			await parentFind({ scoped: { _count: true } });
			expect(scopedAccessCalls).toBe(1);
			expect(scopedBeforeReadCalls).toBe(1);
			const targetStatements = statements.filter((sql) =>
				sql.includes("rx_scoped"),
			);
			expect(targetStatements).toHaveLength(1);
			expect(targetStatements[0]).toMatch(
				/"parent" in \(\$\d+, \$\d+, \$\d+\)/,
			);
			expect(targetStatements[0]).toMatch(/group by/i);
		});

		it("refuses value aggregates over fields the reader may not read", async () => {
			const secretMax = { scoped: { _aggregate: { _max: { secret: true } } } };
			expect(await status(() => parentFind(secretMax))).toBe(403);
			expect((await parentFind(secretMax, system)).docs[0].scoped).toEqual({
				_max: { secret: 9 },
			});
			expect(
				await status(() =>
					parentFind({ scoped: { _aggregate: { _sum: { dynamic: true } } } }),
				),
			).toBe(400);
		});

		it("keeps counting a target with afterRead but refuses its value aggregates", async () => {
			const counted = await parentFind({ hooked: { _count: true } });
			expect(counted.docs[0].hooked).toEqual({ _count: 1 });
			expect(
				await status(() =>
					parentFind({ hooked: { _aggregate: { _sum: { amount: true } } } }),
				),
			).toBe(400);
		});

		it("aggregates stored fields of an upload target despite its url hook", async () => {
			const summed = await parentFind({
				files: { _aggregate: { _sum: { size: true }, _min: { size: true } } },
			});
			expect(summed.docs[0].files).toEqual({
				_sum: { size: 15 },
				_min: { size: 5 },
			});
		});

		it("refuses to group by a foreign key the reader may not read", async () => {
			expect(
				await status(() => parentFind({ keyHidden: { _count: true } })),
			).toBe(403);
			expect(
				(await parentFind({ keyHidden: { _count: true } }, system)).docs[0]
					.keyHidden,
			).toEqual({ _count: 1 });
		});

		it("counts a localized target once per row, with a localized predicate", async () => {
			const counted = await parentFind({ localized: { _count: true } });
			expect(counted.docs[0].localized).toEqual({ _count: 2 });
			const matched = await parentFind({
				localized: { _count: true, where: { label: "match" } },
			});
			expect(matched.docs[0].localized).toEqual({ _count: 1 });
		});

		it("refuses an aggregate over a non-initial workflow stage", async () => {
			expect(
				(await parentFind({ staged: { _count: true } })).docs[0].staged,
			).toEqual({ _count: 1 });
			expect(
				await status(() =>
					parentFind({ staged: { _count: true, stage: "published" } }),
				),
			).toBe(400);
			expect(
				await status(() =>
					parentFind(
						{ staged: { _count: true } },
						{ ...user, stage: "published" },
					),
				),
			).toBe(400);
		});

		it("executes on the caller's transaction", async () => {
			await db
				.transaction(async (tx: any) => {
					await tx.insert(tables.rx_scoped.table).values({
						id: crypto.randomUUID(),
						parent: emptyParentId,
						visible: true,
						amount: 1,
					});
					const inside = await parentFind(
						{ scoped: { _count: true } },
						{ ...user, db: tx },
					);
					expect(inside.docs[2].scoped).toEqual({ _count: 1 });
					throw new Error("rollback");
				})
				.catch((error: Error) => {
					if (error.message !== "rollback") throw error;
				});
			const after = await parentFind({ scoped: { _count: true } });
			expect(after.docs[2].scoped).toEqual({ _count: 0 });
		});
	});

	describe("findRows", () => {
		const findRows = (options: any, context = user) =>
			app.collections.rx_rows.findRows(options, context);

		it("returns the bounded rows in one statement without a total", async () => {
			const result = await findRows({ limit: 3, orderBy: { name: "asc" } });
			expect(Array.isArray(result)).toBe(true);
			expect(result.map((row: any) => row.name)).toEqual([
				"row 0",
				"row 1",
				"row 2",
			]);
			expect(statements).toHaveLength(1);
			expect(countStatements()).toHaveLength(0);
			expect(statements[0]).toMatch(/limit \$\d+$/i);
		});

		it("leaves find with its total", async () => {
			const result = await app.collections.rx_rows.find(
				{ limit: 3, orderBy: { name: "asc" } },
				user,
			);
			expect(result.docs).toHaveLength(3);
			expect(result.totalDocs).toBe(5);
			expect(statements).toHaveLength(2);
			expect(countStatements()).toHaveLength(1);
		});

		it("applies access, soft delete, field rules, hooks and search", async () => {
			const result = await findRows({ limit: 100 });
			expect(result.map((row: any) => row.name).sort()).toEqual(
				Array.from({ length: 5 }, (_, index) => `row ${index}`),
			);
			expect(result.every((row: any) => !("secret" in row))).toBe(true);
			expect(rowAfterReadCalls).toBe(5);

			expect(await findRows({ limit: 100 }, system)).toHaveLength(6);
			expect(
				(await findRows({ limit: 100, search: "row 3" })).map(
					(row: any) => row.name,
				),
			).toEqual(["row 3"]);
			expect(
				await status(() =>
					app.collections.rx_locked_rows.findRows({ limit: 1 }, user),
				),
			).toBe(403);
		});

		it("rejects an unbounded or paged request before any SQL", async () => {
			const invalid = [
				undefined,
				{},
				{ limit: 0 },
				{ limit: 101 },
				{ limit: 1.5 },
				{ limit: "10" },
				{ limit: 10, offset: 0 },
				{ limit: 10, groupBy: "name" },
			];
			for (const options of invalid) {
				expect(await status(() => findRows(options))).toBe(400);
			}
			expect(statements).toHaveLength(0);
		});

		it("keeps the validated bound when a hook or the caller rewrites it", async () => {
			rowHook = (options) => {
				options.limit = 1000;
			};
			expect(await findRows({ limit: 2 })).toHaveLength(2);

			let release!: () => void;
			rowAccessGate = new Promise<void>((resolve) => {
				release = resolve;
			});
			rowHook = undefined;
			const options: any = { limit: 2 };
			const pending = findRows(options);
			options.limit = 1000;
			release();
			expect(await pending).toHaveLength(2);
		});

		it("rejects paging coordinates a hook adds after validation", async () => {
			rowHook = (options) => {
				options.offset = 1;
			};
			expect(await status(() => findRows({ limit: 2 }))).toBe(400);
			rowHook = (options) => {
				options.groupBy = "name";
			};
			expect(await status(() => findRows({ limit: 2 }))).toBe(400);
			expect(statements).toHaveLength(0);
		});
	});
});
