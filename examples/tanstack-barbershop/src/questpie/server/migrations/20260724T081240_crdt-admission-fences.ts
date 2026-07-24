import { sql } from "drizzle-orm";
import type { OperationSnapshot } from "questpie/migration";
import { migration } from "questpie/services";

import snapshotJson from "./snapshots/20260724T081240_crdt-admission-fences.json";

const snapshot = snapshotJson as OperationSnapshot;

export default migration({
	id: "crdtAdmissionFences20260724T081240",
	async up({ db }) {
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket" DROP CONSTRAINT IF EXISTS "ck_crdt_ticket_state";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource" ADD COLUMN "incarnation_key" uuid DEFAULT gen_random_uuid() NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource" ADD COLUMN "session_generation" bigint DEFAULT 0 NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket" ADD COLUMN "effective_mode" smallint NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket" ADD COLUMN "subject_read_fence" bigint NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket" ADD COLUMN "subject_edit_fence" bigint NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket_grant" ADD COLUMN "subject_field_read_fence" bigint NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket_grant" ADD COLUMN "subject_field_edit_fence" bigint NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session" ADD COLUMN "effective_mode" smallint NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session" ADD COLUMN "subject_read_fence" bigint NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session" ADD COLUMN "subject_edit_fence" bigint NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session_grant" ADD COLUMN "subject_field_read_fence" bigint NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session_grant" ADD COLUMN "subject_field_edit_fence" bigint NOT NULL;`,
		);
		await db.execute(sql`DROP INDEX "uq_crdt_ticket_session_identity";`);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_ticket_session_identity" ON "questpie_crdt_ticket" ("id","resource_id","resource_epoch_id","schema_id","subject_id","credential_fingerprint","requested_mode","effective_mode","session_generation","resource_read_fence","resource_edit_fence","subject_read_fence","subject_edit_fence");`,
		);
		await db.execute(sql`DROP INDEX "uq_crdt_ticket_grant_exact";`);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_ticket_grant_exact" ON "questpie_crdt_ticket_grant" ("ticket_id","resource_id","schema_id","binding_id","stable_field_id","field_epoch","field_slot","format_version","grant","head_field_cursor","field_read_fence","field_edit_fence","subject_field_read_fence","subject_field_edit_fence");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_resource_incarnation_key" ON "questpie_crdt_resource" ("incarnation_key");`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session" DROP CONSTRAINT IF EXISTS "fk_crdt_session_ticket", ADD CONSTRAINT "fk_crdt_session_ticket" FOREIGN KEY ("ticket_id","resource_id","resource_epoch_id","schema_id","subject_id","credential_fingerprint","requested_mode","effective_mode","generation","resource_read_fence","resource_edit_fence","subject_read_fence","subject_edit_fence") REFERENCES "questpie_crdt_ticket"("id","resource_id","resource_epoch_id","schema_id","subject_id","credential_fingerprint","requested_mode","effective_mode","session_generation","resource_read_fence","resource_edit_fence","subject_read_fence","subject_edit_fence") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session_grant" DROP CONSTRAINT IF EXISTS "fk_crdt_session_grant_ticket_grant", ADD CONSTRAINT "fk_crdt_session_grant_ticket_grant" FOREIGN KEY ("ticket_id","resource_id","schema_id","binding_id","stable_field_id","field_epoch","field_slot","format_version","grant","head_field_cursor","field_read_fence","field_edit_fence","subject_field_read_fence","subject_field_edit_fence") REFERENCES "questpie_crdt_ticket_grant"("ticket_id","resource_id","schema_id","binding_id","stable_field_id","field_epoch","field_slot","format_version","grant","head_field_cursor","field_read_fence","field_edit_fence","subject_field_read_fence","subject_field_edit_fence") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket" ADD CONSTRAINT "ck_crdt_ticket_audience_origin" CHECK (octet_length("audience") BETWEEN 1 AND 255 AND ("origin" IS NULL OR octet_length("origin") BETWEEN 1 AND 2048));`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket" DROP CONSTRAINT IF EXISTS "ck_crdt_ticket_mode_protocol", ADD CONSTRAINT "ck_crdt_ticket_mode_protocol" CHECK ("requested_mode" IN (1, 2) AND "effective_mode" IN (1, 2) AND "effective_mode" <= "requested_mode" AND "protocol_major" = 1 AND "protocol_minor" = 0);`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session" DROP CONSTRAINT IF EXISTS "ck_crdt_session_values", ADD CONSTRAINT "ck_crdt_session_values" CHECK ("requested_mode" IN (1, 2) AND "effective_mode" IN (1, 2) AND "effective_mode" <= "requested_mode" AND "generation" >= 0 AND "last_seen_commit_seq" >= 0 AND octet_length("credential_fingerprint") = 32 AND "update_tokens" >= 0 AND "update_byte_tokens" >= 0 AND "awareness_tokens" >= 0);`,
		);
	},
	async down({ db }) {
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket" DROP CONSTRAINT IF EXISTS "ck_crdt_ticket_audience_origin";`,
		);
		await db.execute(sql`DROP INDEX "uq_crdt_resource_incarnation_key";`);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource" DROP COLUMN "incarnation_key";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource" DROP COLUMN "session_generation";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket" DROP COLUMN "effective_mode";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket" DROP COLUMN "subject_read_fence";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket" DROP COLUMN "subject_edit_fence";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket_grant" DROP COLUMN "subject_field_read_fence";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket_grant" DROP COLUMN "subject_field_edit_fence";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session" DROP COLUMN "effective_mode";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session" DROP COLUMN "subject_read_fence";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session" DROP COLUMN "subject_edit_fence";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session_grant" DROP COLUMN "subject_field_read_fence";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session_grant" DROP COLUMN "subject_field_edit_fence";`,
		);
		await db.execute(sql`DROP INDEX "uq_crdt_ticket_session_identity";`);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_ticket_session_identity" ON "questpie_crdt_ticket" ("id","resource_id","resource_epoch_id","schema_id","subject_id","credential_fingerprint","requested_mode","session_generation","resource_read_fence","resource_edit_fence");`,
		);
		await db.execute(sql`DROP INDEX "uq_crdt_ticket_grant_exact";`);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_ticket_grant_exact" ON "questpie_crdt_ticket_grant" ("ticket_id","resource_id","schema_id","binding_id","stable_field_id","field_epoch","field_slot","format_version","grant","head_field_cursor","field_read_fence","field_edit_fence");`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session" DROP CONSTRAINT IF EXISTS "fk_crdt_session_ticket", ADD CONSTRAINT "fk_crdt_session_ticket" FOREIGN KEY ("ticket_id","resource_id","resource_epoch_id","schema_id","subject_id","credential_fingerprint","requested_mode","generation","resource_read_fence","resource_edit_fence") REFERENCES "questpie_crdt_ticket"("id","resource_id","resource_epoch_id","schema_id","subject_id","credential_fingerprint","requested_mode","session_generation","resource_read_fence","resource_edit_fence") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session_grant" DROP CONSTRAINT IF EXISTS "fk_crdt_session_grant_ticket_grant", ADD CONSTRAINT "fk_crdt_session_grant_ticket_grant" FOREIGN KEY ("ticket_id","resource_id","schema_id","binding_id","stable_field_id","field_epoch","field_slot","format_version","grant","head_field_cursor","field_read_fence","field_edit_fence") REFERENCES "questpie_crdt_ticket_grant"("ticket_id","resource_id","schema_id","binding_id","stable_field_id","field_epoch","field_slot","format_version","grant","head_field_cursor","field_read_fence","field_edit_fence") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket" ADD CONSTRAINT "ck_crdt_ticket_state" CHECK ("released_at" IS NULL OR "redeemed_at" IS NOT NULL);`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_ticket" DROP CONSTRAINT IF EXISTS "ck_crdt_ticket_mode_protocol", ADD CONSTRAINT "ck_crdt_ticket_mode_protocol" CHECK ("requested_mode" IN (1, 2) AND "protocol_major" = 1 AND "protocol_minor" = 0);`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session" DROP CONSTRAINT IF EXISTS "ck_crdt_session_values", ADD CONSTRAINT "ck_crdt_session_values" CHECK ("requested_mode" IN (1, 2) AND "generation" >= 0 AND "last_seen_commit_seq" >= 0 AND octet_length("credential_fingerprint") = 32 AND "update_tokens" >= 0 AND "update_byte_tokens" >= 0 AND "awareness_tokens" >= 0);`,
		);
	},
	snapshot,
});
