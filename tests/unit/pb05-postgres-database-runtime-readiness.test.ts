import { expect, test } from "bun:test";

import {
	type ReadinessMigration,
	verifyPostgresDatabaseReadinessPrerequisites,
} from "../../packages/runtime/src/application/postgres-readiness-prerequisites";
import {
	transactionBrand,
	type PostgresStatement,
	type PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres";

const checksum = "a".repeat(64);
const migrations: readonly ReadinessMigration[] = Object.freeze([
	Object.freeze({
		identity: "000001_create-collaboration",
		sequence: 1,
		parent: null,
		checksum,
	}),
]);

function runner(
	resolve: (statement: PostgresStatement<unknown, unknown>) => unknown,
	observed: { transactions: number; names: string[] },
): PostgresTransactionRunner {
	return {
		async transaction(input) {
			observed.transactions += 1;
			expect(input.mode).toEqual({
				isolation: "repeatableRead",
				access: "readOnly",
			});
			return input.use({
				[transactionBrand]: true,
				async execute(statement: PostgresStatement<unknown, unknown>, _value) {
					observed.names.push(statement.name);
					const rows = resolve(statement);
					const raw = Array.isArray(rows) ? rows : [];
					return statement.decode({
						command: "SELECT",
						rowCount: raw.length,
						rows: raw,
					}) as never;
				},
			});
		},
	};
}

test("verifies protocol, binding, and receipts in one static read-only snapshot", async () => {
	const observed = { transactions: 0, names: [] as string[] };
	const database = runner((statement) => {
		if (statement.name === "readiness.protocol.v6") return [[6, checksum]];
		if (statement.name === "readiness.application-binding")
			return [["application:collaboration", "collaboration"]];
		if (statement.name === "readiness.migration-receipts")
			return [["000001_create-collaboration", 1, null, checksum]];
		throw new Error(`unexpected statement ${statement.name}`);
	}, observed);

	await verifyPostgresDatabaseReadinessPrerequisites({
		database,
		protocol: { version: 6, checksum },
		application: "application:collaboration",
		postgresSchema: "collaboration",
		migrationHead: "000001_create-collaboration",
		committedMigrations: migrations,
	});

	expect(observed).toEqual({
		transactions: 1,
		names: [
			"readiness.protocol.v6",
			"readiness.application-binding",
			"readiness.migration-receipts",
		],
	});
});

test("closed decoders refuse malformed protocol and receipt rows", async () => {
	for (const malformed of [
		{ name: "readiness.protocol.v6", rows: [["6", checksum]] },
		{
			name: "readiness.migration-receipts",
			rows: [["000001_create-collaboration", 0, null, checksum]],
		},
	] as const) {
		const observed = { transactions: 0, names: [] as string[] };
		const database = runner((statement) => {
			if (statement.name === malformed.name) return malformed.rows;
			if (statement.name === "readiness.protocol.v6") return [[6, checksum]];
			if (statement.name === "readiness.application-binding")
				return [["application:collaboration", "collaboration"]];
			return [["000001_create-collaboration", 1, null, checksum]];
		}, observed);
		await expect(
			verifyPostgresDatabaseReadinessPrerequisites({
				database,
				protocol: { version: 6, checksum },
				application: "application:collaboration",
				postgresSchema: "collaboration",
				migrationHead: "000001_create-collaboration",
				committedMigrations: migrations,
			}),
		).rejects.toThrow("invalid PostgreSQL readiness");
	}
});

test("binding and receipt mismatches fail closed", async () => {
	for (const changedName of [
		"readiness.application-binding",
		"readiness.migration-receipts",
	]) {
		const observed = { transactions: 0, names: [] as string[] };
		const database = runner((statement) => {
			if (statement.name === "readiness.protocol.v6") return [[6, checksum]];
			if (statement.name === "readiness.application-binding")
				return changedName === statement.name
					? [["application:other", "other"]]
					: [["application:collaboration", "collaboration"]];
			return changedName === statement.name
				? [["000001_create-collaboration", 1, null, "b".repeat(64)]]
				: [["000001_create-collaboration", 1, null, checksum]];
		}, observed);
		await expect(
			verifyPostgresDatabaseReadinessPrerequisites({
				database,
				protocol: { version: 6, checksum },
				application: "application:collaboration",
				postgresSchema: "collaboration",
				migrationHead: "000001_create-collaboration",
				committedMigrations: migrations,
			}),
		).rejects.toThrow("does not match Runtime Build");
	}
});

test("rejects a forged expected version and an installed pre-v6 protocol", async () => {
	const forgedObserved = { transactions: 0, names: [] as string[] };
	await expect(
		verifyPostgresDatabaseReadinessPrerequisites({
			database: runner(() => [[6, checksum]], forgedObserved),
			protocol: { version: 5, checksum } as never,
			application: "application:collaboration",
			postgresSchema: "collaboration",
			migrationHead: "000001_create-collaboration",
			committedMigrations: migrations,
		}),
	).rejects.toThrow("expected PostgreSQL readiness protocol must be v6");
	expect(forgedObserved.transactions).toBe(0);

	const installedObserved = { transactions: 0, names: [] as string[] };
	await expect(
		verifyPostgresDatabaseReadinessPrerequisites({
			database: runner(() => [[5, checksum]], installedObserved),
			protocol: { version: 6, checksum },
			application: "application:collaboration",
			postgresSchema: "collaboration",
			migrationHead: "000001_create-collaboration",
			committedMigrations: migrations,
		}),
	).rejects.toThrow("questpie_internal protocol v6 is not installed");
});
