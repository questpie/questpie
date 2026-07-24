import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { createHash } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import {
	collectCrdtExpiredRecoveryRoots,
	createCrdtCompactionStore,
} from "../../../src/server/modules/core/integrated/crdt/compaction-store.js";
import { createDeterministicTextEngine } from "../../../src/server/modules/core/integrated/crdt/deterministic-engine.js";
import { createCrdtSnapshotManifestChecksum } from "../../../src/server/modules/core/integrated/crdt/durable-store.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtSnapshotManifestTable,
	questpieCrdtSnapshotTable,
	questpieCrdtTables,
} from "../../../src/server/modules/core/integrated/crdt/schema.js";
import { hashCrdtCanonicalValue } from "../../../src/shared/crdt-engine.js";

const ID = {
	definition: "00000000-0000-4000-8000-000000009001",
	schema: "00000000-0000-4000-8000-000000009002",
	schemaField: "00000000-0000-4000-8000-000000009003",
	stableField: "00000000-0000-4000-8000-000000009004",
	resource: "00000000-0000-4000-8000-000000009005",
	epoch: "00000000-0000-4000-8000-000000009006",
	binding: "00000000-0000-4000-8000-000000009007",
	manifest: "00000000-0000-4000-8000-000000009008",
	subject: "00000000-0000-4000-8000-000000009009",
	retiredSchemaField: "00000000-0000-4000-8000-00000000900a",
	retiredStableField: "00000000-0000-4000-8000-00000000900b",
	retiredBinding: "00000000-0000-4000-8000-00000000900c",
} as const;

const engine = createDeterministicTextEngine();

describe("CRDT durable compaction store", () => {
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
		ddl = await generateMigration(
			empty,
			await generateDrizzleJson(questpieCrdtTables, empty.id),
		);
	});

	beforeEach(async () => {
		await client?.close();
		client = await PGlite.create();
		db = drizzle(client, { schema: questpieCrdtTables });
		for (const statement of ddl) {
			if (statement.trim()) await db.execute(sql.raw(statement));
		}
		await seedCompactionBasis(db);
	});

	afterAll(async () => {
		await client?.close();
	});

	it("captures, persists, verifies, and publishes one exact aggregate cut", async () => {
		const store = createCrdtCompactionStore(db, {
			ownerId: "compactor-a",
			resolveEngine: () => engine,
		});
		await expect(store.runOnce()).resolves.toEqual({
			status: "published",
			deleted: 0,
		});
		const [epoch] = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.id, ID.epoch));
		expect(epoch?.previousSnapshotManifestId).toBe(ID.manifest);
		expect(epoch?.currentSnapshotManifestId).not.toBe(ID.manifest);
		const manifests = await db.select().from(questpieCrdtSnapshotManifestTable);
		expect(manifests).toHaveLength(2);
		expect(
			manifests.find(
				(manifest) => manifest.id === epoch?.currentSnapshotManifestId,
			),
		).toMatchObject({ coversCommitSeq: 512n, status: 2 });
	});

	it("leaves a verified orphan when the fenced lease expires before publish", async () => {
		const store = createCrdtCompactionStore(db, {
			ownerId: "short-lived-compactor",
			leaseMilliseconds: 1,
			resolveEngine: () => engine,
		});
		await expect(store.runOnce()).resolves.toEqual({
			status: "stale",
			deleted: 0,
		});
		const [epoch] = await db
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.id, ID.epoch));
		expect(epoch?.currentSnapshotManifestId).toBe(ID.manifest);
		expect(
			await db.select().from(questpieCrdtSnapshotManifestTable),
		).toHaveLength(2);
	});

	it("honors active holds, the 30-day horizon, and the shared root bound", async () => {
		await db.execute(sql`
			INSERT INTO questpie_crdt_subject
				(id, kind, issuer_key, subject_key, subject_hash)
			VALUES (${ID.subject}, 1, '', 'retention-user',
				decode(repeat('71', 32), 'hex'))
		`);
		await db.execute(sql`
			INSERT INTO questpie_crdt_resource_epoch
				(id, resource_id, definition_id, aggregate_epoch, schema_id,
				 status, closed_at)
			SELECT gen_random_uuid(), ${ID.resource}, ${ID.definition},
				1000 + value, ${ID.schema}, 2,
				clock_timestamp() - interval '31 days'
			FROM generate_series(1, 258) AS value
		`);
		await db.execute(sql`
			INSERT INTO questpie_crdt_resource_epoch
				(resource_id, definition_id, aggregate_epoch, schema_id,
				 status, closed_at)
			VALUES (${ID.resource}, ${ID.definition}, 2000, ${ID.schema}, 2,
				clock_timestamp() - interval '29 days')
		`);
		await db.execute(sql`
			INSERT INTO questpie_crdt_schema_field
				(id, definition_id, schema_id, stable_field_id, field_slot,
				 source_path, format, format_version, codec_fingerprint)
			VALUES (${ID.retiredSchemaField}, ${ID.definition}, ${ID.schema},
				${ID.retiredStableField}, 2, 'retired', 1, 1,
				decode(${engine.codecFingerprint}, 'hex'))
		`);
		await db.execute(sql`
			INSERT INTO questpie_crdt_binding
				(id, resource_id, definition_id, schema_id, schema_field_id,
				 stable_field_id, field_slot, source_path, format, format_version,
				 field_epoch, canonical_hash, projected_canonical_hash, status,
				 retired_at)
			VALUES (${ID.retiredBinding}, ${ID.resource}, ${ID.definition},
				${ID.schema}, ${ID.retiredSchemaField}, ${ID.retiredStableField},
				2, 'retired', 1, 1, 0, decode(repeat('31', 32), 'hex'),
				decode(repeat('31', 32), 'hex'), 2,
				clock_timestamp() - interval '31 days')
		`);
		const [held] = rowsOf<{ id: string }>(
			await db.execute(sql`
				SELECT id FROM questpie_crdt_resource_epoch
				WHERE status = 2 ORDER BY aggregate_epoch LIMIT 1
			`),
		);
		await db.execute(sql`
			INSERT INTO questpie_crdt_recovery_hold
				(resource_id, resource_epoch_id, subject_id, reason, expires_at)
			VALUES (${ID.resource}, ${held!.id}, ${ID.subject}, 1,
				clock_timestamp() + interval '1 day')
		`);
		expect(await collectCrdtExpiredRecoveryRoots(db, { limit: 256 })).toBe(256);
		const remaining = rowsOf<{ id: string }>(
			await db.execute(
				sql`SELECT id FROM questpie_crdt_resource_epoch WHERE status = 2`,
			),
		);
		expect(remaining).toHaveLength(3);
		expect(remaining.some((epoch) => epoch.id === held!.id)).toBeTrue();
		await db.execute(
			sql`UPDATE questpie_crdt_recovery_hold SET expires_at = clock_timestamp() - interval '1 second'`,
		);
		expect(await collectCrdtExpiredRecoveryRoots(db, { limit: 256 })).toBe(4);
		expect(
			rowsOf(
				await db.execute(
					sql`SELECT id FROM questpie_crdt_resource_epoch WHERE status = 2`,
				),
			),
		).toHaveLength(1);
		expect(
			await db
				.select()
				.from(questpieCrdtBindingTable)
				.where(eq(questpieCrdtBindingTable.id, ID.retiredBinding)),
		).toHaveLength(0);
	}, 20_000);

	it("resumably drains more than 256 physical child rows before the epoch root", async () => {
		await db.execute(sql`
			INSERT INTO questpie_crdt_subject
				(id, kind, issuer_key, subject_key, subject_hash)
			VALUES (${ID.subject}, 1, '', 'bulk-hold-user',
				decode(repeat('72', 32), 'hex'))
		`);
		const [closed] = rowsOf<{ id: string }>(
			await db.execute(sql`
				INSERT INTO questpie_crdt_resource_epoch
					(resource_id, definition_id, aggregate_epoch, schema_id,
					 status, closed_at)
				VALUES (${ID.resource}, ${ID.definition}, 3000, ${ID.schema}, 2,
					clock_timestamp() - interval '31 days')
				RETURNING id
			`),
		);
		await db.execute(sql`
			INSERT INTO questpie_crdt_recovery_hold
				(resource_id, resource_epoch_id, subject_id, reason, expires_at)
			SELECT ${ID.resource}, ${closed!.id}, ${ID.subject}, 1,
				clock_timestamp() - interval '1 second'
			FROM generate_series(1, 300)
		`);
		expect(await collectCrdtExpiredRecoveryRoots(db, { limit: 256 })).toBe(256);
		expect(
			rowsOf(
				await db.execute(sql`
					SELECT id FROM questpie_crdt_recovery_hold
					WHERE resource_epoch_id = ${closed!.id}
				`),
			),
		).toHaveLength(44);
		expect(
			rowsOf(
				await db.execute(sql`
					SELECT id FROM questpie_crdt_resource_epoch WHERE id = ${closed!.id}
				`),
			),
		).toHaveLength(1);
		expect(await collectCrdtExpiredRecoveryRoots(db, { limit: 256 })).toBe(45);
		expect(
			rowsOf(
				await db.execute(sql`
					SELECT id FROM questpie_crdt_resource_epoch WHERE id = ${closed!.id}
				`),
			),
		).toHaveLength(0);
	}, 20_000);
});

async function seedCompactionBasis(
	db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>,
): Promise<void> {
	const replica = await engine.create({
		value: "",
		basis: { fieldEpoch: 0n, fieldCursor: 0n },
	});
	const bytes = await engine.snapshot(replica);
	const checksum = createHash("sha256").update(bytes).digest();
	const canonicalHash = await hashCrdtCanonicalValue("text", "");
	const fields = [
		{
			bindingId: ID.binding,
			stableFieldId: ID.stableField,
			fieldEpoch: 0n,
			fieldSlot: 1,
			formatVersion: engine.formatVersion,
			fieldCursor: 0n,
			engineId: engine.engineId,
			engineVersion: engine.engineVersion,
			stateVersion: engine.stateVersion,
			sizeBytes: bytes.byteLength,
			checksum: new Uint8Array(checksum),
		},
	];
	const manifestChecksum = createCrdtSnapshotManifestChecksum({
		resourceId: ID.resource,
		resourceEpochId: ID.epoch,
		schemaId: ID.schema,
		coversCommitSeq: 0n,
		fields,
	});
	for (const statement of [
		sql`INSERT INTO questpie_crdt_namespace (singleton, namespace)
			VALUES (1, 'compaction-test')`,
		sql`INSERT INTO questpie_crdt_definition
			(id, namespace_singleton, owner_kind, owner_key, identity_version)
			VALUES (${ID.definition}, 1, 1, 'articles', 1)`,
		sql`INSERT INTO questpie_crdt_schema
			(id, definition_id, schema_version, schema_fingerprint)
			VALUES (${ID.schema}, ${ID.definition}, 1,
				decode(repeat('11', 32), 'hex'))`,
		sql`INSERT INTO questpie_crdt_schema_field
			(id, definition_id, schema_id, stable_field_id, field_slot,
			 source_path, format, format_version, codec_fingerprint)
			VALUES (${ID.schemaField}, ${ID.definition}, ${ID.schema},
				${ID.stableField}, 1, 'title', 1, 1,
				decode(${engine.codecFingerprint}, 'hex'))`,
		sql`INSERT INTO questpie_crdt_resource
			(id, definition_id, locator, locator_hash, identity_version, status)
			VALUES (${ID.resource}, ${ID.definition}, '{"id":"article"}',
				decode(repeat('22', 32), 'hex'), 1, 3)`,
		sql`INSERT INTO questpie_crdt_resource_epoch
			(id, resource_id, definition_id, aggregate_epoch, schema_id,
			 head_commit_seq, status)
			VALUES (${ID.epoch}, ${ID.resource}, ${ID.definition}, 0, ${ID.schema},
				512, 1)`,
		sql`UPDATE questpie_crdt_resource
			SET status = 1, current_epoch_id = ${ID.epoch}, current_epoch_status = 1
			WHERE id = ${ID.resource}`,
	]) {
		await db.execute(statement);
	}
	await db.insert(questpieCrdtBindingTable).values({
		id: ID.binding,
		resourceId: ID.resource,
		definitionId: ID.definition,
		schemaId: ID.schema,
		schemaFieldId: ID.schemaField,
		stableFieldId: ID.stableField,
		fieldSlot: 1,
		sourcePath: "title",
		format: 1,
		formatVersion: engine.formatVersion,
		fieldEpoch: 0n,
		canonicalHash: Buffer.from(canonicalHash),
		projectedCanonicalHash: Buffer.from(canonicalHash),
	});
	await db.insert(questpieCrdtSnapshotManifestTable).values({
		id: ID.manifest,
		resourceId: ID.resource,
		resourceEpochId: ID.epoch,
		definitionId: ID.definition,
		schemaId: ID.schema,
		coversCommitSeq: 0n,
		status: 2,
		totalBytes: bytes.byteLength,
		fieldCount: 1,
		checksum: Buffer.from(manifestChecksum),
		leaseGeneration: 0n,
		verifiedAt: new Date(),
	});
	await db.insert(questpieCrdtSnapshotTable).values({
		manifestId: ID.manifest,
		resourceId: ID.resource,
		resourceEpochId: ID.epoch,
		schemaId: ID.schema,
		...fields[0]!,
		bytes: Buffer.from(bytes),
	});
	await db
		.update(questpieCrdtResourceEpochTable)
		.set({
			currentSnapshotManifestId: ID.manifest,
			currentSnapshotStatus: 2,
		})
		.where(eq(questpieCrdtResourceEpochTable.id, ID.epoch));
}

function rowsOf<T>(result: unknown): T[] {
	if (
		result &&
		typeof result === "object" &&
		"rows" in result &&
		Array.isArray(result.rows)
	) {
		return result.rows as T[];
	}
	return result as T[];
}
