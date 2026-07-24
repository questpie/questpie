import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import {
	createCrdtDurableStore,
	createCrdtSnapshotManifestChecksum,
} from "../../../src/server/modules/core/integrated/crdt/durable-store.js";
import { questpieCrdtTables } from "../../../src/server/modules/core/integrated/crdt/schema.js";

const ID = {
	definitionA: "00000000-0000-4000-8000-000000000001",
	definitionB: "00000000-0000-4000-8000-000000000002",
	schemaA: "00000000-0000-4000-8000-000000000011",
	schemaB: "00000000-0000-4000-8000-000000000012",
	schemaA2: "00000000-0000-4000-8000-000000000013",
	fieldA: "00000000-0000-4000-8000-000000000021",
	fieldB: "00000000-0000-4000-8000-000000000022",
	fieldA2: "00000000-0000-4000-8000-000000000023",
	stableA: "00000000-0000-4000-8000-000000000031",
	stableB: "00000000-0000-4000-8000-000000000032",
	resourceA: "00000000-0000-4000-8000-000000000041",
	resourceB: "00000000-0000-4000-8000-000000000042",
	epochA: "00000000-0000-4000-8000-000000000051",
	epochB: "00000000-0000-4000-8000-000000000052",
	closedEpochA: "00000000-0000-4000-8000-000000000053",
	bindingA: "00000000-0000-4000-8000-000000000061",
	bindingB: "00000000-0000-4000-8000-000000000062",
	bindingA2: "00000000-0000-4000-8000-000000000063",
	subjectA: "00000000-0000-4000-8000-000000000071",
	ticketA: "00000000-0000-4000-8000-000000000081",
	ticketB: "00000000-0000-4000-8000-000000000082",
	sessionA: "00000000-0000-4000-8000-000000000091",
	manifestClosedA: "00000000-0000-4000-8000-0000000000a1",
	manifestActiveA: "00000000-0000-4000-8000-0000000000a2",
	receiptA: "00000000-0000-4000-8000-0000000000b1",
	projectionA: "00000000-0000-4000-8000-0000000000c1",
	compatibilityA: "00000000-0000-4000-8000-0000000000d1",
	leaseOwnerA: "compactor-a",
} as const;

describe("CRDT cross-identity database invariants", () => {
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
		const ddl = await generateMigration(empty, snapshot);
		client = await PGlite.create();
		db = drizzle(client, { schema: questpieCrdtTables });
		for (const statement of ddl) {
			if (statement.trim()) await db.execute(sql.raw(statement));
		}
		await seedValidIdentities(db);
	});

	afterAll(async () => {
		await client?.close();
	});

	it("rejects every cross-definition, resource, epoch, and authority graft", async () => {
		await rejects(
			db.execute(sql`
				INSERT INTO questpie_crdt_resource_epoch
					(id, resource_id, definition_id, aggregate_epoch, schema_id, status, closed_at)
				VALUES
					('00000000-0000-4000-8000-000000000101', ${ID.resourceA}, ${ID.definitionA}, 9, ${ID.schemaB}, 2, now())
			`),
			"fk_crdt_epoch_schema",
		);

		await rejects(
			db.execute(sql`
				INSERT INTO questpie_crdt_binding
					(id, resource_id, definition_id, schema_id, schema_field_id, stable_field_id, field_slot, source_path, format, format_version, field_epoch, canonical_hash, projected_canonical_hash, status, retired_at)
				VALUES
					('00000000-0000-4000-8000-000000000102', ${ID.resourceA}, ${ID.definitionA}, ${ID.schemaA}, ${ID.fieldA}, ${ID.stableA}, 1, 'wrong-path', 1, 1, 9, ${hash(0x31)}, ${hash(0x31)}, 2, now())
			`),
			"fk_crdt_binding_schema_field",
		);

		await rejects(
			db.execute(sql`
				INSERT INTO questpie_crdt_commit
					(resource_id, resource_epoch_id, definition_id, commit_seq, kind, schema_id, canonical_bundle_hash, delivery_commit_id, subject_id, control_payload)
				VALUES
					(${ID.resourceA}, ${ID.epochA}, ${ID.definitionA}, 90, 4, ${ID.schemaB}, ${hash(0x41)}, '00000000-0000-4000-8000-000000000103', ${ID.subjectA}, '{}'::jsonb)
			`),
			"fk_crdt_commit_schema",
		);

		await rejects(
			db.execute(sql`
				UPDATE questpie_crdt_resource_epoch
				SET current_snapshot_manifest_id = ${ID.manifestClosedA},
					current_snapshot_status = 2
				WHERE id = ${ID.epochA}
			`),
			"fk_crdt_epoch_current_manifest",
		);

		await rejects(
			db.execute(sql`
				INSERT INTO questpie_crdt_schema_compatibility_field
					(compatibility_id, resource_id, source_schema_id, source_schema_field_id, source_binding_id, source_field_epoch, source_field_slot, source_format_version, target_schema_id, target_schema_field_id, target_binding_id, target_field_epoch, target_field_slot, target_format_version)
				VALUES
					(${ID.compatibilityA}, ${ID.resourceB}, ${ID.schemaB}, ${ID.fieldB}, ${ID.bindingB}, 0, 1, 1, ${ID.schemaB}, ${ID.fieldB}, ${ID.bindingB}, 0, 1, 1)
			`),
			"fk_crdt_compat_field_parent",
		);

		await rejects(
			db.execute(sql`
				INSERT INTO questpie_crdt_receipt_field
					(receipt_id, resource_id, schema_id, binding_id, stable_field_id, field_epoch, field_slot, format_version, field_cursor)
				VALUES
					(${ID.receiptA}, ${ID.resourceB}, ${ID.schemaB}, ${ID.bindingB}, ${ID.stableB}, 0, 1, 1, 1)
			`),
			"fk_crdt_receipt_field_parent",
		);

		await rejects(
			db.execute(sql`
				INSERT INTO questpie_crdt_ticket_grant
					(ticket_id, resource_id, schema_id, binding_id, stable_field_id, field_epoch, field_slot, format_version, "grant", head_field_cursor, field_read_fence, field_edit_fence, subject_field_read_fence, subject_field_edit_fence)
				VALUES
					(${ID.ticketA}, ${ID.resourceB}, ${ID.schemaB}, ${ID.bindingB}, ${ID.stableB}, 0, 1, 1, 1, 0, 0, 0, 0, 0)
			`),
			"fk_crdt_ticket_grant_parent",
		);

		await rejects(
			db.execute(sql`
				INSERT INTO questpie_crdt_session
					(id, ticket_id, resource_id, resource_epoch_id, schema_id, subject_id, credential_fingerprint, requested_mode, effective_mode, generation, resource_read_fence, resource_edit_fence, owner_policy_revision, subject_read_fence, subject_edit_fence, authority_expires_at, last_seen_commit_seq, lease_expires_at)
				VALUES
					('00000000-0000-4000-8000-000000000104', ${ID.ticketB}, ${ID.resourceB}, ${ID.epochB}, ${ID.schemaB}, ${ID.subjectA}, ${hash(0x71)}, 2, 2, 0, 0, 0, 0, 0, 0, now() + interval '1 minute', 0, now() + interval '1 minute')
			`),
			"fk_crdt_session_ticket",
		);

		await rejects(
			db.execute(sql`
				INSERT INTO questpie_crdt_session_grant
					(session_id, ticket_id, resource_id, schema_id, binding_id, stable_field_id, field_epoch, field_slot, format_version, "grant", head_field_cursor, field_read_fence, field_edit_fence, subject_field_read_fence, subject_field_edit_fence)
				VALUES
					(${ID.sessionA}, ${ID.ticketA}, ${ID.resourceB}, ${ID.schemaB}, ${ID.bindingB}, ${ID.stableB}, 0, 1, 1, 1, 0, 0, 0, 0, 0)
			`),
			"fk_crdt_session_grant_parent",
		);

		await rejects(
			db.execute(sql`
				INSERT INTO questpie_crdt_session_grant
					(session_id, ticket_id, resource_id, schema_id, binding_id, stable_field_id, field_epoch, field_slot, format_version, "grant", head_field_cursor, field_read_fence, field_edit_fence, subject_field_read_fence, subject_field_edit_fence)
				VALUES
					(${ID.sessionA}, ${ID.ticketA}, ${ID.resourceA}, ${ID.schemaA}, ${ID.bindingA}, ${ID.stableA}, 0, 1, 1, 1, 0, 0, 0, 0, 0)
			`),
			"fk_crdt_session_grant_ticket_grant",
		);

		await rejects(
			db.execute(sql`
				INSERT INTO questpie_crdt_awareness
					(session_id, resource_id, value, size_bytes, expires_at)
				VALUES
					(${ID.sessionA}, ${ID.resourceB}, '{}'::jsonb, 2, now() + interval '1 minute')
			`),
			"fk_crdt_awareness_session",
		);

		await rejects(
			db.execute(sql`
				INSERT INTO questpie_crdt_projection_field
					(projection_id, resource_id, schema_id, binding_id, stable_field_id, field_epoch, field_slot, format_version, target_field_cursor, expected_canonical_hash, expected_canonical_revision, should_write)
				VALUES
					(${ID.projectionA}, ${ID.resourceB}, ${ID.schemaB}, ${ID.bindingB}, ${ID.stableB}, 0, 1, 1, 0, ${hash(0x81)}, 0, 1)
			`),
			"fk_crdt_projection_field_parent",
		);

		await rejects(
			db.execute(sql`
				INSERT INTO questpie_crdt_update_receipt
					(id, resource_id, resource_epoch_id, definition_id, update_id, commit_seq, submitted_schema_id, submitted_schema_version, submitted_bundle_hash, normalized_schema_id, normalized_commit_hash, subject_id, expires_at)
				VALUES
					('00000000-0000-4000-8000-000000000105', ${ID.resourceA}, ${ID.epochA}, ${ID.definitionA}, '00000000-0000-4000-8000-000000000106', 1, ${ID.schemaA}, 99, ${hash(0x91)}, ${ID.schemaA}, ${hash(0x81)}, ${ID.subjectA}, now() + interval '1 day')
			`),
			"fk_crdt_receipt_submitted_schema",
		);

		await rejects(
			db.execute(sql`
				INSERT INTO questpie_crdt_commit
					(resource_id, resource_epoch_id, definition_id, commit_seq, kind, schema_id, canonical_bundle_hash, delivery_commit_id, subject_id, session_id)
				VALUES
					(${ID.resourceA}, ${ID.epochA}, ${ID.definitionA}, 91, 1, ${ID.schemaA}, ${hash(0xa1)}, '00000000-0000-4000-8000-000000000107', ${ID.subjectA}, '00000000-0000-4000-8000-000000000108')
			`),
			"fk_crdt_commit_session",
		);

		await rejects(
			db.execute(sql`
				INSERT INTO questpie_crdt_commit
					(resource_id, resource_epoch_id, definition_id, commit_seq, kind, schema_id, canonical_bundle_hash, delivery_commit_id)
				VALUES
					(${ID.resourceA}, ${ID.epochA}, ${ID.definitionA}, 92, 1, ${ID.schemaA}, ${hash(0xa2)}, '00000000-0000-4000-8000-000000000109')
			`),
			"ck_crdt_commit_kind_payload",
		);
	});

	it("publishes only a complete verified manifest at an exact locked cut", async () => {
		const snapshotBytes = new Uint8Array([0]);
		const snapshotChecksum = createHash("sha256")
			.update(snapshotBytes)
			.digest();
		const fields = [
			{
				bindingId: ID.bindingA,
				stableFieldId: ID.stableA,
				fieldEpoch: 0n,
				fieldSlot: 1,
				formatVersion: 1,
				fieldCursor: 0n,
				engineId: "deterministic-text",
				engineVersion: 1,
				stateVersion: 1,
				sizeBytes: 1,
				checksum: snapshotChecksum,
			},
		] as const;
		const manifestChecksum = createCrdtSnapshotManifestChecksum({
			resourceId: ID.resourceA,
			resourceEpochId: ID.epochA,
			schemaId: ID.schemaA,
			coversCommitSeq: 0n,
			fields,
		});
		await db.execute(sql`
			INSERT INTO questpie_crdt_snapshot_manifest
				(id, resource_id, resource_epoch_id, definition_id, schema_id, covers_commit_seq, status, total_bytes, field_count, checksum, lease_generation, verified_at)
			VALUES
				(${ID.manifestActiveA}, ${ID.resourceA}, ${ID.epochA}, ${ID.definitionA}, ${ID.schemaA}, 0, 2, 1, 1, ${manifestChecksum}, 7, now())
		`);
		const store = createCrdtDurableStore(db);
		const publication = {
			resourceId: ID.resourceA,
			resourceEpochId: ID.epochA,
			schemaId: ID.schemaA,
			manifestId: ID.manifestActiveA,
			manifestChecksum,
			coversCommitSeq: 0n,
			expectedHeadCommitSeq: 0n,
			leaseOwnerId: ID.leaseOwnerA,
			leaseGeneration: 7n,
			fields,
		};

		await expect(
			store.transaction((tx) => tx.publishVerifiedSnapshot(publication)),
		).rejects.toThrow("lease");
		await db.execute(sql`
			INSERT INTO questpie_crdt_lease
				(resource_id, kind, owner_id, generation, expires_at)
			VALUES
				(${ID.resourceA}, 1, ${ID.leaseOwnerA}, 7, now() + interval '1 minute')
		`);
		await expect(
			store.transaction((tx) => tx.publishVerifiedSnapshot(publication)),
		).rejects.toThrow("incomplete");
		await db.execute(sql`
			INSERT INTO questpie_crdt_snapshot
				(manifest_id, resource_id, resource_epoch_id, schema_id, binding_id, stable_field_id, field_epoch, field_slot, format_version, field_cursor, engine_id, engine_version, state_version, bytes, size_bytes, checksum)
			VALUES
				(${ID.manifestActiveA}, ${ID.resourceA}, ${ID.epochA}, ${ID.schemaA}, ${ID.bindingA}, ${ID.stableA}, 0, 1, 1, 0, 'deterministic-text', 1, 1, ${snapshotBytes}, 1, ${snapshotChecksum})
		`);
		await expect(
			store.transaction((tx) =>
				tx.publishVerifiedSnapshot({
					...publication,
					fields: [{ ...publication.fields[0]!, fieldCursor: 1n }],
					manifestChecksum: createCrdtSnapshotManifestChecksum({
						...publication,
						fields: [{ ...publication.fields[0]!, fieldCursor: 1n }],
					}),
				}),
			),
		).rejects.toThrow("publication candidate");
		await expect(
			store.transaction((tx) =>
				tx.publishVerifiedSnapshot({
					...publication,
					fields: [{ ...publication.fields[0]!, checksum: bytes(0xff) }],
					manifestChecksum: createCrdtSnapshotManifestChecksum({
						...publication,
						fields: [{ ...publication.fields[0]!, checksum: bytes(0xff) }],
					}),
				}),
			),
		).rejects.toThrow("publication candidate");
		const wrongEngineFields = [{ ...publication.fields[0]!, engineVersion: 2 }];
		const wrongEngineManifestChecksum = createCrdtSnapshotManifestChecksum({
			...publication,
			fields: wrongEngineFields,
		});
		await db.execute(sql`
			UPDATE questpie_crdt_snapshot_manifest
			SET checksum = ${wrongEngineManifestChecksum}
			WHERE id = ${ID.manifestActiveA}
		`);
		await expect(
			store.transaction((tx) =>
				tx.publishVerifiedSnapshot({
					...publication,
					fields: wrongEngineFields,
					manifestChecksum: wrongEngineManifestChecksum,
				}),
			),
		).rejects.toThrow("incomplete");
		await db.execute(sql`
			UPDATE questpie_crdt_snapshot_manifest
			SET checksum = ${manifestChecksum}
			WHERE id = ${ID.manifestActiveA}
		`);
		const corruptFields = [
			{ ...publication.fields[0]!, checksum: bytes(0xff) },
		];
		const corruptManifestChecksum = createCrdtSnapshotManifestChecksum({
			...publication,
			fields: corruptFields,
		});
		await db.execute(sql`
			UPDATE questpie_crdt_snapshot
			SET checksum = ${bytes(0xff)}
			WHERE manifest_id = ${ID.manifestActiveA}
		`);
		await db.execute(sql`
			UPDATE questpie_crdt_snapshot_manifest
			SET checksum = ${corruptManifestChecksum}
			WHERE id = ${ID.manifestActiveA}
		`);
		await expect(
			store.transaction((tx) =>
				tx.publishVerifiedSnapshot({
					...publication,
					fields: corruptFields,
					manifestChecksum: corruptManifestChecksum,
				}),
			),
		).rejects.toThrow("incomplete");
		await db.execute(sql`
			UPDATE questpie_crdt_snapshot
			SET checksum = ${snapshotChecksum}
			WHERE manifest_id = ${ID.manifestActiveA}
		`);
		await db.execute(sql`
			UPDATE questpie_crdt_snapshot_manifest
			SET checksum = ${manifestChecksum}
			WHERE id = ${ID.manifestActiveA}
		`);
		await db.execute(sql`
			UPDATE questpie_crdt_binding
			SET status = 3
			WHERE id = ${ID.bindingA}
		`);
		await expect(
			store.transaction((tx) => tx.publishVerifiedSnapshot(publication)),
		).resolves.toEqual({
			currentManifestId: ID.manifestActiveA,
			previousManifestId: null,
		});
		await expect(
			store.transaction((tx) =>
				tx.publishVerifiedSnapshot({
					...publication,
					expectedHeadCommitSeq: 1n,
				}),
			),
		).rejects.toThrow("stale");
		await db.execute(sql`
			UPDATE questpie_crdt_lease
			SET expires_at = clock_timestamp() + interval '50 milliseconds'
			WHERE resource_id = ${ID.resourceA} AND kind = 1
		`);
		await expect(
			store.transaction(async (tx) => {
				await new Promise((resolve) => setTimeout(resolve, 100));
				return tx.publishVerifiedSnapshot(publication);
			}),
		).rejects.toThrow("lease");
	});

	it("preserves historical schema rows while advancing a compatible epoch", async () => {
		const rollback = new Error("rollback compatible schema test");
		await expect(
			db.transaction(async (tx) => {
				await tx.execute(sql`
					INSERT INTO questpie_crdt_commit
						(resource_id, resource_epoch_id, definition_id, commit_seq, kind, schema_id, canonical_bundle_hash, delivery_commit_id, subject_id, control_payload)
					VALUES
						(${ID.resourceA}, ${ID.epochA}, ${ID.definitionA}, 93, 4, ${ID.schemaA2}, ${hash(0xc1)}, '00000000-0000-4000-8000-000000000110', ${ID.subjectA}, '{"kind":"manifest_change"}'::jsonb)
				`);
				await tx.execute(sql`
					UPDATE questpie_crdt_resource_epoch
					SET schema_id = ${ID.schemaA2}
					WHERE resource_id = ${ID.resourceA} AND id = ${ID.epochA}
				`);
				const result = await tx.execute(sql`
					SELECT schema_id
					FROM questpie_crdt_resource_epoch
					WHERE resource_id = ${ID.resourceA} AND id = ${ID.epochA}
				`);
				expect(result.rows[0]?.schema_id).toBe(ID.schemaA2);
				throw rollback;
			}),
		).rejects.toBe(rollback);
	});
});

async function seedValidIdentities(
	db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>,
): Promise<void> {
	await db.execute(sql`
		INSERT INTO questpie_crdt_namespace (singleton, namespace)
		VALUES (1, 'questpie-test');
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_definition
			(id, namespace_singleton, owner_kind, owner_key, identity_version)
		VALUES
			(${ID.definitionA}, 1, 1, 'articles', 1),
			(${ID.definitionB}, 1, 1, 'pages', 1);
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_schema
			(id, definition_id, schema_version, schema_fingerprint)
		VALUES
			(${ID.schemaA}, ${ID.definitionA}, 1, ${hash(0x11)}),
			(${ID.schemaB}, ${ID.definitionB}, 1, ${hash(0x12)}),
			(${ID.schemaA2}, ${ID.definitionA}, 2, ${hash(0x13)});
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_schema_field
			(id, definition_id, schema_id, stable_field_id, field_slot, source_path, format, format_version, codec_fingerprint)
		VALUES
			(${ID.fieldA}, ${ID.definitionA}, ${ID.schemaA}, ${ID.stableA}, 1, 'title', 1, 1, ${hash(0x21)}),
			(${ID.fieldB}, ${ID.definitionB}, ${ID.schemaB}, ${ID.stableB}, 1, 'content', 1, 1, ${hash(0x22)}),
			(${ID.fieldA2}, ${ID.definitionA}, ${ID.schemaA2}, ${ID.stableA}, 1, 'title', 1, 1, ${hash(0x21)});
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_resource
			(id, definition_id, locator, locator_hash, identity_version, status)
		VALUES
			(${ID.resourceA}, ${ID.definitionA}, '{"id":"a"}', ${hash(0x31)}, 1, 3),
			(${ID.resourceB}, ${ID.definitionB}, '{"id":"b"}', ${hash(0x32)}, 1, 3);
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_resource_epoch
			(id, resource_id, definition_id, aggregate_epoch, schema_id, status, closed_at)
		VALUES
			(${ID.epochA}, ${ID.resourceA}, ${ID.definitionA}, 1, ${ID.schemaA}, 1, NULL),
			(${ID.epochB}, ${ID.resourceB}, ${ID.definitionB}, 1, ${ID.schemaB}, 1, NULL),
			(${ID.closedEpochA}, ${ID.resourceA}, ${ID.definitionA}, 2, ${ID.schemaA}, 2, now());
	`);
	await db.execute(sql`
		UPDATE questpie_crdt_resource
		SET status = 1, current_epoch_id = ${ID.epochA}, current_epoch_status = 1
		WHERE id = ${ID.resourceA};
	`);
	await db.execute(sql`
		UPDATE questpie_crdt_resource
		SET status = 1, current_epoch_id = ${ID.epochB}, current_epoch_status = 1
		WHERE id = ${ID.resourceB};
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_binding
			(id, resource_id, definition_id, schema_id, schema_field_id, stable_field_id, field_slot, source_path, format, format_version, field_epoch, canonical_hash, projected_canonical_hash, status, retired_at)
		VALUES
			(${ID.bindingA}, ${ID.resourceA}, ${ID.definitionA}, ${ID.schemaA}, ${ID.fieldA}, ${ID.stableA}, 1, 'title', 1, 1, 0, ${hash(0x41)}, ${hash(0x41)}, 1, NULL),
			(${ID.bindingB}, ${ID.resourceB}, ${ID.definitionB}, ${ID.schemaB}, ${ID.fieldB}, ${ID.stableB}, 1, 'content', 1, 1, 0, ${hash(0x42)}, ${hash(0x42)}, 1, NULL),
			(${ID.bindingA2}, ${ID.resourceA}, ${ID.definitionA}, ${ID.schemaA2}, ${ID.fieldA2}, ${ID.stableA}, 1, 'title', 1, 1, 1, ${hash(0x41)}, ${hash(0x41)}, 2, now());
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_subject
			(id, kind, issuer_key, subject_key, subject_hash)
		VALUES
			(${ID.subjectA}, 1, '', 'user-a', ${hash(0x51)});
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_ticket
			(id, resource_id, resource_epoch_id, definition_id, schema_id, subject_id, secret_hash, credential_fingerprint, audience, requested_mode, effective_mode, protocol_major, protocol_minor, resource_read_fence, resource_edit_fence, owner_policy_revision, subject_read_fence, subject_edit_fence, session_generation, authority_expires_at, expires_at)
		VALUES
			(${ID.ticketA}, ${ID.resourceA}, ${ID.epochA}, ${ID.definitionA}, ${ID.schemaA}, ${ID.subjectA}, ${hash(0x61)}, ${hash(0x71)}, 'questpie-test', 2, 2, 1, 0, 0, 0, 0, 0, 0, 0, now() + interval '1 minute', now() + interval '1 minute'),
			(${ID.ticketB}, ${ID.resourceA}, ${ID.epochA}, ${ID.definitionA}, ${ID.schemaA}, ${ID.subjectA}, ${hash(0x62)}, ${hash(0x71)}, 'questpie-test', 2, 2, 1, 0, 0, 0, 0, 0, 0, 0, now() + interval '1 minute', now() + interval '1 minute');
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_ticket_grant
			(ticket_id, resource_id, schema_id, binding_id, stable_field_id, field_epoch, field_slot, format_version, "grant", head_field_cursor, field_read_fence, field_edit_fence, subject_field_read_fence, subject_field_edit_fence)
		VALUES
			(${ID.ticketA}, ${ID.resourceA}, ${ID.schemaA}, ${ID.bindingA}, ${ID.stableA}, 0, 1, 1, 0, 0, 0, 0, 0, 0);
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_session
			(id, ticket_id, resource_id, resource_epoch_id, schema_id, subject_id, credential_fingerprint, requested_mode, effective_mode, generation, resource_read_fence, resource_edit_fence, owner_policy_revision, subject_read_fence, subject_edit_fence, authority_expires_at, last_seen_commit_seq, lease_expires_at)
		VALUES
			(${ID.sessionA}, ${ID.ticketA}, ${ID.resourceA}, ${ID.epochA}, ${ID.schemaA}, ${ID.subjectA}, ${hash(0x71)}, 2, 2, 0, 0, 0, 0, 0, 0, now() + interval '1 minute', 0, now() + interval '1 minute');
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_commit
			(resource_id, resource_epoch_id, definition_id, commit_seq, kind, schema_id, canonical_bundle_hash, delivery_commit_id, subject_id, session_id)
		VALUES
			(${ID.resourceA}, ${ID.epochA}, ${ID.definitionA}, 1, 1, ${ID.schemaA}, ${hash(0x81)}, '00000000-0000-4000-8000-000000000201', ${ID.subjectA}, ${ID.sessionA});
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_commit
			(resource_id, resource_epoch_id, definition_id, commit_seq, kind, schema_id, canonical_bundle_hash, delivery_commit_id, subject_id, control_payload)
		VALUES
			(${ID.resourceA}, ${ID.epochA}, ${ID.definitionA}, 2, 4, ${ID.schemaA}, ${hash(0x82)}, '00000000-0000-4000-8000-000000000202', ${ID.subjectA}, '{}'::jsonb);
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_update_receipt
			(id, resource_id, resource_epoch_id, definition_id, update_id, commit_seq, submitted_schema_id, submitted_schema_version, submitted_bundle_hash, normalized_schema_id, normalized_commit_hash, subject_id, expires_at)
		VALUES
			(${ID.receiptA}, ${ID.resourceA}, ${ID.epochA}, ${ID.definitionA}, '00000000-0000-4000-8000-000000000203', 1, ${ID.schemaA}, 1, ${hash(0x91)}, ${ID.schemaA}, ${hash(0x81)}, ${ID.subjectA}, now() + interval '1 day');
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_snapshot_manifest
			(id, resource_id, resource_epoch_id, definition_id, schema_id, covers_commit_seq, status, total_bytes, field_count, checksum, lease_generation, verified_at)
		VALUES
			(${ID.manifestClosedA}, ${ID.resourceA}, ${ID.closedEpochA}, ${ID.definitionA}, ${ID.schemaA}, 0, 2, 1, 1, ${hash(0xa1)}, 1, now());
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_projection
			(id, resource_id, resource_epoch_id, schema_id, target_commit_seq, status, idempotency_key, due_at, lease_generation)
		VALUES
			(${ID.projectionA}, ${ID.resourceA}, ${ID.epochA}, ${ID.schemaA}, 1, 1, '00000000-0000-4000-8000-000000000204', now(), 0);
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_schema_compatibility
			(id, resource_id, resource_epoch_id, definition_id, source_schema_id, target_schema_id, manifest_commit_seq, expires_at)
		VALUES
			(${ID.compatibilityA}, ${ID.resourceA}, ${ID.epochA}, ${ID.definitionA}, ${ID.schemaA2}, ${ID.schemaA}, 2, now() + interval '1 day');
	`);
}

async function rejects(
	promise: PromiseLike<unknown>,
	constraint: string,
): Promise<void> {
	try {
		await promise;
		throw new Error(`expected ${constraint} to reject`);
	} catch (error) {
		expect(errorText(error)).toContain(constraint);
	}
}

function errorText(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const cause = "cause" in error ? error.cause : undefined;
	return `${error.message}\n${cause ? errorText(cause) : ""}\n${
		"constraint" in error ? String(error.constraint) : ""
	}`;
}

function hash(value: number) {
	return sql`decode(repeat(${value.toString(16).padStart(2, "0")}, 32), 'hex')`;
}

function bytes(value: number): Uint8Array {
	return new Uint8Array(32).fill(value);
}
