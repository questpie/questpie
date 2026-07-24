import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	bigint,
	bytea,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	smallint,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

import { systemTimestamp } from "#questpie/server/db/system-columns.js";

const counter = (name: string) =>
	bigint(name, { mode: "bigint" }).default(0n).notNull();
const requiredCounter = (name: string) =>
	bigint(name, { mode: "bigint" }).notNull();
const schemaVersion = (name: string) => requiredCounter(name);
const hash = (name: string) => bytea(name).notNull();
const requiredExpiry = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" }).notNull();
const optionalTime = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => systemTimestamp("created_at").defaultNow().notNull();
const updatedAt = () => systemTimestamp("updated_at").defaultNow().notNull();

function resourceEpochPointerColumns(): [
	AnyPgColumn,
	AnyPgColumn,
	AnyPgColumn,
] {
	return [
		questpieCrdtResourceEpochTable.resourceId,
		questpieCrdtResourceEpochTable.id,
		questpieCrdtResourceEpochTable.status,
	];
}

function snapshotManifestPointerColumns(): [
	AnyPgColumn,
	AnyPgColumn,
	AnyPgColumn,
	AnyPgColumn,
] {
	return [
		questpieCrdtSnapshotManifestTable.resourceId,
		questpieCrdtSnapshotManifestTable.resourceEpochId,
		questpieCrdtSnapshotManifestTable.id,
		questpieCrdtSnapshotManifestTable.status,
	];
}

function sessionAttributionColumns(): [
	AnyPgColumn,
	AnyPgColumn,
	AnyPgColumn,
	AnyPgColumn,
] {
	return [
		questpieCrdtSessionTable.id,
		questpieCrdtSessionTable.resourceId,
		questpieCrdtSessionTable.resourceEpochId,
		questpieCrdtSessionTable.subjectId,
	];
}

export const questpieCrdtNamespaceTable = pgTable(
	"questpie_crdt_namespace",
	{
		singleton: smallint("singleton").primaryKey(),
		namespace: text("namespace").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("uq_crdt_namespace_value").on(table.namespace),
		check("ck_crdt_namespace_singleton", sql`${table.singleton} = 1`),
		check(
			"ck_crdt_namespace_value",
			sql`octet_length(${table.namespace}) BETWEEN 1 AND 64 AND ${table.namespace} ~ '^[!-~]+$'`,
		),
	],
);

export const questpieCrdtDefinitionTable = pgTable(
	"questpie_crdt_definition",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		namespaceSingleton: smallint("namespace_singleton")
			.notNull()
			.references(() => questpieCrdtNamespaceTable.singleton, {
				onDelete: "restrict",
			}),
		ownerKind: smallint("owner_kind").notNull(),
		ownerKey: text("owner_key").notNull(),
		identityVersion: integer("identity_version").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("uq_crdt_definition_owner").on(
			table.namespaceSingleton,
			table.ownerKind,
			table.ownerKey,
		),
		check("ck_crdt_definition_owner_kind", sql`${table.ownerKind} IN (1, 2)`),
		check(
			"ck_crdt_definition_owner_key",
			sql`octet_length(${table.ownerKey}) BETWEEN 1 AND 128 AND ${table.ownerKey} ~ '^[!-~]+$'`,
		),
		check("ck_crdt_definition_identity", sql`${table.identityVersion} > 0`),
	],
);

export const questpieCrdtSchemaTable = pgTable(
	"questpie_crdt_schema",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		definitionId: uuid("definition_id")
			.notNull()
			.references(() => questpieCrdtDefinitionTable.id, {
				onDelete: "restrict",
			}),
		schemaVersion: schemaVersion("schema_version"),
		schemaFingerprint: hash("schema_fingerprint"),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("uq_crdt_schema_definition_id").on(
			table.definitionId,
			table.id,
		),
		uniqueIndex("uq_crdt_schema_id_version").on(table.id, table.schemaVersion),
		uniqueIndex("uq_crdt_schema_exact_version").on(
			table.definitionId,
			table.id,
			table.schemaVersion,
		),
		uniqueIndex("uq_crdt_schema_version").on(
			table.definitionId,
			table.schemaVersion,
		),
		uniqueIndex("uq_crdt_schema_fingerprint").on(
			table.definitionId,
			table.schemaFingerprint,
		),
		check(
			"ck_crdt_schema_version",
			sql`${table.schemaVersion} BETWEEN 0 AND 4294967295`,
		),
		check(
			"ck_crdt_schema_fingerprint",
			sql`octet_length(${table.schemaFingerprint}) = 32`,
		),
	],
);

export const questpieCrdtSchemaFieldTable = pgTable(
	"questpie_crdt_schema_field",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		definitionId: uuid("definition_id").notNull(),
		schemaId: uuid("schema_id").notNull(),
		stableFieldId: uuid("stable_field_id").notNull(),
		fieldSlot: integer("field_slot").notNull(),
		sourcePath: text("source_path").notNull(),
		format: smallint("format").notNull(),
		formatVersion: integer("format_version").notNull(),
		codecFingerprint: hash("codec_fingerprint"),
		createdAt: createdAt(),
	},
	(table) => [
		foreignKey({
			name: "fk_crdt_schema_field_schema",
			columns: [table.definitionId, table.schemaId],
			foreignColumns: [
				questpieCrdtSchemaTable.definitionId,
				questpieCrdtSchemaTable.id,
			],
		}).onDelete("restrict"),
		uniqueIndex("uq_crdt_schema_field_schema_id").on(table.schemaId, table.id),
		uniqueIndex("uq_crdt_schema_field_exact").on(
			table.definitionId,
			table.schemaId,
			table.id,
			table.stableFieldId,
			table.fieldSlot,
			table.sourcePath,
			table.format,
			table.formatVersion,
		),
		uniqueIndex("uq_crdt_schema_field_slot").on(
			table.schemaId,
			table.fieldSlot,
		),
		uniqueIndex("uq_crdt_schema_field_path").on(
			table.schemaId,
			table.sourcePath,
		),
		uniqueIndex("uq_crdt_schema_field_stable").on(
			table.schemaId,
			table.stableFieldId,
		),
		check(
			"ck_crdt_schema_field_slot",
			sql`${table.fieldSlot} BETWEEN 1 AND 65535`,
		),
		check("ck_crdt_schema_field_format", sql`${table.format} IN (1, 2)`),
		check(
			"ck_crdt_schema_field_version",
			sql`${table.formatVersion} BETWEEN 0 AND 65535`,
		),
		check(
			"ck_crdt_schema_field_path",
			sql`octet_length(${table.sourcePath}) BETWEEN 1 AND 256`,
		),
		check(
			"ck_crdt_schema_field_codec",
			sql`octet_length(${table.codecFingerprint}) = 32`,
		),
	],
);

export const questpieCrdtSubjectTable = pgTable(
	"questpie_crdt_subject",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		kind: smallint("kind").notNull(),
		issuerKey: text("issuer_key").default("").notNull(),
		subjectKey: text("subject_key").notNull(),
		subjectHash: hash("subject_hash"),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("uq_crdt_subject_tuple").on(
			table.kind,
			table.issuerKey,
			table.subjectKey,
		),
		uniqueIndex("uq_crdt_subject_hash").on(table.subjectHash),
		check("ck_crdt_subject_kind", sql`${table.kind} IN (1, 2)`),
		check(
			"ck_crdt_subject_issuer",
			sql`(${table.kind} = 1 AND ${table.issuerKey} = '') OR (${table.kind} = 2 AND octet_length(${table.issuerKey}) BETWEEN 1 AND 512)`,
		),
		check(
			"ck_crdt_subject_key",
			sql`octet_length(${table.subjectKey}) BETWEEN 1 AND 512`,
		),
		check("ck_crdt_subject_hash", sql`octet_length(${table.subjectHash}) = 32`),
	],
);

export const questpieCrdtResourceTable = pgTable(
	"questpie_crdt_resource",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		definitionId: uuid("definition_id")
			.notNull()
			.references(() => questpieCrdtDefinitionTable.id, {
				onDelete: "restrict",
			}),
		locator: text("locator").notNull(),
		locatorHash: hash("locator_hash"),
		identityVersion: integer("identity_version").notNull(),
		status: smallint("status").default(1).notNull(),
		currentEpochId: uuid("current_epoch_id"),
		currentEpochStatus: smallint("current_epoch_status"),
		readFence: counter("read_fence"),
		editFence: counter("edit_fence"),
		retiredAt: optionalTime("retired_at"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		foreignKey({
			name: "fk_crdt_resource_current_epoch",
			columns: [table.id, table.currentEpochId, table.currentEpochStatus],
			foreignColumns: resourceEpochPointerColumns(),
		}).onDelete("restrict"),
		uniqueIndex("uq_crdt_resource_definition_id").on(
			table.id,
			table.definitionId,
		),
		uniqueIndex("uq_crdt_resource_current_locator")
			.on(table.definitionId, table.locatorHash)
			.where(sql`${table.retiredAt} IS NULL`),
		index("idx_crdt_resource_locator").on(
			table.definitionId,
			table.locatorHash,
		),
		index("idx_crdt_resource_retired").on(table.retiredAt),
		check(
			"ck_crdt_resource_locator",
			sql`octet_length(${table.locator}) BETWEEN 1 AND 4096 AND octet_length(${table.locatorHash}) = 32`,
		),
		check("ck_crdt_resource_status", sql`${table.status} IN (1, 2, 3)`),
		check(
			"ck_crdt_resource_retirement",
			sql`(${table.status} = 1 AND ${table.retiredAt} IS NULL AND ${table.currentEpochId} IS NOT NULL AND ${table.currentEpochStatus} = 1) OR (${table.status} = 2 AND ${table.retiredAt} IS NOT NULL AND ((${table.currentEpochId} IS NULL AND ${table.currentEpochStatus} IS NULL) OR (${table.currentEpochId} IS NOT NULL AND ${table.currentEpochStatus} = 2))) OR (${table.status} = 3 AND ${table.retiredAt} IS NULL AND ((${table.currentEpochId} IS NULL AND ${table.currentEpochStatus} IS NULL) OR (${table.currentEpochId} IS NOT NULL AND ${table.currentEpochStatus} = 1)))`,
		),
		check(
			"ck_crdt_resource_fences",
			sql`${table.readFence} >= 0 AND ${table.editFence} >= 0`,
		),
	],
);

export const questpieCrdtResourceEpochTable = pgTable(
	"questpie_crdt_resource_epoch",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		resourceId: uuid("resource_id").notNull(),
		definitionId: uuid("definition_id").notNull(),
		aggregateEpoch: requiredCounter("aggregate_epoch"),
		schemaId: uuid("schema_id").notNull(),
		headCommitSeq: counter("head_commit_seq"),
		projectedCommitSeq: counter("projected_commit_seq"),
		updateBytes: counter("update_bytes"),
		status: smallint("status").default(1).notNull(),
		currentSnapshotManifestId: uuid("current_snapshot_manifest_id"),
		currentSnapshotStatus: smallint("current_snapshot_status"),
		previousSnapshotManifestId: uuid("previous_snapshot_manifest_id"),
		previousSnapshotStatus: smallint("previous_snapshot_status"),
		closedAt: optionalTime("closed_at"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		foreignKey({
			name: "fk_crdt_epoch_current_manifest",
			columns: [
				table.resourceId,
				table.id,
				table.currentSnapshotManifestId,
				table.currentSnapshotStatus,
			],
			foreignColumns: snapshotManifestPointerColumns(),
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_epoch_previous_manifest",
			columns: [
				table.resourceId,
				table.id,
				table.previousSnapshotManifestId,
				table.previousSnapshotStatus,
			],
			foreignColumns: snapshotManifestPointerColumns(),
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_epoch_resource",
			columns: [table.resourceId, table.definitionId],
			foreignColumns: [
				questpieCrdtResourceTable.id,
				questpieCrdtResourceTable.definitionId,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_epoch_schema",
			columns: [table.definitionId, table.schemaId],
			foreignColumns: [
				questpieCrdtSchemaTable.definitionId,
				questpieCrdtSchemaTable.id,
			],
		}).onDelete("restrict"),
		uniqueIndex("uq_crdt_resource_epoch_resource_id").on(
			table.resourceId,
			table.id,
		),
		uniqueIndex("uq_crdt_resource_epoch_number").on(
			table.resourceId,
			table.aggregateEpoch,
		),
		uniqueIndex("uq_crdt_resource_epoch_schema").on(
			table.resourceId,
			table.id,
			table.schemaId,
		),
		uniqueIndex("uq_crdt_resource_epoch_definition").on(
			table.resourceId,
			table.id,
			table.definitionId,
		),
		uniqueIndex("uq_crdt_resource_epoch_status").on(
			table.resourceId,
			table.id,
			table.status,
		),
		uniqueIndex("uq_crdt_resource_epoch_current")
			.on(table.resourceId)
			.where(sql`${table.status} = 1`),
		check(
			"ck_crdt_resource_epoch_counters",
			sql`${table.aggregateEpoch} >= 0 AND ${table.headCommitSeq} >= 0 AND ${table.projectedCommitSeq} BETWEEN 0 AND ${table.headCommitSeq} AND ${table.updateBytes} >= 0`,
		),
		check(
			"ck_crdt_resource_epoch_status",
			sql`(${table.status} = 1 AND ${table.closedAt} IS NULL) OR (${table.status} = 2 AND ${table.closedAt} IS NOT NULL)`,
		),
		check(
			"ck_crdt_resource_epoch_snapshots",
			sql`((${table.currentSnapshotManifestId} IS NULL AND ${table.currentSnapshotStatus} IS NULL) OR (${table.currentSnapshotManifestId} IS NOT NULL AND ${table.currentSnapshotStatus} = 2)) AND ((${table.previousSnapshotManifestId} IS NULL AND ${table.previousSnapshotStatus} IS NULL) OR (${table.previousSnapshotManifestId} IS NOT NULL AND ${table.previousSnapshotStatus} = 2)) AND (${table.currentSnapshotManifestId} IS NULL OR ${table.previousSnapshotManifestId} IS NULL OR ${table.currentSnapshotManifestId} <> ${table.previousSnapshotManifestId})`,
		),
	],
);

export const questpieCrdtBindingTable = pgTable(
	"questpie_crdt_binding",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		resourceId: uuid("resource_id").notNull(),
		definitionId: uuid("definition_id").notNull(),
		schemaId: uuid("schema_id").notNull(),
		schemaFieldId: uuid("schema_field_id").notNull(),
		stableFieldId: uuid("stable_field_id").notNull(),
		fieldSlot: integer("field_slot").notNull(),
		sourcePath: text("source_path").notNull(),
		format: smallint("format").notNull(),
		formatVersion: integer("format_version").notNull(),
		fieldEpoch: requiredCounter("field_epoch"),
		headFieldCursor: counter("head_field_cursor"),
		projectedFieldCursor: counter("projected_field_cursor"),
		readFence: counter("read_fence"),
		editFence: counter("edit_fence"),
		canonicalHash: hash("canonical_hash"),
		canonicalRevision: counter("canonical_revision"),
		projectedCanonicalHash: hash("projected_canonical_hash"),
		projectedCanonicalRevision: counter("projected_canonical_revision"),
		status: smallint("status").default(1).notNull(),
		stateBytes: counter("state_bytes"),
		elementCount: counter("element_count"),
		retiredAt: optionalTime("retired_at"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		foreignKey({
			name: "fk_crdt_binding_schema_field",
			columns: [
				table.definitionId,
				table.schemaId,
				table.schemaFieldId,
				table.stableFieldId,
				table.fieldSlot,
				table.sourcePath,
				table.format,
				table.formatVersion,
			],
			foreignColumns: [
				questpieCrdtSchemaFieldTable.definitionId,
				questpieCrdtSchemaFieldTable.schemaId,
				questpieCrdtSchemaFieldTable.id,
				questpieCrdtSchemaFieldTable.stableFieldId,
				questpieCrdtSchemaFieldTable.fieldSlot,
				questpieCrdtSchemaFieldTable.sourcePath,
				questpieCrdtSchemaFieldTable.format,
				questpieCrdtSchemaFieldTable.formatVersion,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_binding_resource",
			columns: [table.resourceId, table.definitionId],
			foreignColumns: [
				questpieCrdtResourceTable.id,
				questpieCrdtResourceTable.definitionId,
			],
		}).onDelete("restrict"),
		uniqueIndex("uq_crdt_binding_exact").on(
			table.resourceId,
			table.id,
			table.fieldEpoch,
			table.fieldSlot,
			table.formatVersion,
		),
		uniqueIndex("uq_crdt_binding_stable_exact").on(
			table.resourceId,
			table.id,
			table.stableFieldId,
			table.fieldEpoch,
			table.fieldSlot,
			table.formatVersion,
		),
		uniqueIndex("uq_crdt_binding_schema_exact").on(
			table.resourceId,
			table.id,
			table.schemaId,
			table.schemaFieldId,
			table.fieldEpoch,
			table.fieldSlot,
			table.formatVersion,
		),
		uniqueIndex("uq_crdt_binding_grant_exact").on(
			table.resourceId,
			table.id,
			table.schemaId,
			table.stableFieldId,
			table.fieldEpoch,
			table.fieldSlot,
			table.formatVersion,
		),
		uniqueIndex("uq_crdt_binding_resource_id").on(table.resourceId, table.id),
		uniqueIndex("uq_crdt_binding_epoch").on(
			table.resourceId,
			table.stableFieldId,
			table.fieldEpoch,
		),
		uniqueIndex("uq_crdt_binding_current_stable")
			.on(table.resourceId, table.stableFieldId)
			.where(sql`${table.retiredAt} IS NULL`),
		uniqueIndex("uq_crdt_binding_resource_slot")
			.on(table.resourceId, table.fieldSlot)
			.where(sql`${table.retiredAt} IS NULL`),
		uniqueIndex("uq_crdt_binding_current_path")
			.on(table.resourceId, table.sourcePath)
			.where(sql`${table.retiredAt} IS NULL`),
		check(
			"ck_crdt_binding_identity",
			sql`${table.fieldSlot} BETWEEN 1 AND 65535 AND ${table.format} IN (1, 2) AND ${table.formatVersion} BETWEEN 0 AND 65535 AND octet_length(${table.sourcePath}) BETWEEN 1 AND 256`,
		),
		check(
			"ck_crdt_binding_counters",
			sql`${table.fieldEpoch} >= 0 AND ${table.headFieldCursor} >= 0 AND ${table.projectedFieldCursor} BETWEEN 0 AND ${table.headFieldCursor} AND ${table.readFence} >= 0 AND ${table.editFence} >= 0 AND ${table.canonicalRevision} >= 0 AND ${table.projectedCanonicalRevision} >= 0 AND ${table.stateBytes} >= 0 AND ${table.elementCount} >= 0`,
		),
		check(
			"ck_crdt_binding_hashes",
			sql`octet_length(${table.canonicalHash}) = 32 AND octet_length(${table.projectedCanonicalHash}) = 32`,
		),
		check(
			"ck_crdt_binding_status",
			sql`(${table.status} = 2 AND ${table.retiredAt} IS NOT NULL) OR (${table.status} IN (1, 3) AND ${table.retiredAt} IS NULL)`,
		),
	],
);

export const questpieCrdtCommitTable = pgTable(
	"questpie_crdt_commit",
	{
		resourceId: uuid("resource_id").notNull(),
		resourceEpochId: uuid("resource_epoch_id").notNull(),
		definitionId: uuid("definition_id").notNull(),
		commitSeq: requiredCounter("commit_seq"),
		kind: smallint("kind").notNull(),
		schemaId: uuid("schema_id").notNull(),
		canonicalBundleHash: hash("canonical_bundle_hash"),
		deliveryCommitId: uuid("delivery_commit_id").notNull(),
		subjectId: uuid("subject_id").references(
			() => questpieCrdtSubjectTable.id,
			{
				onDelete: "restrict",
			},
		),
		sessionId: uuid("session_id"),
		controlPayload: jsonb("control_payload"),
		committedAt: systemTimestamp("committed_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.resourceId, table.resourceEpochId, table.commitSeq],
		}),
		foreignKey({
			name: "fk_crdt_commit_epoch",
			columns: [table.resourceId, table.resourceEpochId, table.definitionId],
			foreignColumns: [
				questpieCrdtResourceEpochTable.resourceId,
				questpieCrdtResourceEpochTable.id,
				questpieCrdtResourceEpochTable.definitionId,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_commit_schema",
			columns: [table.definitionId, table.schemaId],
			foreignColumns: [
				questpieCrdtSchemaTable.definitionId,
				questpieCrdtSchemaTable.id,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_commit_session",
			columns: [
				table.sessionId,
				table.resourceId,
				table.resourceEpochId,
				table.subjectId,
			],
			foreignColumns: sessionAttributionColumns(),
		}).onDelete("restrict"),
		uniqueIndex("uq_crdt_commit_delivery").on(
			table.resourceId,
			table.deliveryCommitId,
		),
		uniqueIndex("uq_crdt_commit_kind_identity").on(
			table.resourceId,
			table.resourceEpochId,
			table.commitSeq,
			table.kind,
		),
		uniqueIndex("uq_crdt_commit_schema_identity").on(
			table.resourceId,
			table.resourceEpochId,
			table.commitSeq,
			table.kind,
			table.schemaId,
		),
		uniqueIndex("uq_crdt_commit_projection_identity").on(
			table.resourceId,
			table.resourceEpochId,
			table.commitSeq,
			table.schemaId,
		),
		uniqueIndex("uq_crdt_commit_receipt_identity").on(
			table.resourceId,
			table.resourceEpochId,
			table.commitSeq,
			table.kind,
			table.schemaId,
			table.canonicalBundleHash,
			table.subjectId,
		),
		check("ck_crdt_commit_seq", sql`${table.commitSeq} > 0`),
		check("ck_crdt_commit_kind", sql`${table.kind} IN (1, 2, 3, 4)`),
		check(
			"ck_crdt_commit_hash",
			sql`octet_length(${table.canonicalBundleHash}) = 32`,
		),
		check(
			"ck_crdt_commit_session_subject",
			sql`${table.sessionId} IS NULL OR ${table.subjectId} IS NOT NULL`,
		),
		check(
			"ck_crdt_commit_kind_payload",
			sql`(${table.kind} = 1 AND ${table.subjectId} IS NOT NULL AND ${table.sessionId} IS NOT NULL AND ${table.controlPayload} IS NULL) OR (${table.kind} IN (2, 3, 4) AND ${table.sessionId} IS NULL AND ${table.controlPayload} IS NOT NULL)`,
		),
	],
);

export const questpieCrdtSchemaCompatibilityTable = pgTable(
	"questpie_crdt_schema_compatibility",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		resourceId: uuid("resource_id").notNull(),
		resourceEpochId: uuid("resource_epoch_id").notNull(),
		definitionId: uuid("definition_id").notNull(),
		sourceSchemaId: uuid("source_schema_id").notNull(),
		targetSchemaId: uuid("target_schema_id").notNull(),
		manifestCommitSeq: requiredCounter("manifest_commit_seq"),
		manifestCommitKind: smallint("manifest_commit_kind").default(4).notNull(),
		expiresAt: requiredExpiry("expires_at"),
		createdAt: createdAt(),
	},
	(table) => [
		foreignKey({
			name: "fk_crdt_compatibility_epoch",
			columns: [table.resourceId, table.resourceEpochId],
			foreignColumns: [
				questpieCrdtResourceEpochTable.resourceId,
				questpieCrdtResourceEpochTable.id,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_compatibility_resource",
			columns: [table.resourceId, table.definitionId],
			foreignColumns: [
				questpieCrdtResourceTable.id,
				questpieCrdtResourceTable.definitionId,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_compatibility_source_schema",
			columns: [table.definitionId, table.sourceSchemaId],
			foreignColumns: [
				questpieCrdtSchemaTable.definitionId,
				questpieCrdtSchemaTable.id,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_compatibility_target_schema",
			columns: [table.definitionId, table.targetSchemaId],
			foreignColumns: [
				questpieCrdtSchemaTable.definitionId,
				questpieCrdtSchemaTable.id,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_compatibility_commit",
			columns: [
				table.resourceId,
				table.resourceEpochId,
				table.manifestCommitSeq,
				table.manifestCommitKind,
				table.targetSchemaId,
			],
			foreignColumns: [
				questpieCrdtCommitTable.resourceId,
				questpieCrdtCommitTable.resourceEpochId,
				questpieCrdtCommitTable.commitSeq,
				questpieCrdtCommitTable.kind,
				questpieCrdtCommitTable.schemaId,
			],
		}).onDelete("restrict"),
		uniqueIndex("uq_crdt_compatibility_pair").on(
			table.resourceId,
			table.sourceSchemaId,
			table.targetSchemaId,
			table.manifestCommitSeq,
		),
		uniqueIndex("uq_crdt_compatibility_exact").on(
			table.id,
			table.resourceId,
			table.sourceSchemaId,
			table.targetSchemaId,
		),
		index("idx_crdt_compatibility_expiry").on(table.expiresAt),
		check(
			"ck_crdt_compatibility_schemas",
			sql`${table.sourceSchemaId} <> ${table.targetSchemaId}`,
		),
		check(
			"ck_crdt_compatibility_commit_kind",
			sql`${table.manifestCommitKind} = 4`,
		),
	],
);

export const questpieCrdtSchemaCompatibilityFieldTable = pgTable(
	"questpie_crdt_schema_compatibility_field",
	{
		compatibilityId: uuid("compatibility_id").notNull(),
		resourceId: uuid("resource_id").notNull(),
		sourceSchemaId: uuid("source_schema_id").notNull(),
		sourceSchemaFieldId: uuid("source_schema_field_id").notNull(),
		sourceBindingId: uuid("source_binding_id").notNull(),
		sourceFieldEpoch: requiredCounter("source_field_epoch"),
		sourceFieldSlot: integer("source_field_slot").notNull(),
		sourceFormatVersion: integer("source_format_version").notNull(),
		targetSchemaId: uuid("target_schema_id").notNull(),
		targetSchemaFieldId: uuid("target_schema_field_id").notNull(),
		targetBindingId: uuid("target_binding_id").notNull(),
		targetFieldEpoch: requiredCounter("target_field_epoch"),
		targetFieldSlot: integer("target_field_slot").notNull(),
		targetFormatVersion: integer("target_format_version").notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.compatibilityId, table.sourceSchemaFieldId],
		}),
		foreignKey({
			name: "fk_crdt_compat_field_parent",
			columns: [
				table.compatibilityId,
				table.resourceId,
				table.sourceSchemaId,
				table.targetSchemaId,
			],
			foreignColumns: [
				questpieCrdtSchemaCompatibilityTable.id,
				questpieCrdtSchemaCompatibilityTable.resourceId,
				questpieCrdtSchemaCompatibilityTable.sourceSchemaId,
				questpieCrdtSchemaCompatibilityTable.targetSchemaId,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_compat_source_binding",
			columns: [
				table.resourceId,
				table.sourceBindingId,
				table.sourceSchemaId,
				table.sourceSchemaFieldId,
				table.sourceFieldEpoch,
				table.sourceFieldSlot,
				table.sourceFormatVersion,
			],
			foreignColumns: [
				questpieCrdtBindingTable.resourceId,
				questpieCrdtBindingTable.id,
				questpieCrdtBindingTable.schemaId,
				questpieCrdtBindingTable.schemaFieldId,
				questpieCrdtBindingTable.fieldEpoch,
				questpieCrdtBindingTable.fieldSlot,
				questpieCrdtBindingTable.formatVersion,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_compat_target_binding",
			columns: [
				table.resourceId,
				table.targetBindingId,
				table.targetSchemaId,
				table.targetSchemaFieldId,
				table.targetFieldEpoch,
				table.targetFieldSlot,
				table.targetFormatVersion,
			],
			foreignColumns: [
				questpieCrdtBindingTable.resourceId,
				questpieCrdtBindingTable.id,
				questpieCrdtBindingTable.schemaId,
				questpieCrdtBindingTable.schemaFieldId,
				questpieCrdtBindingTable.fieldEpoch,
				questpieCrdtBindingTable.fieldSlot,
				questpieCrdtBindingTable.formatVersion,
			],
		}).onDelete("restrict"),
		uniqueIndex("uq_crdt_compat_target").on(
			table.compatibilityId,
			table.targetSchemaFieldId,
		),
		check(
			"ck_crdt_compat_field_slots",
			sql`${table.sourceFieldSlot} BETWEEN 1 AND 65535 AND ${table.targetFieldSlot} BETWEEN 1 AND 65535 AND ${table.sourceFormatVersion} BETWEEN 0 AND 65535 AND ${table.targetFormatVersion} BETWEEN 0 AND 65535`,
		),
	],
);

export const questpieCrdtUpdateTable = pgTable(
	"questpie_crdt_update",
	{
		resourceId: uuid("resource_id").notNull(),
		resourceEpochId: uuid("resource_epoch_id").notNull(),
		commitSeq: requiredCounter("commit_seq"),
		commitKind: smallint("commit_kind").default(1).notNull(),
		schemaId: uuid("schema_id").notNull(),
		fieldSlot: integer("field_slot").notNull(),
		bindingId: uuid("binding_id").notNull(),
		stableFieldId: uuid("stable_field_id").notNull(),
		fieldEpoch: requiredCounter("field_epoch"),
		formatVersion: integer("format_version").notNull(),
		baseFieldCursor: requiredCounter("base_field_cursor"),
		fieldCursor: requiredCounter("field_cursor"),
		bytes: bytea("bytes").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		checksum: hash("checksum"),
	},
	(table) => [
		primaryKey({
			columns: [
				table.resourceId,
				table.resourceEpochId,
				table.commitSeq,
				table.fieldSlot,
			],
		}),
		foreignKey({
			name: "fk_crdt_update_commit",
			columns: [
				table.resourceId,
				table.resourceEpochId,
				table.commitSeq,
				table.commitKind,
				table.schemaId,
			],
			foreignColumns: [
				questpieCrdtCommitTable.resourceId,
				questpieCrdtCommitTable.resourceEpochId,
				questpieCrdtCommitTable.commitSeq,
				questpieCrdtCommitTable.kind,
				questpieCrdtCommitTable.schemaId,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_update_binding",
			columns: [
				table.resourceId,
				table.bindingId,
				table.schemaId,
				table.stableFieldId,
				table.fieldEpoch,
				table.fieldSlot,
				table.formatVersion,
			],
			foreignColumns: [
				questpieCrdtBindingTable.resourceId,
				questpieCrdtBindingTable.id,
				questpieCrdtBindingTable.schemaId,
				questpieCrdtBindingTable.stableFieldId,
				questpieCrdtBindingTable.fieldEpoch,
				questpieCrdtBindingTable.fieldSlot,
				questpieCrdtBindingTable.formatVersion,
			],
		}).onDelete("restrict"),
		uniqueIndex("uq_crdt_update_field_cursor").on(
			table.bindingId,
			table.fieldEpoch,
			table.fieldCursor,
		),
		check(
			"ck_crdt_update_identity",
			sql`${table.fieldSlot} BETWEEN 1 AND 65535 AND ${table.formatVersion} BETWEEN 0 AND 65535 AND ${table.commitSeq} > 0 AND ${table.commitKind} = 1 AND ${table.fieldEpoch} >= 0`,
		),
		check(
			"ck_crdt_update_cursor",
			sql`${table.baseFieldCursor} >= 0 AND ${table.fieldCursor} = ${table.baseFieldCursor} + 1`,
		),
		check(
			"ck_crdt_update_bytes",
			sql`${table.sizeBytes} BETWEEN 1 AND 262144 AND octet_length(${table.bytes}) = ${table.sizeBytes} AND octet_length(${table.checksum}) = 32`,
		),
	],
);

export const questpieCrdtUpdateReceiptTable = pgTable(
	"questpie_crdt_update_receipt",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		resourceId: uuid("resource_id").notNull(),
		resourceEpochId: uuid("resource_epoch_id").notNull(),
		definitionId: uuid("definition_id").notNull(),
		updateId: uuid("update_id").notNull(),
		commitSeq: requiredCounter("commit_seq"),
		commitKind: smallint("commit_kind").default(1).notNull(),
		submittedSchemaId: uuid("submitted_schema_id").notNull(),
		submittedSchemaVersion: schemaVersion("submitted_schema_version"),
		submittedBundleHash: hash("submitted_bundle_hash"),
		normalizedSchemaId: uuid("normalized_schema_id").notNull(),
		normalizedCommitHash: hash("normalized_commit_hash"),
		subjectId: uuid("subject_id")
			.notNull()
			.references(() => questpieCrdtSubjectTable.id, {
				onDelete: "restrict",
			}),
		expiresAt: requiredExpiry("expires_at"),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("uq_crdt_receipt_update").on(
			table.resourceId,
			table.resourceEpochId,
			table.updateId,
		),
		uniqueIndex("uq_crdt_receipt_resource_id").on(table.id, table.resourceId),
		uniqueIndex("uq_crdt_receipt_normalized_schema").on(
			table.id,
			table.resourceId,
			table.normalizedSchemaId,
		),
		foreignKey({
			name: "fk_crdt_receipt_resource",
			columns: [table.resourceId, table.definitionId],
			foreignColumns: [
				questpieCrdtResourceTable.id,
				questpieCrdtResourceTable.definitionId,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_receipt_submitted_schema",
			columns: [
				table.definitionId,
				table.submittedSchemaId,
				table.submittedSchemaVersion,
			],
			foreignColumns: [
				questpieCrdtSchemaTable.definitionId,
				questpieCrdtSchemaTable.id,
				questpieCrdtSchemaTable.schemaVersion,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_receipt_commit",
			columns: [
				table.resourceId,
				table.resourceEpochId,
				table.commitSeq,
				table.commitKind,
				table.normalizedSchemaId,
				table.normalizedCommitHash,
				table.subjectId,
			],
			foreignColumns: [
				questpieCrdtCommitTable.resourceId,
				questpieCrdtCommitTable.resourceEpochId,
				questpieCrdtCommitTable.commitSeq,
				questpieCrdtCommitTable.kind,
				questpieCrdtCommitTable.schemaId,
				questpieCrdtCommitTable.canonicalBundleHash,
				questpieCrdtCommitTable.subjectId,
			],
		}).onDelete("restrict"),
		index("idx_crdt_receipt_expiry").on(table.expiresAt),
		check(
			"ck_crdt_receipt_hashes",
			sql`octet_length(${table.submittedBundleHash}) = 32 AND octet_length(${table.normalizedCommitHash}) = 32`,
		),
		check(
			"ck_crdt_receipt_schema_version",
			sql`${table.submittedSchemaVersion} BETWEEN 0 AND 4294967295 AND ${table.commitKind} = 1`,
		),
	],
);

export const questpieCrdtReceiptFieldTable = pgTable(
	"questpie_crdt_receipt_field",
	{
		receiptId: uuid("receipt_id").notNull(),
		resourceId: uuid("resource_id").notNull(),
		schemaId: uuid("schema_id").notNull(),
		bindingId: uuid("binding_id").notNull(),
		stableFieldId: uuid("stable_field_id").notNull(),
		fieldEpoch: requiredCounter("field_epoch"),
		fieldSlot: integer("field_slot").notNull(),
		formatVersion: integer("format_version").notNull(),
		fieldCursor: requiredCounter("field_cursor"),
	},
	(table) => [
		primaryKey({ columns: [table.receiptId, table.bindingId] }),
		foreignKey({
			name: "fk_crdt_receipt_field_parent",
			columns: [table.receiptId, table.resourceId, table.schemaId],
			foreignColumns: [
				questpieCrdtUpdateReceiptTable.id,
				questpieCrdtUpdateReceiptTable.resourceId,
				questpieCrdtUpdateReceiptTable.normalizedSchemaId,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_receipt_field_binding",
			columns: [
				table.resourceId,
				table.bindingId,
				table.schemaId,
				table.stableFieldId,
				table.fieldEpoch,
				table.fieldSlot,
				table.formatVersion,
			],
			foreignColumns: [
				questpieCrdtBindingTable.resourceId,
				questpieCrdtBindingTable.id,
				questpieCrdtBindingTable.schemaId,
				questpieCrdtBindingTable.stableFieldId,
				questpieCrdtBindingTable.fieldEpoch,
				questpieCrdtBindingTable.fieldSlot,
				questpieCrdtBindingTable.formatVersion,
			],
		}).onDelete("restrict"),
		check(
			"ck_crdt_receipt_field_identity",
			sql`${table.fieldSlot} BETWEEN 1 AND 65535 AND ${table.formatVersion} BETWEEN 0 AND 65535 AND ${table.fieldCursor} > 0`,
		),
	],
);

export const questpieCrdtSnapshotManifestTable = pgTable(
	"questpie_crdt_snapshot_manifest",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		resourceId: uuid("resource_id").notNull(),
		resourceEpochId: uuid("resource_epoch_id").notNull(),
		definitionId: uuid("definition_id").notNull(),
		schemaId: uuid("schema_id").notNull(),
		coversCommitSeq: requiredCounter("covers_commit_seq"),
		status: smallint("status").default(1).notNull(),
		totalBytes: integer("total_bytes").notNull(),
		fieldCount: integer("field_count").notNull(),
		checksum: hash("checksum"),
		leaseGeneration: requiredCounter("lease_generation"),
		verifiedAt: optionalTime("verified_at"),
		createdAt: createdAt(),
	},
	(table) => [
		foreignKey({
			name: "fk_crdt_manifest_epoch",
			columns: [table.resourceId, table.resourceEpochId, table.definitionId],
			foreignColumns: [
				questpieCrdtResourceEpochTable.resourceId,
				questpieCrdtResourceEpochTable.id,
				questpieCrdtResourceEpochTable.definitionId,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_manifest_schema",
			columns: [table.definitionId, table.schemaId],
			foreignColumns: [
				questpieCrdtSchemaTable.definitionId,
				questpieCrdtSchemaTable.id,
			],
		}).onDelete("restrict"),
		uniqueIndex("uq_crdt_manifest_resource_epoch_id").on(
			table.resourceId,
			table.resourceEpochId,
			table.id,
		),
		uniqueIndex("uq_crdt_manifest_schema_identity").on(
			table.resourceId,
			table.resourceEpochId,
			table.id,
			table.schemaId,
		),
		uniqueIndex("uq_crdt_manifest_verified_identity").on(
			table.resourceId,
			table.resourceEpochId,
			table.id,
			table.status,
		),
		index("idx_crdt_manifest_verified_cut").on(
			table.resourceId,
			table.resourceEpochId,
			table.coversCommitSeq,
		),
		check(
			"ck_crdt_manifest_bounds",
			sql`${table.coversCommitSeq} >= 0 AND ${table.totalBytes} BETWEEN 0 AND 33554432 AND ${table.fieldCount} BETWEEN 1 AND 32 AND ${table.leaseGeneration} >= 0`,
		),
		check(
			"ck_crdt_manifest_status",
			sql`(${table.status} = 1 AND ${table.verifiedAt} IS NULL) OR (${table.status} = 2 AND ${table.verifiedAt} IS NOT NULL)`,
		),
		check(
			"ck_crdt_manifest_checksum",
			sql`octet_length(${table.checksum}) = 32`,
		),
	],
);

export const questpieCrdtSnapshotTable = pgTable(
	"questpie_crdt_snapshot",
	{
		manifestId: uuid("manifest_id").notNull(),
		resourceId: uuid("resource_id").notNull(),
		resourceEpochId: uuid("resource_epoch_id").notNull(),
		schemaId: uuid("schema_id").notNull(),
		bindingId: uuid("binding_id").notNull(),
		stableFieldId: uuid("stable_field_id").notNull(),
		fieldEpoch: requiredCounter("field_epoch"),
		fieldSlot: integer("field_slot").notNull(),
		formatVersion: integer("format_version").notNull(),
		fieldCursor: requiredCounter("field_cursor"),
		engineId: text("engine_id").notNull(),
		engineVersion: integer("engine_version").notNull(),
		stateVersion: integer("state_version").notNull(),
		bytes: bytea("bytes").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		checksum: hash("checksum"),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.manifestId, table.bindingId] }),
		foreignKey({
			name: "fk_crdt_snapshot_manifest",
			columns: [
				table.resourceId,
				table.resourceEpochId,
				table.manifestId,
				table.schemaId,
			],
			foreignColumns: [
				questpieCrdtSnapshotManifestTable.resourceId,
				questpieCrdtSnapshotManifestTable.resourceEpochId,
				questpieCrdtSnapshotManifestTable.id,
				questpieCrdtSnapshotManifestTable.schemaId,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_snapshot_binding",
			columns: [
				table.resourceId,
				table.bindingId,
				table.schemaId,
				table.stableFieldId,
				table.fieldEpoch,
				table.fieldSlot,
				table.formatVersion,
			],
			foreignColumns: [
				questpieCrdtBindingTable.resourceId,
				questpieCrdtBindingTable.id,
				questpieCrdtBindingTable.schemaId,
				questpieCrdtBindingTable.stableFieldId,
				questpieCrdtBindingTable.fieldEpoch,
				questpieCrdtBindingTable.fieldSlot,
				questpieCrdtBindingTable.formatVersion,
			],
		}).onDelete("restrict"),
		check(
			"ck_crdt_snapshot_versions",
			sql`${table.fieldSlot} BETWEEN 1 AND 65535 AND ${table.formatVersion} BETWEEN 0 AND 65535 AND ${table.engineVersion} BETWEEN 0 AND 65535 AND ${table.stateVersion} BETWEEN 0 AND 65535 AND ${table.fieldCursor} >= 0`,
		),
		check(
			"ck_crdt_snapshot_bytes",
			sql`${table.sizeBytes} BETWEEN 0 AND 25165824 AND octet_length(${table.bytes}) = ${table.sizeBytes} AND octet_length(${table.checksum}) = 32`,
		),
	],
);

export const questpieCrdtRecoveryHoldTable = pgTable(
	"questpie_crdt_recovery_hold",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		resourceId: uuid("resource_id").notNull(),
		resourceEpochId: uuid("resource_epoch_id").notNull(),
		bindingId: uuid("binding_id"),
		bindingFieldEpoch: bigint("binding_field_epoch", {
			mode: "bigint",
		}),
		bindingFieldSlot: integer("binding_field_slot"),
		bindingFormatVersion: integer("binding_format_version"),
		subjectId: uuid("subject_id")
			.notNull()
			.references(() => questpieCrdtSubjectTable.id, {
				onDelete: "restrict",
			}),
		reason: smallint("reason").notNull(),
		expiresAt: requiredExpiry("expires_at"),
		createdAt: createdAt(),
	},
	(table) => [
		foreignKey({
			name: "fk_crdt_recovery_hold_epoch",
			columns: [table.resourceId, table.resourceEpochId],
			foreignColumns: [
				questpieCrdtResourceEpochTable.resourceId,
				questpieCrdtResourceEpochTable.id,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_recovery_hold_binding",
			columns: [
				table.resourceId,
				table.bindingId,
				table.bindingFieldEpoch,
				table.bindingFieldSlot,
				table.bindingFormatVersion,
			],
			foreignColumns: [
				questpieCrdtBindingTable.resourceId,
				questpieCrdtBindingTable.id,
				questpieCrdtBindingTable.fieldEpoch,
				questpieCrdtBindingTable.fieldSlot,
				questpieCrdtBindingTable.formatVersion,
			],
		}).onDelete("restrict"),
		index("idx_crdt_recovery_hold_resource").on(
			table.resourceId,
			table.expiresAt,
		),
		index("idx_crdt_recovery_hold_expiry").on(table.expiresAt),
		check("ck_crdt_recovery_hold_reason", sql`${table.reason} BETWEEN 1 AND 8`),
		check(
			"ck_crdt_recovery_hold_binding_identity",
			sql`(${table.bindingId} IS NULL AND ${table.bindingFieldEpoch} IS NULL AND ${table.bindingFieldSlot} IS NULL AND ${table.bindingFormatVersion} IS NULL) OR (${table.bindingId} IS NOT NULL AND ${table.bindingFieldEpoch} >= 0 AND ${table.bindingFieldSlot} BETWEEN 1 AND 65535 AND ${table.bindingFormatVersion} BETWEEN 0 AND 65535)`,
		),
	],
);

export const questpieCrdtSubjectFenceTable = pgTable(
	"questpie_crdt_subject_fence",
	{
		resourceId: uuid("resource_id")
			.notNull()
			.references(() => questpieCrdtResourceTable.id, {
				onDelete: "restrict",
			}),
		subjectId: uuid("subject_id")
			.notNull()
			.references(() => questpieCrdtSubjectTable.id, {
				onDelete: "restrict",
			}),
		scopeKind: smallint("scope_kind").notNull(),
		stableFieldId: uuid("stable_field_id").notNull(),
		readFence: counter("read_fence"),
		editFence: counter("edit_fence"),
		updatedAt: updatedAt(),
	},
	(table) => [
		primaryKey({
			columns: [
				table.resourceId,
				table.subjectId,
				table.scopeKind,
				table.stableFieldId,
			],
		}),
		check("ck_crdt_subject_fence_scope", sql`${table.scopeKind} IN (1, 2)`),
		check(
			"ck_crdt_subject_fence_sentinel",
			sql`(${table.scopeKind} = 1 AND ${table.stableFieldId} = '00000000-0000-0000-0000-000000000000'::uuid) OR (${table.scopeKind} = 2 AND ${table.stableFieldId} <> '00000000-0000-0000-0000-000000000000'::uuid)`,
		),
		check(
			"ck_crdt_subject_fence_values",
			sql`${table.readFence} >= 0 AND ${table.editFence} >= 0`,
		),
	],
);

export const questpieCrdtSubjectAdmissionTable = pgTable(
	"questpie_crdt_subject_admission",
	{
		subjectId: uuid("subject_id")
			.primaryKey()
			.references(() => questpieCrdtSubjectTable.id, {
				onDelete: "restrict",
			}),
		ticketTokens: counter("ticket_tokens"),
		ticketRefilledAt: systemTimestamp("ticket_refilled_at")
			.defaultNow()
			.notNull(),
		updatedAt: updatedAt(),
	},
	(table) => [
		check("ck_crdt_subject_admission_tokens", sql`${table.ticketTokens} >= 0`),
	],
);

export const questpieCrdtCredentialAdmissionTable = pgTable(
	"questpie_crdt_credential_admission",
	{
		credentialFingerprint: bytea("credential_fingerprint").primaryKey(),
		ticketTokens: counter("ticket_tokens"),
		ticketRefilledAt: systemTimestamp("ticket_refilled_at")
			.defaultNow()
			.notNull(),
		updatedAt: updatedAt(),
	},
	(table) => [
		check(
			"ck_crdt_credential_admission_identity",
			sql`octet_length(${table.credentialFingerprint}) = 32`,
		),
		check(
			"ck_crdt_credential_admission_tokens",
			sql`${table.ticketTokens} >= 0`,
		),
	],
);

export const questpieCrdtResourceAdmissionTable = pgTable(
	"questpie_crdt_resource_admission",
	{
		resourceId: uuid("resource_id")
			.primaryKey()
			.references(() => questpieCrdtResourceTable.id, {
				onDelete: "restrict",
			}),
		partTokens: counter("part_tokens"),
		partRefilledAt: systemTimestamp("part_refilled_at").defaultNow().notNull(),
		updatedAt: systemTimestamp("head_updated_at").defaultNow().notNull(),
	},
	(table) => [
		check("ck_crdt_resource_admission_tokens", sql`${table.partTokens} >= 0`),
	],
);

export const questpieCrdtTicketTable = pgTable(
	"questpie_crdt_ticket",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		resourceId: uuid("resource_id").notNull(),
		resourceEpochId: uuid("resource_epoch_id").notNull(),
		definitionId: uuid("definition_id").notNull(),
		schemaId: uuid("schema_id").notNull(),
		subjectId: uuid("subject_id")
			.notNull()
			.references(() => questpieCrdtSubjectTable.id, {
				onDelete: "restrict",
			}),
		secretHash: hash("secret_hash"),
		credentialFingerprint: hash("credential_fingerprint"),
		audience: text("audience").notNull(),
		origin: text("origin"),
		requestedMode: smallint("requested_mode").notNull(),
		protocolMajor: smallint("protocol_major").notNull(),
		protocolMinor: smallint("protocol_minor").notNull(),
		resourceReadFence: requiredCounter("resource_read_fence"),
		resourceEditFence: requiredCounter("resource_edit_fence"),
		sessionGeneration: requiredCounter("session_generation"),
		expiresAt: requiredExpiry("expires_at"),
		redeemedAt: optionalTime("redeemed_at"),
		releasedAt: optionalTime("released_at"),
		createdAt: createdAt(),
	},
	(table) => [
		foreignKey({
			name: "fk_crdt_ticket_epoch",
			columns: [table.resourceId, table.resourceEpochId, table.definitionId],
			foreignColumns: [
				questpieCrdtResourceEpochTable.resourceId,
				questpieCrdtResourceEpochTable.id,
				questpieCrdtResourceEpochTable.definitionId,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_ticket_schema",
			columns: [table.definitionId, table.schemaId],
			foreignColumns: [
				questpieCrdtSchemaTable.definitionId,
				questpieCrdtSchemaTable.id,
			],
		}).onDelete("restrict"),
		uniqueIndex("uq_crdt_ticket_resource_id").on(table.id, table.resourceId),
		uniqueIndex("uq_crdt_ticket_resource_schema").on(
			table.id,
			table.resourceId,
			table.schemaId,
		),
		uniqueIndex("uq_crdt_ticket_session_identity").on(
			table.id,
			table.resourceId,
			table.resourceEpochId,
			table.schemaId,
			table.subjectId,
			table.credentialFingerprint,
			table.requestedMode,
			table.sessionGeneration,
			table.resourceReadFence,
			table.resourceEditFence,
		),
		index("idx_crdt_ticket_subject_expiry").on(
			table.subjectId,
			table.expiresAt,
		),
		index("idx_crdt_ticket_resource_expiry").on(
			table.resourceId,
			table.expiresAt,
		),
		check(
			"ck_crdt_ticket_hashes",
			sql`octet_length(${table.secretHash}) = 32 AND octet_length(${table.credentialFingerprint}) = 32`,
		),
		check(
			"ck_crdt_ticket_mode_protocol",
			sql`${table.requestedMode} IN (1, 2) AND ${table.protocolMajor} = 1 AND ${table.protocolMinor} = 0`,
		),
		check(
			"ck_crdt_ticket_state",
			sql`${table.releasedAt} IS NULL OR ${table.redeemedAt} IS NOT NULL`,
		),
	],
);

export const questpieCrdtTicketGrantTable = pgTable(
	"questpie_crdt_ticket_grant",
	{
		ticketId: uuid("ticket_id").notNull(),
		resourceId: uuid("resource_id").notNull(),
		schemaId: uuid("schema_id").notNull(),
		bindingId: uuid("binding_id").notNull(),
		stableFieldId: uuid("stable_field_id").notNull(),
		fieldEpoch: requiredCounter("field_epoch"),
		fieldSlot: integer("field_slot").notNull(),
		formatVersion: integer("format_version").notNull(),
		grant: smallint("grant").notNull(),
		headFieldCursor: requiredCounter("head_field_cursor"),
		fieldReadFence: requiredCounter("field_read_fence"),
		fieldEditFence: requiredCounter("field_edit_fence"),
	},
	(table) => [
		primaryKey({ columns: [table.ticketId, table.bindingId] }),
		foreignKey({
			name: "fk_crdt_ticket_grant_parent",
			columns: [table.ticketId, table.resourceId, table.schemaId],
			foreignColumns: [
				questpieCrdtTicketTable.id,
				questpieCrdtTicketTable.resourceId,
				questpieCrdtTicketTable.schemaId,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_ticket_grant_binding",
			columns: [
				table.resourceId,
				table.bindingId,
				table.schemaId,
				table.stableFieldId,
				table.fieldEpoch,
				table.fieldSlot,
				table.formatVersion,
			],
			foreignColumns: [
				questpieCrdtBindingTable.resourceId,
				questpieCrdtBindingTable.id,
				questpieCrdtBindingTable.schemaId,
				questpieCrdtBindingTable.stableFieldId,
				questpieCrdtBindingTable.fieldEpoch,
				questpieCrdtBindingTable.fieldSlot,
				questpieCrdtBindingTable.formatVersion,
			],
		}).onDelete("restrict"),
		uniqueIndex("uq_crdt_ticket_grant_stable").on(
			table.ticketId,
			table.resourceId,
			table.stableFieldId,
		),
		uniqueIndex("uq_crdt_ticket_grant_exact").on(
			table.ticketId,
			table.resourceId,
			table.schemaId,
			table.bindingId,
			table.stableFieldId,
			table.fieldEpoch,
			table.fieldSlot,
			table.formatVersion,
			table.grant,
			table.headFieldCursor,
			table.fieldReadFence,
			table.fieldEditFence,
		),
		check(
			"ck_crdt_ticket_grant_values",
			sql`${table.fieldSlot} BETWEEN 1 AND 65535 AND ${table.formatVersion} BETWEEN 0 AND 65535 AND ${table.grant} IN (0, 1)`,
		),
	],
);

export const questpieCrdtSessionTable = pgTable(
	"questpie_crdt_session",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		ticketId: uuid("ticket_id").notNull(),
		resourceId: uuid("resource_id").notNull(),
		resourceEpochId: uuid("resource_epoch_id").notNull(),
		schemaId: uuid("schema_id").notNull(),
		subjectId: uuid("subject_id").notNull(),
		credentialFingerprint: hash("credential_fingerprint"),
		requestedMode: smallint("requested_mode").notNull(),
		generation: requiredCounter("generation"),
		resourceReadFence: requiredCounter("resource_read_fence"),
		resourceEditFence: requiredCounter("resource_edit_fence"),
		lastSeenCommitSeq: requiredCounter("last_seen_commit_seq"),
		updateTokens: counter("update_tokens"),
		updateRefilledAt: systemTimestamp("update_refilled_at")
			.defaultNow()
			.notNull(),
		updateByteTokens: counter("update_byte_tokens"),
		updateBytesRefilledAt: systemTimestamp("update_bytes_refilled_at")
			.defaultNow()
			.notNull(),
		awarenessTokens: counter("awareness_tokens"),
		awarenessRefilledAt: systemTimestamp("awareness_refilled_at")
			.defaultNow()
			.notNull(),
		leaseExpiresAt: requiredExpiry("lease_expires_at"),
		closedAt: optionalTime("closed_at"),
		closeReason: smallint("close_reason"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		uniqueIndex("uq_crdt_session_ticket").on(table.ticketId),
		uniqueIndex("uq_crdt_session_resource_id").on(table.id, table.resourceId),
		uniqueIndex("uq_crdt_session_resource_schema").on(
			table.id,
			table.resourceId,
			table.schemaId,
		),
		uniqueIndex("uq_crdt_session_ticket_resource_schema").on(
			table.id,
			table.ticketId,
			table.resourceId,
			table.schemaId,
		),
		uniqueIndex("uq_crdt_session_attribution").on(
			table.id,
			table.resourceId,
			table.resourceEpochId,
			table.subjectId,
		),
		foreignKey({
			name: "fk_crdt_session_ticket",
			columns: [
				table.ticketId,
				table.resourceId,
				table.resourceEpochId,
				table.schemaId,
				table.subjectId,
				table.credentialFingerprint,
				table.requestedMode,
				table.generation,
				table.resourceReadFence,
				table.resourceEditFence,
			],
			foreignColumns: [
				questpieCrdtTicketTable.id,
				questpieCrdtTicketTable.resourceId,
				questpieCrdtTicketTable.resourceEpochId,
				questpieCrdtTicketTable.schemaId,
				questpieCrdtTicketTable.subjectId,
				questpieCrdtTicketTable.credentialFingerprint,
				questpieCrdtTicketTable.requestedMode,
				questpieCrdtTicketTable.sessionGeneration,
				questpieCrdtTicketTable.resourceReadFence,
				questpieCrdtTicketTable.resourceEditFence,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_session_epoch",
			columns: [table.resourceId, table.resourceEpochId],
			foreignColumns: [
				questpieCrdtResourceEpochTable.resourceId,
				questpieCrdtResourceEpochTable.id,
			],
		}).onDelete("restrict"),
		index("idx_crdt_session_subject_lease").on(
			table.subjectId,
			table.leaseExpiresAt,
		),
		index("idx_crdt_session_resource_lease").on(
			table.resourceId,
			table.leaseExpiresAt,
		),
		index("idx_crdt_session_credential_lease").on(
			table.credentialFingerprint,
			table.leaseExpiresAt,
		),
		check(
			"ck_crdt_session_values",
			sql`${table.requestedMode} IN (1, 2) AND ${table.generation} >= 0 AND ${table.lastSeenCommitSeq} >= 0 AND octet_length(${table.credentialFingerprint}) = 32 AND ${table.updateTokens} >= 0 AND ${table.updateByteTokens} >= 0 AND ${table.awarenessTokens} >= 0`,
		),
		check(
			"ck_crdt_session_closed",
			sql`(${table.closedAt} IS NULL AND ${table.closeReason} IS NULL) OR (${table.closedAt} IS NOT NULL AND ${table.closeReason} IS NOT NULL)`,
		),
	],
);

export const questpieCrdtSessionGrantTable = pgTable(
	"questpie_crdt_session_grant",
	{
		sessionId: uuid("session_id").notNull(),
		ticketId: uuid("ticket_id").notNull(),
		resourceId: uuid("resource_id").notNull(),
		schemaId: uuid("schema_id").notNull(),
		bindingId: uuid("binding_id").notNull(),
		stableFieldId: uuid("stable_field_id").notNull(),
		fieldEpoch: requiredCounter("field_epoch"),
		fieldSlot: integer("field_slot").notNull(),
		formatVersion: integer("format_version").notNull(),
		grant: smallint("grant").notNull(),
		headFieldCursor: requiredCounter("head_field_cursor"),
		fieldReadFence: requiredCounter("field_read_fence"),
		fieldEditFence: requiredCounter("field_edit_fence"),
	},
	(table) => [
		primaryKey({ columns: [table.sessionId, table.bindingId] }),
		foreignKey({
			name: "fk_crdt_session_grant_parent",
			columns: [
				table.sessionId,
				table.ticketId,
				table.resourceId,
				table.schemaId,
			],
			foreignColumns: [
				questpieCrdtSessionTable.id,
				questpieCrdtSessionTable.ticketId,
				questpieCrdtSessionTable.resourceId,
				questpieCrdtSessionTable.schemaId,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_session_grant_ticket_grant",
			columns: [
				table.ticketId,
				table.resourceId,
				table.schemaId,
				table.bindingId,
				table.stableFieldId,
				table.fieldEpoch,
				table.fieldSlot,
				table.formatVersion,
				table.grant,
				table.headFieldCursor,
				table.fieldReadFence,
				table.fieldEditFence,
			],
			foreignColumns: [
				questpieCrdtTicketGrantTable.ticketId,
				questpieCrdtTicketGrantTable.resourceId,
				questpieCrdtTicketGrantTable.schemaId,
				questpieCrdtTicketGrantTable.bindingId,
				questpieCrdtTicketGrantTable.stableFieldId,
				questpieCrdtTicketGrantTable.fieldEpoch,
				questpieCrdtTicketGrantTable.fieldSlot,
				questpieCrdtTicketGrantTable.formatVersion,
				questpieCrdtTicketGrantTable.grant,
				questpieCrdtTicketGrantTable.headFieldCursor,
				questpieCrdtTicketGrantTable.fieldReadFence,
				questpieCrdtTicketGrantTable.fieldEditFence,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_session_grant_binding",
			columns: [
				table.resourceId,
				table.bindingId,
				table.schemaId,
				table.stableFieldId,
				table.fieldEpoch,
				table.fieldSlot,
				table.formatVersion,
			],
			foreignColumns: [
				questpieCrdtBindingTable.resourceId,
				questpieCrdtBindingTable.id,
				questpieCrdtBindingTable.schemaId,
				questpieCrdtBindingTable.stableFieldId,
				questpieCrdtBindingTable.fieldEpoch,
				questpieCrdtBindingTable.fieldSlot,
				questpieCrdtBindingTable.formatVersion,
			],
		}).onDelete("restrict"),
		uniqueIndex("uq_crdt_session_grant_stable").on(
			table.sessionId,
			table.resourceId,
			table.stableFieldId,
		),
		check(
			"ck_crdt_session_grant_values",
			sql`${table.fieldSlot} BETWEEN 1 AND 65535 AND ${table.formatVersion} BETWEEN 0 AND 65535 AND ${table.grant} IN (0, 1)`,
		),
	],
);

export const questpieCrdtAwarenessTable = pgTable(
	"questpie_crdt_awareness",
	{
		sessionId: uuid("session_id").primaryKey(),
		resourceId: uuid("resource_id").notNull(),
		activeStableFieldId: uuid("active_stable_field_id"),
		value: jsonb("value").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		expiresAt: requiredExpiry("expires_at"),
		updatedAt: updatedAt(),
	},
	(table) => [
		foreignKey({
			name: "fk_crdt_awareness_session",
			columns: [table.sessionId, table.resourceId],
			foreignColumns: [
				questpieCrdtSessionTable.id,
				questpieCrdtSessionTable.resourceId,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_awareness_active_field",
			columns: [table.sessionId, table.resourceId, table.activeStableFieldId],
			foreignColumns: [
				questpieCrdtSessionGrantTable.sessionId,
				questpieCrdtSessionGrantTable.resourceId,
				questpieCrdtSessionGrantTable.stableFieldId,
			],
		}).onDelete("restrict"),
		index("idx_crdt_awareness_expiry").on(table.resourceId, table.expiresAt),
		check("ck_crdt_awareness_size", sql`${table.sizeBytes} BETWEEN 0 AND 1024`),
	],
);

export const questpieCrdtProjectionTable = pgTable(
	"questpie_crdt_projection",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		resourceId: uuid("resource_id").notNull(),
		resourceEpochId: uuid("resource_epoch_id").notNull(),
		schemaId: uuid("schema_id").notNull(),
		targetCommitSeq: requiredCounter("target_commit_seq"),
		status: smallint("status").default(1).notNull(),
		idempotencyKey: uuid("idempotency_key").notNull(),
		dueAt: requiredExpiry("due_at"),
		attempts: integer("attempts").default(0).notNull(),
		leaseGeneration: requiredCounter("lease_generation"),
		lastErrorCode: smallint("last_error_code"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		foreignKey({
			name: "fk_crdt_projection_commit",
			columns: [
				table.resourceId,
				table.resourceEpochId,
				table.targetCommitSeq,
				table.schemaId,
			],
			foreignColumns: [
				questpieCrdtCommitTable.resourceId,
				questpieCrdtCommitTable.resourceEpochId,
				questpieCrdtCommitTable.commitSeq,
				questpieCrdtCommitTable.schemaId,
			],
		}).onDelete("restrict"),
		uniqueIndex("uq_crdt_projection_target").on(
			table.resourceId,
			table.resourceEpochId,
			table.targetCommitSeq,
		),
		uniqueIndex("uq_crdt_projection_resource_id").on(
			table.id,
			table.resourceId,
			table.schemaId,
		),
		uniqueIndex("uq_crdt_projection_idempotency").on(table.idempotencyKey),
		index("idx_crdt_projection_due").on(table.status, table.dueAt),
		check(
			"ck_crdt_projection_values",
			sql`${table.targetCommitSeq} > 0 AND ${table.status} IN (1, 2, 3, 4, 5) AND ${table.attempts} >= 0 AND ${table.leaseGeneration} >= 0`,
		),
	],
);

export const questpieCrdtProjectionFieldTable = pgTable(
	"questpie_crdt_projection_field",
	{
		projectionId: uuid("projection_id").notNull(),
		resourceId: uuid("resource_id").notNull(),
		schemaId: uuid("schema_id").notNull(),
		bindingId: uuid("binding_id").notNull(),
		stableFieldId: uuid("stable_field_id").notNull(),
		fieldEpoch: requiredCounter("field_epoch"),
		fieldSlot: integer("field_slot").notNull(),
		formatVersion: integer("format_version").notNull(),
		targetFieldCursor: requiredCounter("target_field_cursor"),
		expectedCanonicalHash: hash("expected_canonical_hash"),
		expectedCanonicalRevision: requiredCounter("expected_canonical_revision"),
		shouldWrite: smallint("should_write").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.projectionId, table.bindingId] }),
		foreignKey({
			name: "fk_crdt_projection_field_parent",
			columns: [table.projectionId, table.resourceId, table.schemaId],
			foreignColumns: [
				questpieCrdtProjectionTable.id,
				questpieCrdtProjectionTable.resourceId,
				questpieCrdtProjectionTable.schemaId,
			],
		}).onDelete("restrict"),
		foreignKey({
			name: "fk_crdt_projection_field_binding",
			columns: [
				table.resourceId,
				table.bindingId,
				table.schemaId,
				table.stableFieldId,
				table.fieldEpoch,
				table.fieldSlot,
				table.formatVersion,
			],
			foreignColumns: [
				questpieCrdtBindingTable.resourceId,
				questpieCrdtBindingTable.id,
				questpieCrdtBindingTable.schemaId,
				questpieCrdtBindingTable.stableFieldId,
				questpieCrdtBindingTable.fieldEpoch,
				questpieCrdtBindingTable.fieldSlot,
				questpieCrdtBindingTable.formatVersion,
			],
		}).onDelete("restrict"),
		check(
			"ck_crdt_projection_field_values",
			sql`${table.fieldSlot} BETWEEN 1 AND 65535 AND ${table.formatVersion} BETWEEN 0 AND 65535 AND ${table.targetFieldCursor} >= 0 AND ${table.expectedCanonicalRevision} >= 0 AND ${table.shouldWrite} IN (0, 1) AND octet_length(${table.expectedCanonicalHash}) = 32`,
		),
	],
);

export const questpieCrdtLeaseTable = pgTable(
	"questpie_crdt_lease",
	{
		resourceId: uuid("resource_id")
			.notNull()
			.references(() => questpieCrdtResourceTable.id, {
				onDelete: "restrict",
			}),
		kind: smallint("kind").notNull(),
		ownerId: text("owner_id").notNull(),
		generation: requiredCounter("generation"),
		expiresAt: requiredExpiry("expires_at"),
		updatedAt: updatedAt(),
	},
	(table) => [
		primaryKey({ columns: [table.resourceId, table.kind] }),
		index("idx_crdt_lease_expiry").on(table.expiresAt),
		check("ck_crdt_lease_kind", sql`${table.kind} IN (1, 2, 3)`),
		check(
			"ck_crdt_lease_values",
			sql`${table.generation} >= 0 AND octet_length(${table.ownerId}) BETWEEN 1 AND 256`,
		),
	],
);

export const questpieCrdtTables = Object.freeze({
	questpie_crdt_namespace: questpieCrdtNamespaceTable,
	questpie_crdt_definition: questpieCrdtDefinitionTable,
	questpie_crdt_schema: questpieCrdtSchemaTable,
	questpie_crdt_schema_field: questpieCrdtSchemaFieldTable,
	questpie_crdt_subject: questpieCrdtSubjectTable,
	questpie_crdt_resource: questpieCrdtResourceTable,
	questpie_crdt_resource_epoch: questpieCrdtResourceEpochTable,
	questpie_crdt_binding: questpieCrdtBindingTable,
	questpie_crdt_commit: questpieCrdtCommitTable,
	questpie_crdt_schema_compatibility: questpieCrdtSchemaCompatibilityTable,
	questpie_crdt_schema_compatibility_field:
		questpieCrdtSchemaCompatibilityFieldTable,
	questpie_crdt_update: questpieCrdtUpdateTable,
	questpie_crdt_update_receipt: questpieCrdtUpdateReceiptTable,
	questpie_crdt_receipt_field: questpieCrdtReceiptFieldTable,
	questpie_crdt_snapshot_manifest: questpieCrdtSnapshotManifestTable,
	questpie_crdt_snapshot: questpieCrdtSnapshotTable,
	questpie_crdt_recovery_hold: questpieCrdtRecoveryHoldTable,
	questpie_crdt_subject_fence: questpieCrdtSubjectFenceTable,
	questpie_crdt_subject_admission: questpieCrdtSubjectAdmissionTable,
	questpie_crdt_credential_admission: questpieCrdtCredentialAdmissionTable,
	questpie_crdt_resource_admission: questpieCrdtResourceAdmissionTable,
	questpie_crdt_ticket: questpieCrdtTicketTable,
	questpie_crdt_ticket_grant: questpieCrdtTicketGrantTable,
	questpie_crdt_session: questpieCrdtSessionTable,
	questpie_crdt_session_grant: questpieCrdtSessionGrantTable,
	questpie_crdt_awareness: questpieCrdtAwarenessTable,
	questpie_crdt_projection: questpieCrdtProjectionTable,
	questpie_crdt_projection_field: questpieCrdtProjectionFieldTable,
	questpie_crdt_lease: questpieCrdtLeaseTable,
});
