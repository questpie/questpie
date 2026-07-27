import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";

import { PGlite } from "@electric-sql/pglite";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import {
	CrdtDurableStoreConflictError,
	createCrdtDurableStore,
} from "../../../src/server/modules/core/integrated/crdt/durable-store.js";
import {
	questpieCrdtDefinitionTable,
	questpieCrdtNamespaceTable,
	questpieCrdtSchemaFieldTable,
	questpieCrdtSchemaTable,
	questpieCrdtTables,
} from "../../../src/server/modules/core/integrated/crdt/schema.js";

const SCHEMA_FINGERPRINT = bytes(0x11);
const CODEC_FINGERPRINT = bytes(0x22);
const STABLE_TITLE_ID = "0f45eb44-6290-4a8a-83fc-b3557e434a92";
const STABLE_TAGS_ID = "340b8633-f152-4b84-84e3-14c76643aa79";

describe("CRDT durable store", () => {
	let ddl: string[];
	let client: PGlite;
	let db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>;

	beforeAll(async () => {
		const { generateDrizzleJson, generateMigration } =
			await import("drizzle-kit/api-postgres");
		const empty = {
			id: "00000000-0000-0000-0000-000000000000",
			dialect: "postgres" as const,
			prevIds: [],
			version: "8" as const,
			ddl: [],
			renames: [],
		};
		const snapshot = await generateDrizzleJson(questpieCrdtTables, empty.id);
		ddl = await generateMigration(empty, snapshot);
	});

	beforeEach(async () => {
		client = await PGlite.create();
		db = drizzle(client, { schema: questpieCrdtTables });
		for (const statement of ddl) {
			if (statement.trim()) {
				await db.execute(sql.raw(statement));
			}
		}
	});

	afterEach(async () => {
		await client?.close();
	});

	it("rolls the whole metadata registration back with its caller", async () => {
		const store = createCrdtDurableStore(db);

		await expect(
			store.transaction(async (tx) => {
				await tx.registerDefinitionSchema(definitionSchema());
				throw new Error("owner create failed");
			}),
		).rejects.toThrow("owner create failed");

		const [namespaceCount] = await db
			.select({ value: count() })
			.from(questpieCrdtNamespaceTable);
		const [definitionCount] = await db
			.select({ value: count() })
			.from(questpieCrdtDefinitionTable);
		expect(namespaceCount?.value).toBe(0);
		expect(definitionCount?.value).toBe(0);
	});

	it("reuses exact registrations and rejects namespace or schema drift", async () => {
		const store = createCrdtDurableStore(db);
		const first = await store.transaction((tx) =>
			tx.registerDefinitionSchema(definitionSchema()),
		);
		const repeated = await store.transaction((tx) =>
			tx.registerDefinitionSchema(definitionSchema()),
		);

		expect(repeated).toEqual(first);
		await expect(
			store.transaction((tx) =>
				tx.registerDefinitionSchema({
					...definitionSchema(),
					namespace: "another-app",
				}),
			),
		).rejects.toBeInstanceOf(CrdtDurableStoreConflictError);
		await expect(
			store.transaction((tx) =>
				tx.registerDefinitionSchema({
					...definitionSchema(),
					schema: {
						...definitionSchema().schema,
						fingerprint: bytes(0x33),
					},
				}),
			),
		).rejects.toBeInstanceOf(CrdtDurableStoreConflictError);
		await expect(
			store.transaction((tx) =>
				tx.registerDefinitionSchema({
					...definitionSchema(),
					schema: {
						...definitionSchema().schema,
						fields: [
							{
								...definitionSchema().schema.fields[0]!,
								sourcePath: "renamedTitle",
							},
							definitionSchema().schema.fields[1]!,
						],
					},
				}),
			),
		).rejects.toBeInstanceOf(CrdtDurableStoreConflictError);

		const [schemaCount] = await db
			.select({ value: count() })
			.from(questpieCrdtSchemaTable);
		const [fieldCount] = await db
			.select({ value: count() })
			.from(questpieCrdtSchemaFieldTable);
		expect(schemaCount?.value).toBe(1);
		expect(fieldCount?.value).toBe(2);
	});

	it("round-trips u32 schema versions as bigint without precision loss", async () => {
		const store = createCrdtDurableStore(db);
		const version = 4_294_967_295n;
		const result = await store.transaction((tx) =>
			tx.registerDefinitionSchema({
				...definitionSchema(),
				schema: { ...definitionSchema().schema, version },
			}),
		);

		const [stored] = await db
			.select({ version: questpieCrdtSchemaTable.schemaVersion })
			.from(questpieCrdtSchemaTable)
			.where(eq(questpieCrdtSchemaTable.id, result.schemaId));
		expect(stored?.version).toBe(version);
		expect(typeof stored?.version).toBe("bigint");
	});

	it("serializes simultaneous identical registration without duplicate rows", async () => {
		const store = createCrdtDurableStore(db);
		const [left, right] = await Promise.all([
			store.transaction((tx) =>
				tx.registerDefinitionSchema(definitionSchema()),
			),
			store.transaction((tx) =>
				tx.registerDefinitionSchema(definitionSchema()),
			),
		]);

		expect(left).toEqual(right);
		const [schemaCount] = await db
			.select({ value: count() })
			.from(questpieCrdtSchemaTable);
		const [fieldCount] = await db
			.select({ value: count() })
			.from(questpieCrdtSchemaFieldTable);
		expect(schemaCount?.value).toBe(1);
		expect(fieldCount?.value).toBe(2);
	});

	it("gives one winner to simultaneous conflicting schema registrations", async () => {
		const store = createCrdtDurableStore(db);
		const outcomes = await Promise.allSettled([
			store.transaction((tx) =>
				tx.registerDefinitionSchema(definitionSchema()),
			),
			store.transaction((tx) =>
				tx.registerDefinitionSchema({
					...definitionSchema(),
					schema: {
						...definitionSchema().schema,
						fingerprint: bytes(0x44),
					},
				}),
			),
		]);

		expect(
			outcomes.filter((outcome) => outcome.status === "fulfilled"),
		).toHaveLength(1);
		const [rejected] = outcomes.filter(
			(outcome) => outcome.status === "rejected",
		);
		expect(rejected?.reason).toBeInstanceOf(CrdtDurableStoreConflictError);
	});

	it("validates discriminants and stable UUIDs before touching PostgreSQL", async () => {
		const store = createCrdtDurableStore(db);
		await expect(
			store.transaction((tx) =>
				tx.registerDefinitionSchema({
					...definitionSchema(),
					owner: { ...definitionSchema().owner, kind: 9 as 1 },
				}),
			),
		).rejects.toThrow("owner kind");
		await expect(
			store.transaction((tx) =>
				tx.registerDefinitionSchema({
					...definitionSchema(),
					schema: {
						...definitionSchema().schema,
						fields: [
							{
								...definitionSchema().schema.fields[0]!,
								stableFieldId: "not-a-uuid",
							},
						],
					},
				}),
			),
		).rejects.toThrow("stable field ID");
	});
});

function definitionSchema() {
	return {
		namespace: "questpie-test",
		owner: {
			kind: 1 as const,
			key: "articles",
			identityVersion: 1,
		},
		schema: {
			version: 7n,
			fingerprint: SCHEMA_FINGERPRINT,
			fields: [
				{
					stableFieldId: STABLE_TITLE_ID,
					fieldSlot: 1,
					sourcePath: "title",
					format: 1 as const,
					formatVersion: 1,
					codecFingerprint: CODEC_FINGERPRINT,
				},
				{
					stableFieldId: STABLE_TAGS_ID,
					fieldSlot: 2,
					sourcePath: "tags",
					format: 2 as const,
					formatVersion: 1,
					codecFingerprint: CODEC_FINGERPRINT,
				},
			],
		},
	};
}

function bytes(value: number): Uint8Array {
	return new Uint8Array(32).fill(value);
}
