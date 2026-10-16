import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";

import { sql } from "drizzle-orm";

import {
	collection,
	runWithContext,
	withTransaction,
} from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

let gate: Promise<void> | undefined;
let beforeOperation: ((options: any) => void) | undefined;
let stagedBeforeRead: ((options: any) => void) | undefined;
let fieldOutputCalls = 0;
let beforeRead: ((options: any) => void) | undefined;
let accessCalls = 0,
	readCalls = 0,
	afterCalls = 0;
const rows = collection("finite_rows")
	.fields(({ f }) => ({
		company: f.text().required(),
		name: f
			.text()
			.required()
			.hooks({
				afterRead: (value) => {
					fieldOutputCalls++;
					return value.toUpperCase();
				},
			}),
		visible: f.boolean().required(),
		secret: f.text(),
		payload: f.json(),
		instant: f.datetime({ withTimezone: true }),
		optional: f.text(),
	}))
	.title(({ f }) => f.name)
	.options({ softDelete: true, timestamps: true })
	.access({
		read: async () => {
			accessCalls++;
			await gate;
			return { company: "own", visible: true };
		},
		fields: { secret: { read: false } },
	})
	.hooks({
		beforeOperation: ({ data, operation }) => {
			if (operation === "read") beforeOperation?.(data);
		},
		beforeRead: ({ data }) => {
			readCalls++;
			beforeRead?.(data);
		},
		afterRead: ({ data }) => {
			afterCalls++;
			data.name = data.name + "!";
		},
	});
const denied = collection("finite_denied")
	.fields(({ f }) => ({ name: f.text() }))
	.access({ read: false });
const localized = collection("finite_localized")
	.fields(({ f }) => ({ name: f.text().localized() }))
	.access({ read: true });
const computed = collection("finite_computed")
	.fields(({ f }) => ({
		name: f.text(),
		value: f.number().virtual(sql<number>`1`),
	}))
	.access({ read: true });
const staged = collection("finite_staged")
	.fields(({ f }) => ({ name: f.text() }))
	.options({ versioning: { workflow: true } })
	.access({ read: true })
	.hooks({
		beforeRead: ({ data }) => {
			stagedBeforeRead?.(data);
		},
	});
const owners = collection("finite_owners")
	.fields(({ f }) => ({ company: f.text().required() }))
	.access({ read: true });
const guarded = collection("finite_guarded")
	.fields(({ f }) => ({
		owner: f.relation("finite_owners").required(),
		name: f.text(),
		__questpie_requested_id: f.text(),
	}))
	.access({ read: () => ({ owner: { company: "own" } }) } as any);
const aliasNamed = collection("__questpie_finite_keys")
	.fields(({ f }) => ({ name: f.text() }))
	.access({ read: true });
const user = createTestContext({ accessMode: "user" }),
	system = createTestContext({ accessMode: "system" });

describe("findRows finite primary-key acquisition", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	const statements: string[] = [];
	let restore: (() => void) | undefined;
	beforeAll(async () => {
		setup = await buildMockApp({
			collections: {
				finite_rows: rows,
				finite_denied: denied,
				finite_localized: localized,
				finite_computed: computed,
				finite_staged: staged,
				finite_owners: owners,
				finite_guarded: guarded,
				__questpie_finite_keys: aliasNamed,
			},
		});
		await runTestDbMigrations(setup.app);
		const table = rows.build().table;
		await setup.app.db.insert(table).values([
			{
				id: "a",
				company: "own",
				name: "Zulu",
				visible: true,
				secret: "private",
				payload: { nested: [1, null, { ok: true }] },
				instant: new Date("2026-10-16T10:11:12.123Z"),
				optional: null,
			},
			{
				id: "b",
				company: "own",
				name: "Alpha",
				visible: true,
				secret: "private",
				payload: null,
				instant: null,
				optional: "kept",
			},
			{ id: "foreign", company: "foreign", name: "Foreign", visible: true },
			{ id: "hidden", company: "own", name: "Hidden", visible: false },
			{
				id: "deleted",
				company: "own",
				name: "Deleted",
				visible: true,
				deletedAt: new Date(),
			},
		]);
		await setup.app.db.insert(table).values(
			Array.from({ length: 100 }, (_, i) => ({
				id: `key-${i}`,
				company: "own",
				name: `Key${String(i).padStart(3, "0")}`,
				visible: true,
			})),
		);
		await setup.app.db.insert(owners.build().table).values([
			{ id: "owner-own", company: "own" },
			{ id: "owner-foreign", company: "foreign" },
		]);
		await setup.app.db.insert(guarded.build().table).values([
			{
				id: "guard-own",
				owner: "owner-own",
				name: "Own",
				__questpie_requested_id: "preserved",
			},
			{
				id: "guard-foreign",
				owner: "owner-foreign",
				name: "Foreign",
				__questpie_requested_id: "not exposed",
			},
		]);
		await setup.app.db
			.insert(aliasNamed.build().table)
			.values({ id: "alias-row", name: "real table" });
		const client = setup.app.db.$client,
			original = client.query;
		client.query = function (...args: any[]) {
			if (typeof args[0] === "string") statements.push(args[0]);
			return Reflect.apply(original, this, args);
		};
		restore = () => {
			client.query = original;
		};
	});
	afterAll(async () => {
		restore?.();
		await setup.cleanup();
	});
	beforeEach(() => {
		statements.length = 0;
		gate = undefined;
		beforeRead = undefined;
		beforeOperation = undefined;
		stagedBeforeRead = undefined;
		fieldOutputCalls = 0;
		accessCalls = 0;
		readCalls = 0;
		afterCalls = 0;
	});
	const read = (options: any, context = user) =>
		setup.app.collections.finite_rows.findRows(options, context);
	it("keeps complete decoded rows, access, field filtering, output hooks and one SQL statement", async () => {
		const options = {
			where: {
				company: "own",
				id: { in: ["a", "b", "foreign", "hidden", "deleted", "missing"] },
			},
			orderBy: { name: "asc" },
			limit: 100,
		};
		const expected = await read(options);
		statements.length = 0;
		afterCalls = 0;
		fieldOutputCalls = 0;
		const actual = await read({
			...options,
			ids: ["a", "b", "a", "foreign", "hidden", "deleted", "missing"],
		});
		expect(actual).toEqual(expected);
		expect(actual.map((row: any) => row.id)).toEqual(["b", "a"]);
		expect(actual[1].instant).toBeInstanceOf(Date);
		expect(actual[1].createdAt).toBeInstanceOf(Date);
		expect(actual[1].payload).toEqual({ nested: [1, null, { ok: true }] });
		expect(actual[1].optional).toBe(null);
		expect(actual[0].payload).toBe(null);
		expect(actual[0].instant).toBe(null);
		expect(actual.every((row: any) => !("secret" in row))).toBe(true);
		expect(afterCalls).toBe(2);
		expect(fieldOutputCalls).toBe(2);
		expect(actual.map((row: any) => row.name)).toEqual(["ALPHA!", "ZULU!"]);
		expect(statements).toHaveLength(1);
		expect(statements[0]).toMatch(/cross join lateral/i);
		expect(statements[0]).not.toMatch(/count\(/i);
	});
	it("orders and limits the entire authorized key set, including when input prefix is denied", async () => {
		expect(
			(
				await read({
					ids: ["foreign", "a", "b"],
					limit: 1,
					orderBy: { name: "asc" },
				})
			).map((row: any) => row.id),
		).toEqual(["b"]);
		expect(
			(
				await read({
					ids: ["b", "a"],
					limit: 1,
					orderBy: [{ name: "desc" }, { id: "asc" }],
				})
			).map((row: any) => row.id),
		).toEqual(["a"]);
		expect(
			(await read({ ids: ["a", "b"], limit: 100, search: "Alpha" })).map(
				(row: any) => row.id,
			),
		).toEqual(["b"]);
	});
	it("snapshots identity and limit before the first awaited access hook", async () => {
		let release!: () => void;
		gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const ids = ["a"],
			options = { ids, limit: 1 };
		const pending = read(options);
		ids[0] = "b";
		options.limit = 100;
		release();
		expect((await pending).map((row: any) => row.id)).toEqual(["a"]);
		beforeRead = (options) => {
			options.ids = ["a", "b"];
			options.limit = 100;
		};
		expect(await read({ ids: ["b"], limit: 1 })).toHaveLength(1);
	});
	it("runs access and beforeRead for empty keys without querying, and never bypasses denial", async () => {
		expect(await read({ ids: [], limit: 1 })).toEqual([]);
		expect(accessCalls).toBe(1);
		expect(readCalls).toBe(1);
		expect(statements).toHaveLength(0);
		await expect(
			setup.app.collections.finite_denied.findRows({ ids: [], limit: 1 }, user),
		).rejects.toThrow();
	});
	it("rejects oversized or malformed keys before lifecycle and rejects unsupported hook mutations", async () => {
		for (const ids of [
			Array(1),
			Array.from({ length: 101 }, (_, i) => String(i)),
			null,
			[{}],
			[NaN],
			[Infinity],
		])
			await expect(read({ ids, limit: 1 })).rejects.toThrow();
		expect(accessCalls).toBe(0);
		expect(readCalls).toBe(0);
		expect(statements).toHaveLength(0);
		for (const value of [
			{ with: {} },
			{ columns: { name: true } },
			{ extras: {} },
			{ offset: 0 },
			{ groupBy: "name" },
		]) {
			beforeRead = (options) => Object.assign(options, value);
			await expect(read({ ids: ["a"], limit: 1 })).rejects.toThrow();
		}
		await expect(
			setup.app.collections.finite_localized.findRows(
				{ ids: ["a"], limit: 1 },
				user,
			),
		).rejects.toThrow();
		await expect(
			setup.app.collections.finite_computed.findRows(
				{ ids: ["a"], limit: 1 },
				user,
			),
		).rejects.toThrow();
	});
	it("reads100 keys once, deduplicates bounded input, and rejects101 even when repeated", async () => {
		const ids = Array.from({ length: 100 }, (_, i) => `key-${i}`);
		const actual = await read({ ids, limit: 100, orderBy: { id: "asc" } });
		expect(actual).toHaveLength(100);
		expect(new Set(actual.map((row: any) => row.id)).size).toBe(100);
		expect(statements).toHaveLength(1);
		expect(
			await read({ ids: [...ids.slice(0, 99), ids[0]], limit: 100 }),
		).toHaveLength(99);
		await expect(
			read({ ids: Array(101).fill(ids[0]), limit: 100 }),
		).rejects.toThrow();
	});
	it("does not let beforeOperation replace frozen identity or lift the SQL limit", async () => {
		beforeOperation = (options) => {
			options.ids = ["a", "b"];
			options.limit = 100;
		};
		const actual = await read({ ids: ["b"], limit: 1 });
		expect(actual.map((row: any) => row.id)).toEqual(["b"]);
	});
	it("rejects non-base stage reads and stage mutation introduced by beforeRead", async () => {
		for (const stage of ["published", "not-a-real-stage"])
			await expect(
				setup.app.collections.finite_staged.findRows(
					{ ids: ["missing"], limit: 1, stage },
					user,
				),
			).rejects.toThrow();
		await expect(
			runWithContext({ stage: "published" }, () =>
				setup.app.collections.finite_staged.findRows(
					{ ids: ["missing"], limit: 1 },
					user,
				),
			),
		).rejects.toThrow();
		stagedBeforeRead = (options) => {
			options.stage = "published";
		};
		await expect(
			setup.app.collections.finite_staged.findRows(
				{ ids: ["missing"], limit: 1 },
				user,
			),
		).rejects.toThrow();
	});
	it("keeps a real related Company access predicate inside the finite read, including alias collision", async () => {
		const options = { limit: 100, orderBy: { id: "asc" } };
		const expected = await setup.app.collections.finite_guarded.findRows(
			options,
			user,
		);
		const actual = await setup.app.collections.finite_guarded.findRows(
			{ ...options, ids: ["guard-foreign", "guard-own"] },
			user,
		);
		expect(actual).toEqual(expected);
		expect(actual.map((row: any) => row.id)).toEqual(["guard-own"]);
		expect(actual[0].__questpie_requested_id).toBe("preserved");
		const filtered = await setup.app.collections.finite_guarded.findRows(
			{
				...options,
				ids: ["guard-own"],
				where: { owner: { company: "foreign" } },
			},
			user,
		);
		expect(filtered).toEqual([]);
	});
	it("uses the explicit transaction before conflicting ambient context, with normal read hooks", async () => {
		await withTransaction(setup.app.db, async (tx: any) => {
			await tx.insert(rows.build().table).values({
				id: "uncommitted",
				company: "own",
				name: "Pending",
				visible: true,
			});
			const explicit = await runWithContext(
				{ db: setup.app.db, accessMode: "system" },
				() => read({ ids: ["uncommitted"], limit: 1 }, { ...system, db: tx }),
			);
			expect(explicit.map((row: any) => row.id)).toEqual(["uncommitted"]);
			const ambient = await runWithContext(
				{ db: tx, accessMode: "system" },
				() => read({ ids: ["uncommitted"], limit: 1 }, system),
			);
			expect(ambient).toEqual(explicit);
		});
	});
	it("does not shadow a legitimate physical table named like the VALUES alias", async () => {
		const actual = await setup.app.collections.__questpie_finite_keys.findRows(
			{ ids: ["alias-row"], limit: 1 },
			user,
		);
		expect(actual.map((row: any) => ({ id: row.id, name: row.name }))).toEqual([
			{ id: "alias-row", name: "real table" },
		]);
	});
	it("does not silently accept ids on other read methods", async () => {
		await expect(
			setup.app.collections.finite_rows.find({ ids: ["a"], limit: 1 }, user),
		).rejects.toThrow();
		await expect(
			setup.app.collections.finite_rows.findOne({ ids: ["a"] }, user),
		).rejects.toThrow();
	});
});
