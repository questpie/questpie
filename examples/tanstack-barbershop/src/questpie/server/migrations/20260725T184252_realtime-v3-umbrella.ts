import { sql } from "drizzle-orm";
import type { OperationSnapshot } from "questpie/migration";
import { migration } from "questpie/services";

import snapshotJson from "./snapshots/20260725T184252_realtime-v3-umbrella.json";

const snapshot = snapshotJson as OperationSnapshot;

export default migration({
	id: "realtimeV3Umbrella20260725T184252",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "questpie_realtime_head" (
	"id" text PRIMARY KEY,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`);
		await db.execute(sql`CREATE TABLE "questpie_channel_head" (
	"channel_hash" text PRIMARY KEY,
	"channel" text NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`);
		await db.execute(sql`CREATE TABLE "questpie_channel_event" (
	"channel_hash" text,
	"seq" bigint,
	"event_id" text NOT NULL,
	"channel" text NOT NULL,
	"event" text NOT NULL,
	"schema_identity" text NOT NULL,
	"payload" jsonb NOT NULL,
	"wire_json" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "questpie_channel_event_pkey" PRIMARY KEY("channel_hash","seq")
);`);
		await db.execute(sql`CREATE TABLE "questpie_channel_dispatch" (
	"channel_hash" text PRIMARY KEY,
	"published_seq" bigint DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`);
		await db.execute(sql`CREATE TABLE "questpie_channel_presence" (
	"channel_hash" text,
	"connection_id" text,
	"principal_id" text NOT NULL,
	"channel" text NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "questpie_channel_presence_pkey" PRIMARY KEY("channel_hash","connection_id")
);`);
		await db.execute(sql`CREATE TABLE "questpie_realtime_topology" (
	"session_key" text PRIMARY KEY,
	"owner_id" text NOT NULL,
	"owner_generation" bigserial,
	"protocol_version" integer NOT NULL,
	"token_hash" text NOT NULL,
	"identity_hash" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"desired_revision" bigint DEFAULT 0 NOT NULL,
	"applied_revision" bigint DEFAULT 0 NOT NULL,
	"desired_topology" jsonb NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_namespace" (
	"singleton" smallint PRIMARY KEY,
	"namespace" text NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_namespace_singleton" CHECK ("singleton" = 1),
	CONSTRAINT "ck_crdt_namespace_value" CHECK (octet_length("namespace") BETWEEN 1 AND 64 AND "namespace" ~ '^[!-~]+$')
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"namespace_singleton" smallint NOT NULL,
	"owner_kind" smallint NOT NULL,
	"owner_key" text NOT NULL,
	"identity_version" integer NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_definition_owner_kind" CHECK ("owner_kind" IN (1, 2)),
	CONSTRAINT "ck_crdt_definition_owner_key" CHECK (octet_length("owner_key") BETWEEN 1 AND 128 AND "owner_key" ~ '^[!-~]+$'),
	CONSTRAINT "ck_crdt_definition_identity" CHECK ("identity_version" > 0)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_schema" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"definition_id" uuid NOT NULL,
	"schema_version" bigint NOT NULL,
	"schema_fingerprint" bytea NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_schema_version" CHECK ("schema_version" BETWEEN 0 AND 4294967295),
	CONSTRAINT "ck_crdt_schema_fingerprint" CHECK (octet_length("schema_fingerprint") = 32)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_schema_field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"definition_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"stable_field_id" uuid NOT NULL,
	"field_slot" integer NOT NULL,
	"source_path" text NOT NULL,
	"format" smallint NOT NULL,
	"format_version" integer NOT NULL,
	"codec_fingerprint" bytea NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_schema_field_slot" CHECK ("field_slot" BETWEEN 1 AND 65535),
	CONSTRAINT "ck_crdt_schema_field_format" CHECK ("format" IN (1, 2)),
	CONSTRAINT "ck_crdt_schema_field_version" CHECK ("format_version" BETWEEN 0 AND 65535),
	CONSTRAINT "ck_crdt_schema_field_path" CHECK (octet_length("source_path") BETWEEN 1 AND 256),
	CONSTRAINT "ck_crdt_schema_field_codec" CHECK (octet_length("codec_fingerprint") = 32)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_subject" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" smallint NOT NULL,
	"issuer_key" text DEFAULT '' NOT NULL,
	"subject_key" text NOT NULL,
	"subject_hash" bytea NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_subject_kind" CHECK ("kind" IN (1, 2)),
	CONSTRAINT "ck_crdt_subject_issuer" CHECK (("kind" = 1 AND "issuer_key" = '') OR ("kind" = 2 AND octet_length("issuer_key") BETWEEN 1 AND 512)),
	CONSTRAINT "ck_crdt_subject_key" CHECK (octet_length("subject_key") BETWEEN 1 AND 512),
	CONSTRAINT "ck_crdt_subject_hash" CHECK (octet_length("subject_hash") = 32)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_resource" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"incarnation_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"locator" text NOT NULL,
	"locator_hash" bytea NOT NULL,
	"identity_version" integer NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"current_epoch_id" uuid,
	"current_epoch_status" smallint,
	"read_fence" bigint DEFAULT 0 NOT NULL,
	"edit_fence" bigint DEFAULT 0 NOT NULL,
	"owner_policy_revision" bigint DEFAULT 0 NOT NULL,
	"session_generation" bigint DEFAULT 0 NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_resource_locator" CHECK (octet_length("locator") BETWEEN 1 AND 4096 AND octet_length("locator_hash") = 32),
	CONSTRAINT "ck_crdt_resource_status" CHECK ("status" IN (1, 2, 3)),
	CONSTRAINT "ck_crdt_resource_retirement" CHECK (("status" = 1 AND "retired_at" IS NULL AND "current_epoch_id" IS NOT NULL AND "current_epoch_status" = 1) OR ("status" = 2 AND "retired_at" IS NOT NULL AND (("current_epoch_id" IS NULL AND "current_epoch_status" IS NULL) OR ("current_epoch_id" IS NOT NULL AND "current_epoch_status" = 2))) OR ("status" = 3 AND "retired_at" IS NULL AND (("current_epoch_id" IS NULL AND "current_epoch_status" IS NULL) OR ("current_epoch_id" IS NOT NULL AND "current_epoch_status" = 1)))),
	CONSTRAINT "ck_crdt_resource_fences" CHECK ("read_fence" >= 0 AND "edit_fence" >= 0 AND "owner_policy_revision" >= 0 AND "session_generation" >= 0)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_resource_epoch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"resource_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"aggregate_epoch" bigint NOT NULL,
	"schema_id" uuid NOT NULL,
	"head_commit_seq" bigint DEFAULT 0 NOT NULL,
	"projected_commit_seq" bigint DEFAULT 0 NOT NULL,
	"update_bytes" bigint DEFAULT 0 NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"current_snapshot_manifest_id" uuid,
	"current_snapshot_status" smallint,
	"previous_snapshot_manifest_id" uuid,
	"previous_snapshot_status" smallint,
	"closed_at" timestamp with time zone,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_resource_epoch_counters" CHECK ("aggregate_epoch" >= 0 AND "head_commit_seq" >= 0 AND "projected_commit_seq" BETWEEN 0 AND "head_commit_seq" AND "update_bytes" >= 0),
	CONSTRAINT "ck_crdt_resource_epoch_status" CHECK (("status" = 1 AND "closed_at" IS NULL) OR ("status" = 2 AND "closed_at" IS NOT NULL)),
	CONSTRAINT "ck_crdt_resource_epoch_snapshots" CHECK ((("current_snapshot_manifest_id" IS NULL AND "current_snapshot_status" IS NULL) OR ("current_snapshot_manifest_id" IS NOT NULL AND "current_snapshot_status" = 2)) AND (("previous_snapshot_manifest_id" IS NULL AND "previous_snapshot_status" IS NULL) OR ("previous_snapshot_manifest_id" IS NOT NULL AND "previous_snapshot_status" = 2)) AND ("current_snapshot_manifest_id" IS NULL OR "previous_snapshot_manifest_id" IS NULL OR "current_snapshot_manifest_id" <> "previous_snapshot_manifest_id"))
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_binding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"resource_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"schema_field_id" uuid NOT NULL,
	"stable_field_id" uuid NOT NULL,
	"field_slot" integer NOT NULL,
	"source_path" text NOT NULL,
	"format" smallint NOT NULL,
	"format_version" integer NOT NULL,
	"field_epoch" bigint NOT NULL,
	"head_field_cursor" bigint DEFAULT 0 NOT NULL,
	"projected_field_cursor" bigint DEFAULT 0 NOT NULL,
	"read_fence" bigint DEFAULT 0 NOT NULL,
	"edit_fence" bigint DEFAULT 0 NOT NULL,
	"canonical_hash" bytea NOT NULL,
	"canonical_revision" bigint DEFAULT 0 NOT NULL,
	"projected_canonical_hash" bytea NOT NULL,
	"projected_canonical_revision" bigint DEFAULT 0 NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"state_bytes" bigint DEFAULT 0 NOT NULL,
	"element_count" bigint DEFAULT 0 NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_binding_identity" CHECK ("field_slot" BETWEEN 1 AND 65535 AND "format" IN (1, 2) AND "format_version" BETWEEN 0 AND 65535 AND octet_length("source_path") BETWEEN 1 AND 256),
	CONSTRAINT "ck_crdt_binding_counters" CHECK ("field_epoch" >= 0 AND "head_field_cursor" >= 0 AND "projected_field_cursor" BETWEEN 0 AND "head_field_cursor" AND "read_fence" >= 0 AND "edit_fence" >= 0 AND "canonical_revision" >= 0 AND "projected_canonical_revision" >= 0 AND "state_bytes" >= 0 AND "element_count" >= 0),
	CONSTRAINT "ck_crdt_binding_hashes" CHECK (octet_length("canonical_hash") = 32 AND octet_length("projected_canonical_hash") = 32),
	CONSTRAINT "ck_crdt_binding_status" CHECK (("status" = 2 AND "retired_at" IS NOT NULL) OR ("status" IN (1, 3) AND "retired_at" IS NULL))
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_commit" (
	"resource_id" uuid,
	"resource_epoch_id" uuid,
	"definition_id" uuid NOT NULL,
	"commit_seq" bigint,
	"kind" smallint NOT NULL,
	"schema_id" uuid NOT NULL,
	"canonical_bundle_hash" bytea NOT NULL,
	"delivery_commit_id" uuid NOT NULL,
	"subject_id" uuid,
	"session_id" uuid,
	"control_payload" jsonb,
	"committed_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "questpie_crdt_commit_pkey" PRIMARY KEY("resource_id","resource_epoch_id","commit_seq"),
	CONSTRAINT "ck_crdt_commit_seq" CHECK ("commit_seq" > 0),
	CONSTRAINT "ck_crdt_commit_kind" CHECK ("kind" IN (1, 2, 3, 4)),
	CONSTRAINT "ck_crdt_commit_hash" CHECK (octet_length("canonical_bundle_hash") = 32),
	CONSTRAINT "ck_crdt_commit_session_subject" CHECK ("session_id" IS NULL OR "subject_id" IS NOT NULL),
	CONSTRAINT "ck_crdt_commit_kind_payload" CHECK (("kind" = 1 AND "subject_id" IS NOT NULL AND "session_id" IS NOT NULL AND "control_payload" IS NULL) OR ("kind" IN (2, 3, 4) AND "session_id" IS NULL AND "control_payload" IS NOT NULL))
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_schema_compatibility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"resource_id" uuid NOT NULL,
	"resource_epoch_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"source_schema_id" uuid NOT NULL,
	"target_schema_id" uuid NOT NULL,
	"manifest_commit_seq" bigint NOT NULL,
	"manifest_commit_kind" smallint DEFAULT 4 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_compatibility_schemas" CHECK ("source_schema_id" <> "target_schema_id"),
	CONSTRAINT "ck_crdt_compatibility_commit_kind" CHECK ("manifest_commit_kind" = 4)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_schema_compatibility_field" (
	"compatibility_id" uuid,
	"resource_id" uuid NOT NULL,
	"source_schema_id" uuid NOT NULL,
	"source_schema_field_id" uuid,
	"source_binding_id" uuid NOT NULL,
	"source_field_epoch" bigint NOT NULL,
	"source_field_slot" integer NOT NULL,
	"source_format_version" integer NOT NULL,
	"target_schema_id" uuid NOT NULL,
	"target_schema_field_id" uuid NOT NULL,
	"target_binding_id" uuid NOT NULL,
	"target_field_epoch" bigint NOT NULL,
	"target_field_slot" integer NOT NULL,
	"target_format_version" integer NOT NULL,
	CONSTRAINT "questpie_crdt_schema_compatibility_field_pkey" PRIMARY KEY("compatibility_id","source_schema_field_id"),
	CONSTRAINT "ck_crdt_compat_field_slots" CHECK ("source_field_slot" BETWEEN 1 AND 65535 AND "target_field_slot" BETWEEN 1 AND 65535 AND "source_format_version" BETWEEN 0 AND 65535 AND "target_format_version" BETWEEN 0 AND 65535)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_update" (
	"resource_id" uuid,
	"resource_epoch_id" uuid,
	"commit_seq" bigint,
	"commit_kind" smallint DEFAULT 1 NOT NULL,
	"schema_id" uuid NOT NULL,
	"field_slot" integer,
	"binding_id" uuid NOT NULL,
	"stable_field_id" uuid NOT NULL,
	"field_epoch" bigint NOT NULL,
	"format_version" integer NOT NULL,
	"base_field_cursor" bigint NOT NULL,
	"field_cursor" bigint NOT NULL,
	"bytes" bytea NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum" bytea NOT NULL,
	CONSTRAINT "questpie_crdt_update_pkey" PRIMARY KEY("resource_id","resource_epoch_id","commit_seq","field_slot"),
	CONSTRAINT "ck_crdt_update_identity" CHECK ("field_slot" BETWEEN 1 AND 65535 AND "format_version" BETWEEN 0 AND 65535 AND "commit_seq" > 0 AND "commit_kind" = 1 AND "field_epoch" >= 0),
	CONSTRAINT "ck_crdt_update_cursor" CHECK ("base_field_cursor" >= 0 AND "field_cursor" = "base_field_cursor" + 1),
	CONSTRAINT "ck_crdt_update_bytes" CHECK ("size_bytes" BETWEEN 1 AND 262144 AND octet_length("bytes") = "size_bytes" AND octet_length("checksum") = 32)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_update_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"resource_id" uuid NOT NULL,
	"resource_epoch_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"update_id" uuid NOT NULL,
	"commit_seq" bigint NOT NULL,
	"commit_kind" smallint DEFAULT 1 NOT NULL,
	"submitted_schema_id" uuid NOT NULL,
	"submitted_schema_version" bigint NOT NULL,
	"submitted_bundle_hash" bytea NOT NULL,
	"normalized_schema_id" uuid NOT NULL,
	"normalized_commit_hash" bytea NOT NULL,
	"subject_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_receipt_hashes" CHECK (octet_length("submitted_bundle_hash") = 32 AND octet_length("normalized_commit_hash") = 32),
	CONSTRAINT "ck_crdt_receipt_schema_version" CHECK ("submitted_schema_version" BETWEEN 0 AND 4294967295 AND "commit_kind" = 1)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_receipt_field" (
	"receipt_id" uuid,
	"resource_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"binding_id" uuid,
	"stable_field_id" uuid NOT NULL,
	"field_epoch" bigint NOT NULL,
	"field_slot" integer NOT NULL,
	"format_version" integer NOT NULL,
	"field_cursor" bigint NOT NULL,
	CONSTRAINT "questpie_crdt_receipt_field_pkey" PRIMARY KEY("receipt_id","binding_id"),
	CONSTRAINT "ck_crdt_receipt_field_identity" CHECK ("field_slot" BETWEEN 1 AND 65535 AND "format_version" BETWEEN 0 AND 65535 AND "field_cursor" > 0)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_snapshot_manifest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"resource_id" uuid NOT NULL,
	"resource_epoch_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"covers_commit_seq" bigint NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"total_bytes" integer NOT NULL,
	"field_count" integer NOT NULL,
	"checksum" bytea NOT NULL,
	"lease_generation" bigint NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_manifest_bounds" CHECK ("covers_commit_seq" >= 0 AND "total_bytes" BETWEEN 0 AND 33554432 AND "field_count" BETWEEN 1 AND 32 AND "lease_generation" >= 0),
	CONSTRAINT "ck_crdt_manifest_status" CHECK (("status" = 1 AND "verified_at" IS NULL) OR ("status" = 2 AND "verified_at" IS NOT NULL)),
	CONSTRAINT "ck_crdt_manifest_checksum" CHECK (octet_length("checksum") = 32)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_snapshot" (
	"manifest_id" uuid,
	"resource_id" uuid NOT NULL,
	"resource_epoch_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"binding_id" uuid,
	"stable_field_id" uuid NOT NULL,
	"field_epoch" bigint NOT NULL,
	"field_slot" integer NOT NULL,
	"format_version" integer NOT NULL,
	"field_cursor" bigint NOT NULL,
	"engine_id" text NOT NULL,
	"engine_version" integer NOT NULL,
	"state_version" integer NOT NULL,
	"bytes" bytea NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum" bytea NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "questpie_crdt_snapshot_pkey" PRIMARY KEY("manifest_id","binding_id"),
	CONSTRAINT "ck_crdt_snapshot_versions" CHECK ("field_slot" BETWEEN 1 AND 65535 AND "format_version" BETWEEN 0 AND 65535 AND "engine_version" BETWEEN 0 AND 65535 AND "state_version" BETWEEN 0 AND 65535 AND "field_cursor" >= 0),
	CONSTRAINT "ck_crdt_snapshot_bytes" CHECK ("size_bytes" BETWEEN 0 AND 25165824 AND octet_length("bytes") = "size_bytes" AND octet_length("checksum") = 32)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_recovery_hold" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"resource_id" uuid NOT NULL,
	"resource_epoch_id" uuid NOT NULL,
	"binding_id" uuid,
	"binding_field_epoch" bigint,
	"binding_field_slot" integer,
	"binding_format_version" integer,
	"subject_id" uuid NOT NULL,
	"reason" smallint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_recovery_hold_reason" CHECK ("reason" BETWEEN 1 AND 8),
	CONSTRAINT "ck_crdt_recovery_hold_binding_identity" CHECK (("binding_id" IS NULL AND "binding_field_epoch" IS NULL AND "binding_field_slot" IS NULL AND "binding_format_version" IS NULL) OR ("binding_id" IS NOT NULL AND "binding_field_epoch" >= 0 AND "binding_field_slot" BETWEEN 1 AND 65535 AND "binding_format_version" BETWEEN 0 AND 65535))
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_subject_fence" (
	"resource_id" uuid,
	"subject_id" uuid,
	"scope_kind" smallint,
	"stable_field_id" uuid,
	"read_fence" bigint DEFAULT 0 NOT NULL,
	"edit_fence" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "questpie_crdt_subject_fence_pkey" PRIMARY KEY("resource_id","subject_id","scope_kind","stable_field_id"),
	CONSTRAINT "ck_crdt_subject_fence_scope" CHECK ("scope_kind" IN (1, 2)),
	CONSTRAINT "ck_crdt_subject_fence_sentinel" CHECK (("scope_kind" = 1 AND "stable_field_id" = '00000000-0000-0000-0000-000000000000'::uuid) OR ("scope_kind" = 2 AND "stable_field_id" <> '00000000-0000-0000-0000-000000000000'::uuid)),
	CONSTRAINT "ck_crdt_subject_fence_values" CHECK ("read_fence" >= 0 AND "edit_fence" >= 0)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_subject_admission" (
	"subject_id" uuid PRIMARY KEY,
	"open_tokens" bigint DEFAULT 0 NOT NULL,
	"open_refilled_at" timestamp(3) DEFAULT now() NOT NULL,
	"pull_byte_tokens" bigint DEFAULT 136314880 NOT NULL,
	"pull_bytes_refilled_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_subject_admission_tokens" CHECK ("open_tokens" >= 0 AND "pull_byte_tokens" >= 0)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_credential_admission" (
	"credential_fingerprint" bytea PRIMARY KEY,
	"open_tokens" bigint DEFAULT 0 NOT NULL,
	"open_refilled_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_credential_admission_identity" CHECK (octet_length("credential_fingerprint") = 32),
	CONSTRAINT "ck_crdt_credential_admission_tokens" CHECK ("open_tokens" >= 0)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_resource_admission" (
	"resource_id" uuid PRIMARY KEY,
	"part_tokens" bigint DEFAULT 0 NOT NULL,
	"part_refilled_at" timestamp(3) DEFAULT now() NOT NULL,
	"head_updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_resource_admission_tokens" CHECK ("part_tokens" >= 0)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"open_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"binding_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"actor_kind" smallint DEFAULT 1 NOT NULL,
	"resource_id" uuid NOT NULL,
	"resource_incarnation_key" uuid NOT NULL,
	"resource_epoch_id" uuid NOT NULL,
	"aggregate_epoch" bigint NOT NULL,
	"schema_id" uuid NOT NULL,
	"schema_version" bigint NOT NULL,
	"open_result_fingerprint" bytea,
	"subject_id" uuid NOT NULL,
	"credential_fingerprint" bytea NOT NULL,
	"edge_session_key" bytea,
	"edge_owner_generation" bigint NOT NULL,
	"delivery_generation" bigint NOT NULL,
	"requested_mode" smallint NOT NULL,
	"effective_mode" smallint NOT NULL,
	"generation" bigint NOT NULL,
	"resource_read_fence" bigint NOT NULL,
	"resource_edit_fence" bigint NOT NULL,
	"owner_policy_revision" bigint NOT NULL,
	"subject_read_fence" bigint NOT NULL,
	"subject_edit_fence" bigint NOT NULL,
	"authority_expires_at" timestamp with time zone NOT NULL,
	"last_seen_commit_seq" bigint NOT NULL,
	"update_tokens" bigint DEFAULT 0 NOT NULL,
	"update_refilled_at" timestamp(3) DEFAULT now() NOT NULL,
	"update_byte_tokens" bigint DEFAULT 0 NOT NULL,
	"update_bytes_refilled_at" timestamp(3) DEFAULT now() NOT NULL,
	"awareness_tokens" bigint DEFAULT 0 NOT NULL,
	"awareness_refilled_at" timestamp(3) DEFAULT now() NOT NULL,
	"roster_tokens" bigint DEFAULT 20 NOT NULL,
	"roster_refilled_at" timestamp(3) DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"close_reason" smallint,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_session_values" CHECK ("actor_kind" IN (1, 2, 3) AND "requested_mode" IN (1, 2) AND "effective_mode" IN (1, 2) AND "effective_mode" <= "requested_mode" AND "generation" >= 0 AND "aggregate_epoch" >= 0 AND "schema_version" BETWEEN 0 AND 4294967295 AND ("open_result_fingerprint" IS NULL OR octet_length("open_result_fingerprint") = 32) AND "edge_owner_generation" >= 0 AND "delivery_generation" >= 0 AND "last_seen_commit_seq" >= 0 AND octet_length("credential_fingerprint") = 32 AND ("edge_session_key" IS NULL OR octet_length("edge_session_key") = 32) AND "update_tokens" >= 0 AND "update_byte_tokens" >= 0 AND "awareness_tokens" >= 0 AND "roster_tokens" >= 0),
	CONSTRAINT "ck_crdt_session_closed" CHECK (("closed_at" IS NULL AND "close_reason" IS NULL) OR ("closed_at" IS NOT NULL AND "close_reason" IS NOT NULL)),
	CONSTRAINT "ck_crdt_session_authority_expiry" CHECK ("lease_expires_at" <= "authority_expires_at")
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_session_grant" (
	"session_id" uuid,
	"resource_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"binding_id" uuid,
	"stable_field_id" uuid NOT NULL,
	"field_epoch" bigint NOT NULL,
	"field_slot" integer NOT NULL,
	"format_version" integer NOT NULL,
	"grant" smallint NOT NULL,
	"head_field_cursor" bigint NOT NULL,
	"field_read_fence" bigint NOT NULL,
	"field_edit_fence" bigint NOT NULL,
	"subject_field_read_fence" bigint NOT NULL,
	"subject_field_edit_fence" bigint NOT NULL,
	CONSTRAINT "questpie_crdt_session_grant_pkey" PRIMARY KEY("session_id","binding_id"),
	CONSTRAINT "ck_crdt_session_grant_values" CHECK ("field_slot" BETWEEN 1 AND 65535 AND "format_version" BETWEEN 0 AND 65535 AND "grant" IN (0, 1))
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_pull" (
	"id" uuid PRIMARY KEY,
	"session_id" uuid NOT NULL,
	"binding_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"resource_incarnation_key" uuid NOT NULL,
	"resource_epoch_id" uuid NOT NULL,
	"aggregate_epoch" bigint NOT NULL,
	"target_commit_seq" bigint NOT NULL,
	"schema_id" uuid NOT NULL,
	"schema_version" bigint NOT NULL,
	"subject_id" uuid NOT NULL,
	"credential_fingerprint" bytea NOT NULL,
	"session_generation" bigint NOT NULL,
	"delivery_generation" bigint NOT NULL,
	"resource_read_fence" bigint NOT NULL,
	"resource_edit_fence" bigint NOT NULL,
	"owner_policy_revision" bigint NOT NULL,
	"subject_read_fence" bigint NOT NULL,
	"subject_edit_fence" bigint NOT NULL,
	"grant_fingerprint" bytea NOT NULL,
	"request_fingerprint" bytea NOT NULL,
	"continuation_claim_fingerprint" bytea NOT NULL,
	"artifact_fingerprint" bytea,
	"current_snapshot_manifest_id" uuid,
	"previous_snapshot_manifest_id" uuid,
	"state" smallint DEFAULT 1 NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"total_bytes" integer DEFAULT 0 NOT NULL,
	"retained_bytes" integer DEFAULT 0 NOT NULL,
	"active_expires_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_pull_values" CHECK ("aggregate_epoch" >= 0 AND "target_commit_seq" >= 0 AND "schema_version" BETWEEN 0 AND 4294967295 AND "session_generation" >= 0 AND "delivery_generation" >= 0 AND "resource_read_fence" >= 0 AND "resource_edit_fence" >= 0 AND "owner_policy_revision" >= 0 AND "subject_read_fence" >= 0 AND "subject_edit_fence" >= 0 AND octet_length("credential_fingerprint") = 32 AND octet_length("grant_fingerprint") = 32 AND octet_length("request_fingerprint") = 32 AND octet_length("continuation_claim_fingerprint") = 32 AND ("artifact_fingerprint" IS NULL OR octet_length("artifact_fingerprint") = 32) AND "page_count" BETWEEN 0 AND 65535 AND "total_bytes" BETWEEN 0 AND 67108864 AND "retained_bytes" BETWEEN 0 AND 68157440 AND "active_expires_at" <= "expires_at"),
	CONSTRAINT "ck_crdt_pull_state" CHECK (("state" = 1 AND "artifact_fingerprint" IS NULL AND "page_count" = 0 AND "total_bytes" = 0 AND "completed_at" IS NULL) OR ("state" = 2 AND "artifact_fingerprint" IS NOT NULL AND "page_count" > 0 AND "completed_at" IS NULL) OR ("state" IN (3, 4) AND "artifact_fingerprint" IS NOT NULL AND "page_count" > 0 AND "completed_at" IS NOT NULL))
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_pull_field" (
	"pull_id" uuid,
	"binding_id" uuid NOT NULL,
	"field_slot" integer,
	"grant" smallint NOT NULL,
	"field_epoch" bigint NOT NULL,
	"format_version" integer NOT NULL,
	"field_cursor" bigint NOT NULL,
	"read_fence" bigint NOT NULL,
	"edit_fence" bigint NOT NULL,
	"proof" bytea NOT NULL,
	"proof_size_bytes" integer NOT NULL,
	CONSTRAINT "questpie_crdt_pull_field_pkey" PRIMARY KEY("pull_id","field_slot"),
	CONSTRAINT "ck_crdt_pull_field_values" CHECK ("field_slot" BETWEEN 1 AND 65535 AND "grant" IN (0, 1) AND "field_epoch" >= 0 AND "format_version" BETWEEN 0 AND 65535 AND "field_cursor" >= 0 AND "read_fence" >= 0 AND "edit_fence" >= 0 AND "proof_size_bytes" BETWEEN 0 AND 65536 AND octet_length("proof") = "proof_size_bytes")
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_pull_page" (
	"pull_id" uuid,
	"page_index" integer,
	"payload" bytea NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum" bytea NOT NULL,
	"final" smallint NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "questpie_crdt_pull_page_pkey" PRIMARY KEY("pull_id","page_index"),
	CONSTRAINT "ck_crdt_pull_page_values" CHECK ("page_index" BETWEEN 0 AND 65534 AND "size_bytes" BETWEEN 1 AND 1048576 AND octet_length("payload") = "size_bytes" AND "final" IN (0, 1))
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_awareness" (
	"session_id" uuid PRIMARY KEY,
	"resource_id" uuid NOT NULL,
	"active_stable_field_id" uuid,
	"value" jsonb NOT NULL,
	"size_bytes" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_awareness_size" CHECK ("size_bytes" BETWEEN 0 AND 1024)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"resource_id" uuid NOT NULL,
	"resource_epoch_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"target_commit_seq" bigint NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_generation" bigint NOT NULL,
	"last_error_code" smallint,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "ck_crdt_projection_values" CHECK ("target_commit_seq" > 0 AND "status" IN (1, 2, 3, 4, 5) AND "attempts" >= 0 AND "lease_generation" >= 0)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_projection_field" (
	"projection_id" uuid,
	"resource_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"binding_id" uuid,
	"stable_field_id" uuid NOT NULL,
	"field_epoch" bigint NOT NULL,
	"field_slot" integer NOT NULL,
	"format_version" integer NOT NULL,
	"target_field_cursor" bigint NOT NULL,
	"expected_canonical_hash" bytea NOT NULL,
	"expected_canonical_revision" bigint NOT NULL,
	"should_write" smallint NOT NULL,
	CONSTRAINT "questpie_crdt_projection_field_pkey" PRIMARY KEY("projection_id","binding_id"),
	CONSTRAINT "ck_crdt_projection_field_values" CHECK ("field_slot" BETWEEN 1 AND 65535 AND "format_version" BETWEEN 0 AND 65535 AND "target_field_cursor" >= 0 AND "expected_canonical_revision" >= 0 AND "should_write" IN (0, 1) AND octet_length("expected_canonical_hash") = 32)
);`);
		await db.execute(sql`CREATE TABLE "questpie_crdt_lease" (
	"resource_id" uuid,
	"kind" smallint,
	"owner_id" text NOT NULL,
	"generation" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "questpie_crdt_lease_pkey" PRIMARY KEY("resource_id","kind"),
	CONSTRAINT "ck_crdt_lease_kind" CHECK ("kind" IN (1, 2, 3)),
	CONSTRAINT "ck_crdt_lease_values" CHECK ("generation" >= 0 AND octet_length("owner_id") BETWEEN 1 AND 256)
);`);
		await db.execute(sql`CREATE TABLE "questpie_storage_cleanup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"leased_until" timestamp with time zone,
	"lease_token" uuid,
	"last_error" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL
);`);
		await db.execute(sql`CREATE TABLE "questpie_storage_object_key" (
	"key" text PRIMARY KEY,
	"created_at" timestamp(3) DEFAULT now() NOT NULL
);`);
		await db.execute(sql`DROP INDEX "idx_realtime_log_seq";`);
		await db.execute(sql`DROP INDEX "idx_realtime_log_resource";`);
		await db.execute(
			sql`ALTER TABLE "questpie_realtime_log" ADD COLUMN "txid" xid8 DEFAULT pg_current_xact_id();`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_channel_event_event_id" ON "questpie_channel_event" ("event_id");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_channel_event_created_at" ON "questpie_channel_event" ("created_at");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_channel_presence_channel" ON "questpie_channel_presence" ("channel_hash");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_channel_presence_expiry" ON "questpie_channel_presence" ("expires_at");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_realtime_topology_owner_lease" ON "questpie_realtime_topology" ("owner_id","lease_expires_at");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_realtime_topology_lease" ON "questpie_realtime_topology" ("lease_expires_at");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_namespace_value" ON "questpie_crdt_namespace" ("namespace");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_definition_owner" ON "questpie_crdt_definition" ("namespace_singleton","owner_kind","owner_key");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_schema_definition_id" ON "questpie_crdt_schema" ("definition_id","id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_schema_id_version" ON "questpie_crdt_schema" ("id","schema_version");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_schema_exact_version" ON "questpie_crdt_schema" ("definition_id","id","schema_version");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_schema_version" ON "questpie_crdt_schema" ("definition_id","schema_version");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_schema_fingerprint" ON "questpie_crdt_schema" ("definition_id","schema_fingerprint");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_schema_field_schema_id" ON "questpie_crdt_schema_field" ("schema_id","id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_schema_field_exact" ON "questpie_crdt_schema_field" ("definition_id","schema_id","id","stable_field_id","field_slot","source_path","format","format_version");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_schema_field_slot" ON "questpie_crdt_schema_field" ("schema_id","field_slot");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_schema_field_path" ON "questpie_crdt_schema_field" ("schema_id","source_path");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_schema_field_stable" ON "questpie_crdt_schema_field" ("schema_id","stable_field_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_subject_tuple" ON "questpie_crdt_subject" ("kind","issuer_key","subject_key");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_subject_hash" ON "questpie_crdt_subject" ("subject_hash");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_resource_definition_id" ON "questpie_crdt_resource" ("id","definition_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_resource_incarnation_key" ON "questpie_crdt_resource" ("incarnation_key");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_resource_current_locator" ON "questpie_crdt_resource" ("definition_id","locator_hash") WHERE "retired_at" IS NULL;`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_resource_locator" ON "questpie_crdt_resource" ("definition_id","locator_hash");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_resource_retired" ON "questpie_crdt_resource" ("retired_at");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_resource_epoch_resource_id" ON "questpie_crdt_resource_epoch" ("resource_id","id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_resource_epoch_number" ON "questpie_crdt_resource_epoch" ("resource_id","aggregate_epoch");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_resource_epoch_schema" ON "questpie_crdt_resource_epoch" ("resource_id","id","schema_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_resource_epoch_definition" ON "questpie_crdt_resource_epoch" ("resource_id","id","definition_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_resource_epoch_status" ON "questpie_crdt_resource_epoch" ("resource_id","id","status");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_resource_epoch_current" ON "questpie_crdt_resource_epoch" ("resource_id") WHERE "status" = 1;`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_binding_exact" ON "questpie_crdt_binding" ("resource_id","id","field_epoch","field_slot","format_version");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_binding_stable_exact" ON "questpie_crdt_binding" ("resource_id","id","stable_field_id","field_epoch","field_slot","format_version");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_binding_schema_exact" ON "questpie_crdt_binding" ("resource_id","id","schema_id","schema_field_id","field_epoch","field_slot","format_version");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_binding_grant_exact" ON "questpie_crdt_binding" ("resource_id","id","schema_id","stable_field_id","field_epoch","field_slot","format_version");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_binding_resource_id" ON "questpie_crdt_binding" ("resource_id","id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_binding_epoch" ON "questpie_crdt_binding" ("resource_id","stable_field_id","field_epoch");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_binding_current_stable" ON "questpie_crdt_binding" ("resource_id","stable_field_id") WHERE "retired_at" IS NULL;`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_binding_resource_slot" ON "questpie_crdt_binding" ("resource_id","field_slot") WHERE "retired_at" IS NULL;`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_binding_current_path" ON "questpie_crdt_binding" ("resource_id","source_path") WHERE "retired_at" IS NULL;`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_commit_delivery" ON "questpie_crdt_commit" ("resource_id","delivery_commit_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_commit_kind_identity" ON "questpie_crdt_commit" ("resource_id","resource_epoch_id","commit_seq","kind");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_commit_schema_identity" ON "questpie_crdt_commit" ("resource_id","resource_epoch_id","commit_seq","kind","schema_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_commit_projection_identity" ON "questpie_crdt_commit" ("resource_id","resource_epoch_id","commit_seq","schema_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_commit_receipt_identity" ON "questpie_crdt_commit" ("resource_id","resource_epoch_id","commit_seq","kind","schema_id","canonical_bundle_hash","subject_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_compatibility_pair" ON "questpie_crdt_schema_compatibility" ("resource_id","source_schema_id","target_schema_id","manifest_commit_seq");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_compatibility_exact" ON "questpie_crdt_schema_compatibility" ("id","resource_id","source_schema_id","target_schema_id");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_compatibility_expiry" ON "questpie_crdt_schema_compatibility" ("expires_at");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_compat_target" ON "questpie_crdt_schema_compatibility_field" ("compatibility_id","target_schema_field_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_update_field_cursor" ON "questpie_crdt_update" ("binding_id","field_epoch","field_cursor");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_receipt_update" ON "questpie_crdt_update_receipt" ("resource_id","resource_epoch_id","update_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_receipt_resource_id" ON "questpie_crdt_update_receipt" ("id","resource_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_receipt_normalized_schema" ON "questpie_crdt_update_receipt" ("id","resource_id","normalized_schema_id");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_receipt_expiry" ON "questpie_crdt_update_receipt" ("expires_at");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_manifest_resource_epoch_id" ON "questpie_crdt_snapshot_manifest" ("resource_id","resource_epoch_id","id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_manifest_schema_identity" ON "questpie_crdt_snapshot_manifest" ("resource_id","resource_epoch_id","id","schema_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_manifest_verified_identity" ON "questpie_crdt_snapshot_manifest" ("resource_id","resource_epoch_id","id","status");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_manifest_verified_cut" ON "questpie_crdt_snapshot_manifest" ("resource_id","resource_epoch_id","covers_commit_seq");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_recovery_hold_resource" ON "questpie_crdt_recovery_hold" ("resource_id","expires_at");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_recovery_hold_expiry" ON "questpie_crdt_recovery_hold" ("expires_at");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_session_binding" ON "questpie_crdt_session" ("binding_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_session_id_binding" ON "questpie_crdt_session" ("id","binding_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_session_subject_open" ON "questpie_crdt_session" ("subject_id","open_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_session_resource_id" ON "questpie_crdt_session" ("id","resource_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_session_resource_schema" ON "questpie_crdt_session" ("id","resource_id","schema_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_session_attribution" ON "questpie_crdt_session" ("id","resource_id","resource_epoch_id","subject_id");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_session_subject_lease" ON "questpie_crdt_session" ("subject_id","lease_expires_at");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_session_resource_lease" ON "questpie_crdt_session" ("resource_id","lease_expires_at");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_session_credential_lease" ON "questpie_crdt_session" ("credential_fingerprint","lease_expires_at");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_session_edge_lease" ON "questpie_crdt_session" ("edge_session_key","lease_expires_at");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_session_grant_stable" ON "questpie_crdt_session_grant" ("session_id","resource_id","stable_field_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_pull_active_binding" ON "questpie_crdt_pull" ("binding_id") WHERE "state" IN (1, 2);`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_pull_subject_expiry" ON "questpie_crdt_pull" ("subject_id","expires_at");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_pull_expiry" ON "questpie_crdt_pull" ("expires_at");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_pull_field_binding" ON "questpie_crdt_pull_field" ("pull_id","binding_id");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_awareness_expiry" ON "questpie_crdt_awareness" ("resource_id","expires_at");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_projection_target" ON "questpie_crdt_projection" ("resource_id","resource_epoch_id","target_commit_seq");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_projection_resource_id" ON "questpie_crdt_projection" ("id","resource_id","schema_id");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_crdt_projection_idempotency" ON "questpie_crdt_projection" ("idempotency_key");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_projection_due" ON "questpie_crdt_projection" ("status","due_at");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_crdt_lease_expiry" ON "questpie_crdt_lease" ("expires_at");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_storage_cleanup_available" ON "questpie_storage_cleanup" ("available_at","leased_until","created_at");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_storage_cleanup_key" ON "questpie_storage_cleanup" ("key");`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_definition" ADD CONSTRAINT "questpie_crdt_definition_NsT4P6R1txr3_fkey" FOREIGN KEY ("namespace_singleton") REFERENCES "questpie_crdt_namespace"("singleton") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema" ADD CONSTRAINT "questpie_crdt_schema_zWqqfugO73nX_fkey" FOREIGN KEY ("definition_id") REFERENCES "questpie_crdt_definition"("id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_field" ADD CONSTRAINT "fk_crdt_schema_field_schema" FOREIGN KEY ("definition_id","schema_id") REFERENCES "questpie_crdt_schema"("definition_id","id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource" ADD CONSTRAINT "questpie_crdt_resource_fN4vyGgtH5gI_fkey" FOREIGN KEY ("definition_id") REFERENCES "questpie_crdt_definition"("id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource" ADD CONSTRAINT "fk_crdt_resource_current_epoch" FOREIGN KEY ("id","current_epoch_id","current_epoch_status") REFERENCES "questpie_crdt_resource_epoch"("resource_id","id","status") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource_epoch" ADD CONSTRAINT "fk_crdt_epoch_current_manifest" FOREIGN KEY ("resource_id","id","current_snapshot_manifest_id","current_snapshot_status") REFERENCES "questpie_crdt_snapshot_manifest"("resource_id","resource_epoch_id","id","status") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource_epoch" ADD CONSTRAINT "fk_crdt_epoch_previous_manifest" FOREIGN KEY ("resource_id","id","previous_snapshot_manifest_id","previous_snapshot_status") REFERENCES "questpie_crdt_snapshot_manifest"("resource_id","resource_epoch_id","id","status") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource_epoch" ADD CONSTRAINT "fk_crdt_epoch_resource" FOREIGN KEY ("resource_id","definition_id") REFERENCES "questpie_crdt_resource"("id","definition_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource_epoch" ADD CONSTRAINT "fk_crdt_epoch_schema" FOREIGN KEY ("definition_id","schema_id") REFERENCES "questpie_crdt_schema"("definition_id","id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_binding" ADD CONSTRAINT "fk_crdt_binding_schema_field" FOREIGN KEY ("definition_id","schema_id","schema_field_id","stable_field_id","field_slot","source_path","format","format_version") REFERENCES "questpie_crdt_schema_field"("definition_id","schema_id","id","stable_field_id","field_slot","source_path","format","format_version") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_binding" ADD CONSTRAINT "fk_crdt_binding_resource" FOREIGN KEY ("resource_id","definition_id") REFERENCES "questpie_crdt_resource"("id","definition_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_commit" ADD CONSTRAINT "questpie_crdt_commit_subject_id_questpie_crdt_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "questpie_crdt_subject"("id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_commit" ADD CONSTRAINT "fk_crdt_commit_epoch" FOREIGN KEY ("resource_id","resource_epoch_id","definition_id") REFERENCES "questpie_crdt_resource_epoch"("resource_id","id","definition_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_commit" ADD CONSTRAINT "fk_crdt_commit_schema" FOREIGN KEY ("definition_id","schema_id") REFERENCES "questpie_crdt_schema"("definition_id","id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_commit" ADD CONSTRAINT "fk_crdt_commit_session" FOREIGN KEY ("session_id","resource_id","resource_epoch_id","subject_id") REFERENCES "questpie_crdt_session"("id","resource_id","resource_epoch_id","subject_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility" ADD CONSTRAINT "fk_crdt_compatibility_epoch" FOREIGN KEY ("resource_id","resource_epoch_id") REFERENCES "questpie_crdt_resource_epoch"("resource_id","id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility" ADD CONSTRAINT "fk_crdt_compatibility_resource" FOREIGN KEY ("resource_id","definition_id") REFERENCES "questpie_crdt_resource"("id","definition_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility" ADD CONSTRAINT "fk_crdt_compatibility_source_schema" FOREIGN KEY ("definition_id","source_schema_id") REFERENCES "questpie_crdt_schema"("definition_id","id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility" ADD CONSTRAINT "fk_crdt_compatibility_target_schema" FOREIGN KEY ("definition_id","target_schema_id") REFERENCES "questpie_crdt_schema"("definition_id","id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility" ADD CONSTRAINT "fk_crdt_compatibility_commit" FOREIGN KEY ("resource_id","resource_epoch_id","manifest_commit_seq","manifest_commit_kind","target_schema_id") REFERENCES "questpie_crdt_commit"("resource_id","resource_epoch_id","commit_seq","kind","schema_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility_field" ADD CONSTRAINT "fk_crdt_compat_field_parent" FOREIGN KEY ("compatibility_id","resource_id","source_schema_id","target_schema_id") REFERENCES "questpie_crdt_schema_compatibility"("id","resource_id","source_schema_id","target_schema_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility_field" ADD CONSTRAINT "fk_crdt_compat_source_binding" FOREIGN KEY ("resource_id","source_binding_id","source_schema_id","source_schema_field_id","source_field_epoch","source_field_slot","source_format_version") REFERENCES "questpie_crdt_binding"("resource_id","id","schema_id","schema_field_id","field_epoch","field_slot","format_version") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility_field" ADD CONSTRAINT "fk_crdt_compat_target_binding" FOREIGN KEY ("resource_id","target_binding_id","target_schema_id","target_schema_field_id","target_field_epoch","target_field_slot","target_format_version") REFERENCES "questpie_crdt_binding"("resource_id","id","schema_id","schema_field_id","field_epoch","field_slot","format_version") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_update" ADD CONSTRAINT "fk_crdt_update_commit" FOREIGN KEY ("resource_id","resource_epoch_id","commit_seq","commit_kind","schema_id") REFERENCES "questpie_crdt_commit"("resource_id","resource_epoch_id","commit_seq","kind","schema_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_update" ADD CONSTRAINT "fk_crdt_update_binding" FOREIGN KEY ("resource_id","binding_id","schema_id","stable_field_id","field_epoch","field_slot","format_version") REFERENCES "questpie_crdt_binding"("resource_id","id","schema_id","stable_field_id","field_epoch","field_slot","format_version") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_update_receipt" ADD CONSTRAINT "questpie_crdt_update_receipt_hbxHR6imf480_fkey" FOREIGN KEY ("subject_id") REFERENCES "questpie_crdt_subject"("id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_update_receipt" ADD CONSTRAINT "fk_crdt_receipt_resource" FOREIGN KEY ("resource_id","definition_id") REFERENCES "questpie_crdt_resource"("id","definition_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_update_receipt" ADD CONSTRAINT "fk_crdt_receipt_submitted_schema" FOREIGN KEY ("definition_id","submitted_schema_id","submitted_schema_version") REFERENCES "questpie_crdt_schema"("definition_id","id","schema_version") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_update_receipt" ADD CONSTRAINT "fk_crdt_receipt_commit" FOREIGN KEY ("resource_id","resource_epoch_id","commit_seq","commit_kind","normalized_schema_id","normalized_commit_hash","subject_id") REFERENCES "questpie_crdt_commit"("resource_id","resource_epoch_id","commit_seq","kind","schema_id","canonical_bundle_hash","subject_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_receipt_field" ADD CONSTRAINT "fk_crdt_receipt_field_parent" FOREIGN KEY ("receipt_id","resource_id","schema_id") REFERENCES "questpie_crdt_update_receipt"("id","resource_id","normalized_schema_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_receipt_field" ADD CONSTRAINT "fk_crdt_receipt_field_binding" FOREIGN KEY ("resource_id","binding_id","schema_id","stable_field_id","field_epoch","field_slot","format_version") REFERENCES "questpie_crdt_binding"("resource_id","id","schema_id","stable_field_id","field_epoch","field_slot","format_version") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_snapshot_manifest" ADD CONSTRAINT "fk_crdt_manifest_epoch" FOREIGN KEY ("resource_id","resource_epoch_id","definition_id") REFERENCES "questpie_crdt_resource_epoch"("resource_id","id","definition_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_snapshot_manifest" ADD CONSTRAINT "fk_crdt_manifest_schema" FOREIGN KEY ("definition_id","schema_id") REFERENCES "questpie_crdt_schema"("definition_id","id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_snapshot" ADD CONSTRAINT "fk_crdt_snapshot_manifest" FOREIGN KEY ("resource_id","resource_epoch_id","manifest_id","schema_id") REFERENCES "questpie_crdt_snapshot_manifest"("resource_id","resource_epoch_id","id","schema_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_snapshot" ADD CONSTRAINT "fk_crdt_snapshot_binding" FOREIGN KEY ("resource_id","binding_id","schema_id","stable_field_id","field_epoch","field_slot","format_version") REFERENCES "questpie_crdt_binding"("resource_id","id","schema_id","stable_field_id","field_epoch","field_slot","format_version") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_recovery_hold" ADD CONSTRAINT "questpie_crdt_recovery_hold_A7DnCJPaMQUP_fkey" FOREIGN KEY ("subject_id") REFERENCES "questpie_crdt_subject"("id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_recovery_hold" ADD CONSTRAINT "fk_crdt_recovery_hold_epoch" FOREIGN KEY ("resource_id","resource_epoch_id") REFERENCES "questpie_crdt_resource_epoch"("resource_id","id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_recovery_hold" ADD CONSTRAINT "fk_crdt_recovery_hold_binding" FOREIGN KEY ("resource_id","binding_id","binding_field_epoch","binding_field_slot","binding_format_version") REFERENCES "questpie_crdt_binding"("resource_id","id","field_epoch","field_slot","format_version") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_subject_fence" ADD CONSTRAINT "questpie_crdt_subject_fence_xjgpJrNs4xCW_fkey" FOREIGN KEY ("resource_id") REFERENCES "questpie_crdt_resource"("id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_subject_fence" ADD CONSTRAINT "questpie_crdt_subject_fence_sa1x9UJi3ISm_fkey" FOREIGN KEY ("subject_id") REFERENCES "questpie_crdt_subject"("id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_subject_admission" ADD CONSTRAINT "questpie_crdt_subject_admission_oXAHEzldFovO_fkey" FOREIGN KEY ("subject_id") REFERENCES "questpie_crdt_subject"("id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource_admission" ADD CONSTRAINT "questpie_crdt_resource_admission_3vf82Grc4Nek_fkey" FOREIGN KEY ("resource_id") REFERENCES "questpie_crdt_resource"("id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session" ADD CONSTRAINT "fk_crdt_session_epoch" FOREIGN KEY ("resource_id","resource_epoch_id") REFERENCES "questpie_crdt_resource_epoch"("resource_id","id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session_grant" ADD CONSTRAINT "fk_crdt_session_grant_session" FOREIGN KEY ("session_id","resource_id","schema_id") REFERENCES "questpie_crdt_session"("id","resource_id","schema_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session_grant" ADD CONSTRAINT "fk_crdt_session_grant_binding" FOREIGN KEY ("resource_id","binding_id","schema_id","stable_field_id","field_epoch","field_slot","format_version") REFERENCES "questpie_crdt_binding"("resource_id","id","schema_id","stable_field_id","field_epoch","field_slot","format_version") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_pull" ADD CONSTRAINT "questpie_crdt_pull_tnNv8QDNOPL3_fkey" FOREIGN KEY ("current_snapshot_manifest_id") REFERENCES "questpie_crdt_snapshot_manifest"("id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_pull" ADD CONSTRAINT "questpie_crdt_pull_Kh82XlcIg1fR_fkey" FOREIGN KEY ("previous_snapshot_manifest_id") REFERENCES "questpie_crdt_snapshot_manifest"("id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_pull" ADD CONSTRAINT "fk_crdt_pull_session" FOREIGN KEY ("session_id","binding_id") REFERENCES "questpie_crdt_session"("id","binding_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_pull" ADD CONSTRAINT "fk_crdt_pull_attribution" FOREIGN KEY ("session_id","resource_id","resource_epoch_id","subject_id") REFERENCES "questpie_crdt_session"("id","resource_id","resource_epoch_id","subject_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_pull_field" ADD CONSTRAINT "questpie_crdt_pull_field_pull_id_questpie_crdt_pull_id_fkey" FOREIGN KEY ("pull_id") REFERENCES "questpie_crdt_pull"("id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_pull_field" ADD CONSTRAINT "questpie_crdt_pull_field_LKMT6gR6WWsY_fkey" FOREIGN KEY ("binding_id") REFERENCES "questpie_crdt_binding"("id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_pull_page" ADD CONSTRAINT "questpie_crdt_pull_page_pull_id_questpie_crdt_pull_id_fkey" FOREIGN KEY ("pull_id") REFERENCES "questpie_crdt_pull"("id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_awareness" ADD CONSTRAINT "fk_crdt_awareness_session" FOREIGN KEY ("session_id","resource_id") REFERENCES "questpie_crdt_session"("id","resource_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_awareness" ADD CONSTRAINT "fk_crdt_awareness_active_field" FOREIGN KEY ("session_id","resource_id","active_stable_field_id") REFERENCES "questpie_crdt_session_grant"("session_id","resource_id","stable_field_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_projection" ADD CONSTRAINT "fk_crdt_projection_commit" FOREIGN KEY ("resource_id","resource_epoch_id","target_commit_seq","schema_id") REFERENCES "questpie_crdt_commit"("resource_id","resource_epoch_id","commit_seq","schema_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_projection_field" ADD CONSTRAINT "fk_crdt_projection_field_parent" FOREIGN KEY ("projection_id","resource_id","schema_id") REFERENCES "questpie_crdt_projection"("id","resource_id","schema_id") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_projection_field" ADD CONSTRAINT "fk_crdt_projection_field_binding" FOREIGN KEY ("resource_id","binding_id","schema_id","stable_field_id","field_epoch","field_slot","format_version") REFERENCES "questpie_crdt_binding"("resource_id","id","schema_id","stable_field_id","field_epoch","field_slot","format_version") ON DELETE RESTRICT;`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_lease" ADD CONSTRAINT "questpie_crdt_lease_resource_id_questpie_crdt_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "questpie_crdt_resource"("id") ON DELETE RESTRICT;`,
		);
	},
	async down({ db }) {
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_definition" DROP CONSTRAINT IF EXISTS "questpie_crdt_definition_NsT4P6R1txr3_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema" DROP CONSTRAINT IF EXISTS "questpie_crdt_schema_zWqqfugO73nX_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_field" DROP CONSTRAINT IF EXISTS "fk_crdt_schema_field_schema";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource" DROP CONSTRAINT IF EXISTS "questpie_crdt_resource_fN4vyGgtH5gI_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource" DROP CONSTRAINT IF EXISTS "fk_crdt_resource_current_epoch";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource_epoch" DROP CONSTRAINT IF EXISTS "fk_crdt_epoch_current_manifest";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource_epoch" DROP CONSTRAINT IF EXISTS "fk_crdt_epoch_previous_manifest";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource_epoch" DROP CONSTRAINT IF EXISTS "fk_crdt_epoch_resource";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource_epoch" DROP CONSTRAINT IF EXISTS "fk_crdt_epoch_schema";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_binding" DROP CONSTRAINT IF EXISTS "fk_crdt_binding_schema_field";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_binding" DROP CONSTRAINT IF EXISTS "fk_crdt_binding_resource";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_commit" DROP CONSTRAINT IF EXISTS "questpie_crdt_commit_subject_id_questpie_crdt_subject_id_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_commit" DROP CONSTRAINT IF EXISTS "fk_crdt_commit_epoch";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_commit" DROP CONSTRAINT IF EXISTS "fk_crdt_commit_schema";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_commit" DROP CONSTRAINT IF EXISTS "fk_crdt_commit_session";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility" DROP CONSTRAINT IF EXISTS "fk_crdt_compatibility_epoch";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility" DROP CONSTRAINT IF EXISTS "fk_crdt_compatibility_resource";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility" DROP CONSTRAINT IF EXISTS "fk_crdt_compatibility_source_schema";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility" DROP CONSTRAINT IF EXISTS "fk_crdt_compatibility_target_schema";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility" DROP CONSTRAINT IF EXISTS "fk_crdt_compatibility_commit";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility_field" DROP CONSTRAINT IF EXISTS "fk_crdt_compat_field_parent";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility_field" DROP CONSTRAINT IF EXISTS "fk_crdt_compat_source_binding";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_schema_compatibility_field" DROP CONSTRAINT IF EXISTS "fk_crdt_compat_target_binding";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_update" DROP CONSTRAINT IF EXISTS "fk_crdt_update_commit";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_update" DROP CONSTRAINT IF EXISTS "fk_crdt_update_binding";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_update_receipt" DROP CONSTRAINT IF EXISTS "questpie_crdt_update_receipt_hbxHR6imf480_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_update_receipt" DROP CONSTRAINT IF EXISTS "fk_crdt_receipt_resource";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_update_receipt" DROP CONSTRAINT IF EXISTS "fk_crdt_receipt_submitted_schema";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_update_receipt" DROP CONSTRAINT IF EXISTS "fk_crdt_receipt_commit";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_receipt_field" DROP CONSTRAINT IF EXISTS "fk_crdt_receipt_field_parent";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_receipt_field" DROP CONSTRAINT IF EXISTS "fk_crdt_receipt_field_binding";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_snapshot_manifest" DROP CONSTRAINT IF EXISTS "fk_crdt_manifest_epoch";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_snapshot_manifest" DROP CONSTRAINT IF EXISTS "fk_crdt_manifest_schema";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_snapshot" DROP CONSTRAINT IF EXISTS "fk_crdt_snapshot_manifest";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_snapshot" DROP CONSTRAINT IF EXISTS "fk_crdt_snapshot_binding";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_recovery_hold" DROP CONSTRAINT IF EXISTS "questpie_crdt_recovery_hold_A7DnCJPaMQUP_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_recovery_hold" DROP CONSTRAINT IF EXISTS "fk_crdt_recovery_hold_epoch";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_recovery_hold" DROP CONSTRAINT IF EXISTS "fk_crdt_recovery_hold_binding";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_subject_fence" DROP CONSTRAINT IF EXISTS "questpie_crdt_subject_fence_xjgpJrNs4xCW_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_subject_fence" DROP CONSTRAINT IF EXISTS "questpie_crdt_subject_fence_sa1x9UJi3ISm_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_subject_admission" DROP CONSTRAINT IF EXISTS "questpie_crdt_subject_admission_oXAHEzldFovO_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_resource_admission" DROP CONSTRAINT IF EXISTS "questpie_crdt_resource_admission_3vf82Grc4Nek_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session" DROP CONSTRAINT IF EXISTS "fk_crdt_session_epoch";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session_grant" DROP CONSTRAINT IF EXISTS "fk_crdt_session_grant_session";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_session_grant" DROP CONSTRAINT IF EXISTS "fk_crdt_session_grant_binding";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_pull" DROP CONSTRAINT IF EXISTS "questpie_crdt_pull_tnNv8QDNOPL3_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_pull" DROP CONSTRAINT IF EXISTS "questpie_crdt_pull_Kh82XlcIg1fR_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_pull" DROP CONSTRAINT IF EXISTS "fk_crdt_pull_session";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_pull" DROP CONSTRAINT IF EXISTS "fk_crdt_pull_attribution";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_pull_field" DROP CONSTRAINT IF EXISTS "questpie_crdt_pull_field_pull_id_questpie_crdt_pull_id_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_pull_field" DROP CONSTRAINT IF EXISTS "questpie_crdt_pull_field_LKMT6gR6WWsY_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_pull_page" DROP CONSTRAINT IF EXISTS "questpie_crdt_pull_page_pull_id_questpie_crdt_pull_id_fkey";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_awareness" DROP CONSTRAINT IF EXISTS "fk_crdt_awareness_session";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_awareness" DROP CONSTRAINT IF EXISTS "fk_crdt_awareness_active_field";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_projection" DROP CONSTRAINT IF EXISTS "fk_crdt_projection_commit";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_projection_field" DROP CONSTRAINT IF EXISTS "fk_crdt_projection_field_parent";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_projection_field" DROP CONSTRAINT IF EXISTS "fk_crdt_projection_field_binding";`,
		);
		await db.execute(
			sql`ALTER TABLE "questpie_crdt_lease" DROP CONSTRAINT IF EXISTS "questpie_crdt_lease_resource_id_questpie_crdt_resource_id_fkey";`,
		);
		await db.execute(sql`DROP TABLE "questpie_realtime_head";`);
		await db.execute(sql`DROP TABLE "questpie_channel_head";`);
		await db.execute(sql`DROP TABLE "questpie_channel_event";`);
		await db.execute(sql`DROP TABLE "questpie_channel_dispatch";`);
		await db.execute(sql`DROP TABLE "questpie_channel_presence";`);
		await db.execute(sql`DROP TABLE "questpie_realtime_topology";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_namespace";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_definition";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_schema";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_schema_field";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_subject";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_resource";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_resource_epoch";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_binding";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_commit";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_schema_compatibility";`);
		await db.execute(
			sql`DROP TABLE "questpie_crdt_schema_compatibility_field";`,
		);
		await db.execute(sql`DROP TABLE "questpie_crdt_update";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_update_receipt";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_receipt_field";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_snapshot_manifest";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_snapshot";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_recovery_hold";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_subject_fence";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_subject_admission";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_credential_admission";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_resource_admission";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_session";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_session_grant";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_pull";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_pull_field";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_pull_page";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_awareness";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_projection";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_projection_field";`);
		await db.execute(sql`DROP TABLE "questpie_crdt_lease";`);
		await db.execute(sql`DROP TABLE "questpie_storage_cleanup";`);
		await db.execute(sql`DROP TABLE "questpie_storage_object_key";`);
		await db.execute(
			sql`ALTER TABLE "questpie_realtime_log" DROP COLUMN "txid";`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_realtime_log_seq" ON "questpie_realtime_log" ("seq");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_realtime_log_resource" ON "questpie_realtime_log" ("resource_type","resource");`,
		);
	},
	snapshot,
});
