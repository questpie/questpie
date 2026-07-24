import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { questpieCrdtTables } from "../../../src/server/modules/core/integrated/crdt/schema.js";
import {
	createCrdtTicketAdmissionStore,
	type CrdtAuthorizedTicketSnapshot,
} from "../../../src/server/modules/core/integrated/crdt/ticket-store.js";
import { CrdtTicketRejectedError } from "../../../src/server/modules/core/integrated/crdt/ticket.js";

const databaseUrl =
	process.env.QUESTPIE_CRDT_DATABASE_URL ??
	process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;
const schemaName = `questpie_crdt_ticket_${randomUUID().replaceAll("-", "")}`;
const SECRET_KEY = "s".repeat(32);
const ID = {
	definition: "00000000-0000-4000-8000-000000000001",
	schema: "00000000-0000-4000-8000-000000000002",
	schemaField: "00000000-0000-4000-8000-000000000003",
	stableField: "00000000-0000-4000-8000-000000000004",
	resource: "00000000-0000-4000-8000-000000000005",
	incarnation: "00000000-0000-4000-8000-000000000006",
	epoch: "00000000-0000-4000-8000-000000000007",
	binding: "00000000-0000-4000-8000-000000000008",
	subject: "00000000-0000-4000-8000-000000000009",
} as const;

describe.skipIf(!databaseUrl)(
	"CRDT durable ticket admission on PostgreSQL 15+",
	() => {
		let admin: pg.Pool;
		let firstPool: pg.Pool;
		let secondPool: pg.Pool;
		let firstDb: ReturnType<typeof drizzle<typeof questpieCrdtTables>>;
		let secondDb: ReturnType<typeof drizzle<typeof questpieCrdtTables>>;

		beforeAll(async () => {
			admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
			const version = await admin.query<{ server_version_num: string }>(
				"show server_version_num",
			);
			expect(
				Number(version.rows[0]?.server_version_num),
			).toBeGreaterThanOrEqual(150_000);
			await admin.query(`CREATE SCHEMA "${schemaName}"`);

			firstPool = new pg.Pool({
				connectionString: databaseUrl,
				max: 10,
				options: `-c search_path=${schemaName}`,
			});
			secondPool = new pg.Pool({
				connectionString: databaseUrl,
				max: 10,
				options: `-c search_path=${schemaName}`,
			});
			firstDb = drizzle(firstPool, { schema: questpieCrdtTables });
			secondDb = drizzle(secondPool, { schema: questpieCrdtTables });

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
			for (const statement of await generateMigration(empty, snapshot)) {
				if (statement.trim()) await firstDb.execute(sql.raw(statement));
			}
			await seedResource(firstDb);
		});

		afterAll(async () => {
			await firstPool?.end();
			await secondPool?.end();
			if (admin) {
				await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
				await admin.end();
			}
		});

		it("allows exactly one redemption across two independent node pools", async () => {
			const firstNode = createCrdtTicketAdmissionStore(firstDb, {
				secretKey: SECRET_KEY,
			});
			const secondNode = createCrdtTicketAdmissionStore(secondDb, {
				secretKey: SECRET_KEY,
			});
			const issued = await firstNode.issue(authorization());
			const outcomes = await Promise.allSettled(
				Array.from({ length: 100 }, (_, index) =>
					(index % 2 === 0 ? firstNode : secondNode).redeem({
						ticket: issued.ticket,
						authorization: authorization(),
					}),
				),
			);

			expect(
				outcomes.filter((outcome) => outcome.status === "fulfilled"),
			).toHaveLength(1);
			const failures = outcomes.filter(
				(outcome) => outcome.status === "rejected",
			);
			expect(failures).toHaveLength(99);
			for (const failure of failures) {
				expect(failure.reason).toBeInstanceOf(CrdtTicketRejectedError);
				expect(failure.reason.message).toBe("CRDT ticket rejected");
			}
		}, 30_000);
	},
);

function authorization(): CrdtAuthorizedTicketSnapshot {
	return {
		resourceId: ID.resource,
		resourceEpochId: ID.epoch,
		definitionId: ID.definition,
		schemaId: ID.schema,
		incarnationKey: ID.incarnation,
		subjectId: ID.subject,
		credentialFingerprint: Buffer.alloc(32, 0x71),
		audience: "questpie-test",
		origin: "https://app.example",
		requestedMode: "edit",
		effectiveMode: "edit",
		resourceReadFence: 0n,
		resourceEditFence: 0n,
		ownerPolicyRevision: 0n,
		subjectReadFence: 0n,
		subjectEditFence: 0n,
		sessionGeneration: 0n,
		authorityExpiresAt: new Date(Date.now() + 60_000),
		headCommitSeq: 0n,
		bindings: [
			{
				bindingId: ID.binding,
				stableFieldId: ID.stableField,
				fieldEpoch: 0n,
				fieldSlot: 1,
				formatVersion: 1,
				headFieldCursor: 0n,
				fieldReadFence: 0n,
				fieldEditFence: 0n,
			},
		],
		grants: [
			{
				bindingId: ID.binding,
				stableFieldId: ID.stableField,
				fieldEpoch: 0n,
				fieldSlot: 1,
				formatVersion: 1,
				grant: "edit",
				headFieldCursor: 0n,
				fieldReadFence: 0n,
				fieldEditFence: 0n,
				subjectFieldReadFence: 0n,
				subjectFieldEditFence: 0n,
			},
		],
	};
}

async function seedResource(
	db: ReturnType<typeof drizzle<any>>,
): Promise<void> {
	await db.execute(sql`
		INSERT INTO questpie_crdt_namespace (singleton, namespace)
		VALUES (1, 'questpie-test');
		INSERT INTO questpie_crdt_definition
			(id, namespace_singleton, owner_kind, owner_key, identity_version)
		VALUES (${ID.definition}, 1, 1, 'articles', 1);
		INSERT INTO questpie_crdt_schema
			(id, definition_id, schema_version, schema_fingerprint)
		VALUES (${ID.schema}, ${ID.definition}, 1, decode(repeat('11', 32), 'hex'));
		INSERT INTO questpie_crdt_schema_field
			(id, definition_id, schema_id, stable_field_id, field_slot, source_path, format, format_version, codec_fingerprint)
		VALUES (${ID.schemaField}, ${ID.definition}, ${ID.schema}, ${ID.stableField}, 1, 'title', 1, 1, decode(repeat('12', 32), 'hex'));
		INSERT INTO questpie_crdt_resource
			(id, incarnation_key, definition_id, locator, locator_hash, identity_version, status)
		VALUES (${ID.resource}, ${ID.incarnation}, ${ID.definition}, '{"id":"article-1"}', decode(repeat('13', 32), 'hex'), 1, 3);
		INSERT INTO questpie_crdt_resource_epoch
			(id, resource_id, definition_id, aggregate_epoch, schema_id, status)
		VALUES (${ID.epoch}, ${ID.resource}, ${ID.definition}, 1, ${ID.schema}, 1);
		INSERT INTO questpie_crdt_binding
			(id, resource_id, definition_id, schema_id, schema_field_id, stable_field_id, field_slot, source_path, format, format_version, field_epoch, canonical_hash, projected_canonical_hash, status)
		VALUES (${ID.binding}, ${ID.resource}, ${ID.definition}, ${ID.schema}, ${ID.schemaField}, ${ID.stableField}, 1, 'title', 1, 1, 0, decode(repeat('14', 32), 'hex'), decode(repeat('14', 32), 'hex'), 1);
		UPDATE questpie_crdt_resource
		SET status = 1, current_epoch_id = ${ID.epoch}, current_epoch_status = 1
		WHERE id = ${ID.resource};
		INSERT INTO questpie_crdt_subject
			(id, kind, issuer_key, subject_key, subject_hash)
		VALUES (${ID.subject}, 1, '', 'user-1', decode(repeat('15', 32), 'hex'));
	`);
}
