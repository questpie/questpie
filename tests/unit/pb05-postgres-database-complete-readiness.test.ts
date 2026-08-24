import { expect, test } from "bun:test";

import { verifyPostgresDatabaseRuntimeReadiness } from "../../packages/compiler/src/runtime/postgres-readiness";
import { internalProtocolV6Checksum } from "../../packages/compiler/src/schema";
import type { SchemaProjectionV1 } from "../../packages/compiler/src/schema";
import { verifyPostgresDatabaseReadinessPrerequisites } from "../../packages/runtime/src/application/postgres-readiness-prerequisites";
import {
	definePostgresStatement,
	verifyPostgresDatabaseReadinessPrerequisitesInOwnedTransaction,
} from "../../packages/runtime/src/bundle-core";
import {
	transactionBrand,
	type PostgresStatement,
	type PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres";

const application = "application:collaboration";
const postgresSchema = "collaboration";
const migrationChecksum = "a".repeat(64);
const triggerCatalog = Object.freeze([
	Object.freeze({
		table: "messages",
		name: "messages_questpie_capture_row",
		type: 29,
		argumentsHex: "726f77",
		functionSchema: "questpie_internal" as const,
		functionName: "capture_reactive_row" as const,
		securityDefiner: true as const,
		functionConfiguration: Object.freeze([
			"search_path=pg_catalog, questpie_internal",
		]),
		enabled: "O" as const,
		ownerMatches: true as const,
	}),
	Object.freeze({
		table: "messages",
		name: "messages_questpie_capture_truncate",
		type: 32,
		argumentsHex: "7472756e63617465",
		functionSchema: "questpie_internal" as const,
		functionName: "capture_reactive_truncate" as const,
		securityDefiner: true as const,
		functionConfiguration: Object.freeze([
			"search_path=pg_catalog, questpie_internal",
		]),
		enabled: "O" as const,
		ownerMatches: true as const,
	}),
]);
const schema = Object.freeze({
	format: "questpie.schema-projection" as const,
	version: 1 as const,
	application: Object.freeze({ name: application, postgresSchema }),
	requiredPostgres: Object.freeze({
		minimumMajor: 17,
		databaseCollation: "C.UTF-8",
		databaseCType: "C.UTF-8",
		extensions: Object.freeze([Object.freeze({ name: "pgcrypto" })]),
	}),
	collections: Object.freeze([
		Object.freeze({
			identity: "collection:messages",
			postgresName: "messages",
			fields: Object.freeze([]),
			constraints: Object.freeze([]),
			relations: Object.freeze([]),
			indexes: Object.freeze([]),
		}),
	]),
	changeCapture: Object.freeze({
		version: 1 as const,
		applicationName: application,
		postgresSchema,
		collections: Object.freeze([
			Object.freeze({
				identity: "collection:messages",
				postgresName: "messages",
				keyColumns: Object.freeze(["id"]),
				rowTrigger: "messages_questpie_capture_row",
				truncateTrigger: "messages_questpie_capture_truncate",
			}),
		]),
		triggerCatalog,
		fingerprint: "b".repeat(64),
		sql: "",
	}),
}) satisfies SchemaProjectionV1;

const rowsByStatement: Readonly<
	Record<string, readonly (readonly unknown[])[]>
> = Object.freeze({
	"readiness.protocol.v6": [[6, internalProtocolV6Checksum]],
	"readiness.application-binding": [[application, postgresSchema]],
	"readiness.migration-receipts": [
		["000001_create-collaboration", 1, null, migrationChecksum],
	],
	"readiness.fingerprint.provider": [
		["17.5", "C.UTF-8", "C.UTF-8", "UTF8", "c", true],
	],
	"readiness.fingerprint.extensions": [["pgcrypto", "1.3"]],
	"readiness.catalog.search-path": [],
	"readiness.catalog.namespace": [[true]],
	"readiness.catalog.binding-catalog": [[true]],
	"readiness.catalog.application-bindings": [[application, postgresSchema]],
	"catalog.relations": [["messages", "r", false, "p", "d", false, false]],
	"catalog.columns": [],
	"catalog.constraints": [],
	"catalog.indexes": [],
	"catalog.index-terms": [],
	"readiness.catalog.unsupported": triggerCatalog.map((trigger) => [
		"trigger",
		`${postgresSchema}.${trigger.table}.${trigger.name}`,
		`${postgresSchema}.${trigger.table}`,
	]),
	"readiness.change-capture": triggerCatalog.map((trigger) => [
		trigger.table,
		trigger.name,
		trigger.type,
		trigger.argumentsHex,
		trigger.functionSchema,
		trigger.functionName,
		trigger.securityDefiner,
		trigger.functionConfiguration,
		trigger.enabled,
		trigger.ownerMatches,
	]),
});

function readinessInput(database: PostgresTransactionRunner) {
	return {
		database,
		runtime: {
			definePostgresStatement,
			verifyReadinessPrerequisites:
				verifyPostgresDatabaseReadinessPrerequisitesInOwnedTransaction,
		},
		schema,
		committedMigrations: {
			format: "questpie.committed-migrations",
			version: 1,
			head: "000001_create-collaboration",
			migrations: [
				{
					identity: "000001_create-collaboration",
					sequence: 1,
					parent: null,
					checksum: migrationChecksum,
				},
			],
		},
		expected: {
			migrationHead: "000001_create-collaboration",
			schemaFingerprint:
				"c7c18c2af6e19cbfe3d18b89a7fc84bc54d6a4d6589c64d329799fd265c7ab0f",
		},
	} as const;
}

type Observed = {
	transactions: number;
	commits: number;
	modes: unknown[];
	names: string[];
	parameters: unknown[][];
	statements: PostgresStatement<unknown, unknown>[];
};

function observations(): Observed {
	return {
		transactions: 0,
		commits: 0,
		modes: [],
		names: [],
		parameters: [],
		statements: [],
	};
}

function fakeDatabase(
	rowsByName: Readonly<Record<string, readonly (readonly unknown[])[]>>,
	observed: Observed,
): PostgresTransactionRunner {
	return {
		async transaction(input) {
			observed.transactions += 1;
			observed.modes.push(input.mode);
			const value = await input.use({
				[transactionBrand]: true,
				async execute(statement: PostgresStatement<unknown, unknown>, value) {
					observed.statements.push(statement);
					observed.names.push(statement.name);
					observed.parameters.push([...statement.parameters(value)]);
					const rows = rowsByName[statement.name];
					if (!rows) throw new Error(`unexpected statement ${statement.name}`);
					return statement.decode({
						command:
							statement.name === "readiness.catalog.search-path"
								? "SET"
								: "SELECT",
						rowCount: rows.length,
						rows,
					}) as never;
				},
			});
			observed.commits += 1;
			return value;
		},
	};
}

test("compiler database readiness owns one complete fixed snapshot", async () => {
	const prerequisiteObserved = observations();
	await verifyPostgresDatabaseReadinessPrerequisites({
		database: fakeDatabase(rowsByStatement, prerequisiteObserved),
		protocol: { version: 6, checksum: internalProtocolV6Checksum },
		application,
		postgresSchema,
		migrationHead: "000001_create-collaboration",
		committedMigrations: [
			{
				identity: "000001_create-collaboration",
				sequence: 1,
				parent: null,
				checksum: migrationChecksum,
			},
		],
	});
	const observed = observations();
	const database = fakeDatabase(rowsByStatement, observed);

	await verifyPostgresDatabaseRuntimeReadiness(readinessInput(database));

	expect(observed.transactions).toBe(1);
	expect(observed.commits).toBe(1);
	expect(observed.modes).toEqual([
		{ isolation: "repeatableRead", access: "readOnly" },
	]);
	expect(observed.names).toEqual([
		"readiness.protocol.v6",
		"readiness.application-binding",
		"readiness.migration-receipts",
		"readiness.fingerprint.provider",
		"readiness.fingerprint.extensions",
		"readiness.catalog.search-path",
		"readiness.catalog.namespace",
		"readiness.catalog.binding-catalog",
		"readiness.catalog.application-bindings",
		"catalog.relations",
		"catalog.columns",
		"catalog.constraints",
		"catalog.indexes",
		"catalog.index-terms",
		"readiness.catalog.unsupported",
		"readiness.change-capture",
	]);
	for (const [index, statement] of prerequisiteObserved.statements.entries())
		expect(observed.statements[index]).toBe(statement);
	expect(observed.parameters).toEqual([
		[],
		[application, postgresSchema],
		[application],
		[],
		[["pgcrypto"]],
		[],
		[postgresSchema],
		[],
		[application, postgresSchema],
		...[[], [], [], [], []].map(() => [postgresSchema]),
		[postgresSchema],
		[postgresSchema, ["messages"]],
	]);
});

test("compiler database readiness closes descriptor rows and preserves diagnostics", async () => {
	const malformedObserved = observations();
	await expect(
		verifyPostgresDatabaseRuntimeReadiness(
			readinessInput(
				fakeDatabase(
					{
						...rowsByStatement,
						"readiness.fingerprint.provider": [
							["17.5", "C.UTF-8", "C.UTF-8", "UTF8", "c", "true"],
						],
					},
					malformedObserved,
				),
			),
		),
	).rejects.toThrow("invalid PostgreSQL database readiness provider result");
	expect(malformedObserved.commits).toBe(0);

	const diagnosticObserved = observations();
	const changedCapture = rowsByStatement["readiness.change-capture"]!.map(
		(row, index) =>
			index === 0 ? [row[0], "changed_trigger", ...row.slice(2)] : row,
	);
	await expect(
		verifyPostgresDatabaseRuntimeReadiness(
			readinessInput(
				fakeDatabase(
					{
						...rowsByStatement,
						"readiness.change-capture": changedCapture,
					},
					diagnosticObserved,
				),
			),
		),
	).rejects.toMatchObject({
		code: "QP-SCHEMA-028",
		diagnosticClass: "changedObject",
	});
	expect(diagnosticObserved.commits).toBe(1);
});

test("compiler database readiness preserves cancellation and validates before checkout", async () => {
	const cancellation = new DOMException("readiness cancelled", "AbortError");
	const cancelled: PostgresTransactionRunner = {
		transaction: () => Promise.reject(cancellation),
	};
	await expect(
		verifyPostgresDatabaseRuntimeReadiness(readinessInput(cancelled)),
	).rejects.toBe(cancellation);

	let transactions = 0;
	const invalid = readinessInput({
		transaction: () => {
			transactions += 1;
			return Promise.reject(new Error("must not begin"));
		},
	});
	await expect(
		verifyPostgresDatabaseRuntimeReadiness({
			...invalid,
			committedMigrations: {
				...invalid.committedMigrations,
				head: null,
			},
		}),
	).rejects.toThrow("committed migration head is invalid");
	expect(transactions).toBe(0);
});
