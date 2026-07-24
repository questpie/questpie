import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";

import { DrizzleMigrationGenerator } from "../../../src/server/migration/generator.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtCommitTable,
	questpieCrdtRecoveryHoldTable,
	questpieCrdtResourceTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtSchemaTable,
	questpieCrdtSnapshotManifestTable,
	questpieCrdtSnapshotTable,
	questpieCrdtTables,
	questpieCrdtUpdateReceiptTable,
	questpieCrdtUpdateTable,
} from "../../../src/server/modules/core/integrated/crdt/schema.js";
import { buildMockApp } from "../../utils/mocks/mock-app-builder.js";

const REQUIRED_TABLES = [
	"questpie_crdt_namespace",
	"questpie_crdt_definition",
	"questpie_crdt_schema",
	"questpie_crdt_schema_field",
	"questpie_crdt_resource",
	"questpie_crdt_resource_epoch",
	"questpie_crdt_binding",
	"questpie_crdt_schema_compatibility",
	"questpie_crdt_schema_compatibility_field",
	"questpie_crdt_commit",
	"questpie_crdt_update",
	"questpie_crdt_update_receipt",
	"questpie_crdt_receipt_field",
	"questpie_crdt_snapshot_manifest",
	"questpie_crdt_snapshot",
	"questpie_crdt_recovery_hold",
	"questpie_crdt_subject",
	"questpie_crdt_ticket",
	"questpie_crdt_ticket_grant",
	"questpie_crdt_session",
	"questpie_crdt_session_grant",
	"questpie_crdt_subject_fence",
	"questpie_crdt_subject_admission",
	"questpie_crdt_credential_admission",
	"questpie_crdt_resource_admission",
	"questpie_crdt_awareness",
	"questpie_crdt_projection",
	"questpie_crdt_projection_field",
	"questpie_crdt_lease",
] as const;

describe("CRDT durable schema", () => {
	it("declares the complete framework-owned namespace", () => {
		expect(Object.keys(questpieCrdtTables).sort()).toEqual(
			[...REQUIRED_TABLES].sort(),
		);
	});

	it("keeps recovery tables in app schema even without active owners", async () => {
		const { app, cleanup } = await buildMockApp({});
		try {
			const schema = app.getSchema();
			for (const tableName of REQUIRED_TABLES) {
				expect(schema).toHaveProperty(tableName);
			}
		} finally {
			await cleanup();
		}
	}, 30_000);

	it("keeps exact aggregate, field, receipt, and snapshot identities", () => {
		expect(primaryKeyColumns(questpieCrdtCommitTable)).toContain(
			"resource_id,resource_epoch_id,commit_seq",
		);
		expect(primaryKeyColumns(questpieCrdtUpdateTable)).toContain(
			"resource_id,resource_epoch_id,commit_seq,field_slot",
		);
		expect(uniqueIndexColumns(questpieCrdtUpdateTable)).toContain(
			"binding_id,field_epoch,field_cursor",
		);
		expect(uniqueIndexColumns(questpieCrdtUpdateReceiptTable)).toContain(
			"resource_id,resource_epoch_id,update_id",
		);
		expect(primaryKeyColumns(questpieCrdtSnapshotTable)).toContain(
			"manifest_id,binding_id",
		);
		expect(uniqueIndexColumns(questpieCrdtSchemaTable)).toEqual(
			expect.arrayContaining([
				"definition_id,schema_version",
				"definition_id,schema_fingerprint",
			]),
		);
	});

	it("has one current incarnation and one complete published recovery basis", () => {
		expect(indexNames(questpieCrdtResourceTable)).toContain(
			"uq_crdt_resource_current_locator",
		);
		expect(indexNames(questpieCrdtResourceEpochTable)).toContain(
			"uq_crdt_resource_epoch_current",
		);
		expect(indexNames(questpieCrdtBindingTable)).toEqual(
			expect.arrayContaining([
				"uq_crdt_binding_resource_slot",
				"uq_crdt_binding_current_path",
			]),
		);
		expect(indexNames(questpieCrdtSnapshotManifestTable)).toContain(
			"idx_crdt_manifest_verified_cut",
		);
		expect(foreignKeyNames(questpieCrdtResourceTable)).toContain(
			"fk_crdt_resource_current_epoch",
		);
		expect(foreignKeyNames(questpieCrdtResourceEpochTable)).toEqual(
			expect.arrayContaining([
				"fk_crdt_epoch_current_manifest",
				"fk_crdt_epoch_previous_manifest",
			]),
		);
		expect(foreignKeyNames(questpieCrdtRecoveryHoldTable)).toContain(
			"fk_crdt_recovery_hold_binding",
		);
	});

	it("never cascade-deletes durable recovery or idempotency state", () => {
		for (const table of Object.values(questpieCrdtTables)) {
			const cascades = getTableConfig(table).foreignKeys.filter(
				(foreignKey) => foreignKey.onDelete === "cascade",
			);
			expect(cascades).toHaveLength(0);
		}
	});

	it("generates the complete migration once and produces no second diff", async () => {
		const directory = mkdtempSync(join(tmpdir(), "questpie-crdt-schema-"));
		try {
			const generator = new DrizzleMigrationGenerator();
			const first = await generator.generateMigration({
				migrationName: "crdtSchemaFirst",
				fileBaseName: "20260724_crdt_schema",
				schema: questpieCrdtTables,
				migrationDir: directory,
			});
			expect(first.skipped).toBe(false);
			const source = readFileSync(
				join(directory, "20260724_crdt_schema.ts"),
				"utf8",
			);
			expect(source).toContain('CREATE TABLE "questpie_crdt_resource_epoch"');
			expect(source).toContain('CONSTRAINT "fk_crdt_update_commit"');
			expect(source).toContain('CONSTRAINT "fk_crdt_update_binding"');
			expect(source).toContain(
				'CREATE UNIQUE INDEX "uq_crdt_resource_current_locator"',
			);

			const second = await generator.generateMigration({
				migrationName: "crdtSchemaSecond",
				fileBaseName: "20260724_crdt_schema_no_diff",
				schema: questpieCrdtTables,
				migrationDir: directory,
			});
			expect(second.skipped).toBe(true);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 30_000);
});

function primaryKeyColumns(
	table: Parameters<typeof getTableConfig>[0],
): string[] {
	return getTableConfig(table).primaryKeys.map((key) =>
		key.columns.map((column) => column.name).join(","),
	);
}

function uniqueIndexColumns(
	table: Parameters<typeof getTableConfig>[0],
): string[] {
	return getTableConfig(table)
		.indexes.filter((index) => index.config.unique)
		.map((index) =>
			index.config.columns
				.map((column) => ("name" in column ? column.name : "<expression>"))
				.join(","),
		);
}

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
	return getTableConfig(table).indexes.map((index) => index.config.name!);
}

function foreignKeyNames(
	table: Parameters<typeof getTableConfig>[0],
): string[] {
	return getTableConfig(table).foreignKeys.map((foreignKey) =>
		foreignKey.getName(),
	);
}
