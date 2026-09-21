// White-box tests against packages/questpie/src/testing/index.ts by relative
// import (not a public-surface proof; see
// public-testing-surface-consumer.test.ts for that). Covers ADR-0045 review
// follow-ups: FORCE-drop teardown and dispose idempotence/retry, the
// database reaper, the migrated-template clone path, and runQuestpieCli's
// timeout.
import { afterAll, expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { SQL } from "bun";
import { Client } from "pg";

import {
	createIsolatedApplicationDatabase,
	createMigratedTemplateDatabase,
	createTestDatabase,
	createTestDatabaseFromTemplate,
	reapTestDatabases,
	runQuestpieCli,
} from "../../../packages/questpie/src/testing/index";
import { buildDatabaseName } from "../../../packages/questpie/src/testing/internal";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/collaboration");
const admin = process.env.PGHOST ? new SQL({ max: 4 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;

function adminConnectionUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

async function databaseExists(name: string): Promise<boolean> {
	const [row] = await admin!.unsafe<Readonly<{ exists: boolean }>[]>(
		`SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1) AS exists`,
		[name],
	);
	return row?.exists === true;
}

afterAll(async () => {
	await admin?.close({ timeout: 0 });
});

postgresTest(
	"dispose drops the database with FORCE and is idempotent; a failed dispose can be retried",
	async () => {
		const database = await createTestDatabase({
			adminConnectionUrl: adminConnectionUrl(),
			namePrefix: "questpie_testing_dispose",
		});
		expect(await databaseExists(database.databaseName)).toBe(true);

		// An open connection would make a plain DROP DATABASE fail; WITH
		// (FORCE) must succeed anyway instead of racing a manual terminate step.
		const holder = new Client({ connectionString: database.connectionUrl });
		// FORCE will terminate this connection out from under it; that is the
		// scenario under test, not an unexpected failure — swallow the
		// resulting "error" event instead of letting it crash the test run.
		holder.on("error", () => {});
		await holder.connect();
		await database.dispose();
		expect(await databaseExists(database.databaseName)).toBe(false);
		await holder.end().catch(() => {});

		// Idempotent: calling dispose again on an already-dropped database is a
		// silent no-op, not an error.
		await expect(database.dispose()).resolves.toBeUndefined();
	},
	30_000,
);

postgresTest(
	"dispose() latches only after a successful DROP, verified by forcing a real failure and retrying",
	async () => {
		const database = await createTestDatabase({
			adminConnectionUrl: adminConnectionUrl(),
			namePrefix: "questpie_testing_retry",
		});
		// Force a real, deterministic DROP DATABASE failure that WITH (FORCE)
		// cannot bypass: an in-progress two-phase-commit prepared transaction
		// against the target database. If the server disables prepared
		// transactions (max_prepared_transactions = 0, a common default),
		// skip the forced-failure half and only prove the happy path — still
		// real coverage, just not of the failure branch on this server.
		const preparer = new Client({ connectionString: database.connectionUrl });
		await preparer.connect();
		let canPrepare = true;
		try {
			await preparer.query("BEGIN");
			await preparer.query("CREATE TABLE reap_probe (id int)");
			await preparer.query("PREPARE TRANSACTION 'questpie_testing_retry_txn'");
		} catch {
			canPrepare = false;
			await preparer.query("ROLLBACK").catch(() => {});
		} finally {
			await preparer.end();
		}

		if (canPrepare) {
			await expect(database.dispose()).rejects.toThrow();
			expect(await databaseExists(database.databaseName)).toBe(true);
			const resolver = new Client({
				connectionString: database.connectionUrl,
			});
			await resolver.connect();
			try {
				await resolver.query("ROLLBACK PREPARED 'questpie_testing_retry_txn'");
			} finally {
				await resolver.end();
			}
		}

		// Whether or not the forced-failure half ran, the same handle's
		// dispose() must still succeed once nothing blocks it — proving
		// disposed was never latched by the earlier failed (or skipped)
		// attempt.
		await expect(database.dispose()).resolves.toBeUndefined();
		expect(await databaseExists(database.databaseName)).toBe(false);
	},
	30_000,
);

postgresTest(
	"reapTestDatabases drops only its own prefix's databases older than the cutoff",
	async () => {
		const namePrefix = "questpie_testing_reaper";
		const freshName = buildDatabaseName(namePrefix);
		// Hand-craft a name with the same shape but an old embedded timestamp
		// (1 hour ago) so the reaper's age filter has something to match
		// without waiting an hour in the test.
		const oldCreatedAt = (Date.now() - 60 * 60_000).toString(36);
		const staleName = `${namePrefix}_${oldCreatedAt}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
		const otherPrefixName = `questpie_testing_reaper_other_${oldCreatedAt}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
		for (const name of [freshName, staleName]) {
			await admin!.unsafe(
				`CREATE DATABASE "${name}" WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'`,
			);
		}
		// A database that merely shares a text prefix but does not belong to
		// "questpie_testing_reaper" (validateNamePrefix would reject
		// "questpie_testing_reaper_other" as a namePrefix passed to reap, so
		// build it directly) must never be touched.
		await admin!.unsafe(
			`CREATE DATABASE "${otherPrefixName}" WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'`,
		);
		try {
			const result = await reapTestDatabases({
				adminConnectionUrl: adminConnectionUrl(),
				namePrefix,
				olderThanMinutes: 30,
			});
			expect(result.dropped).toContain(staleName);
			expect(result.dropped).not.toContain(freshName);
			expect(result.dropped).not.toContain(otherPrefixName);
			expect(result.failed).toEqual([]);
			expect(await databaseExists(staleName)).toBe(false);
			expect(await databaseExists(freshName)).toBe(true);
			expect(await databaseExists(otherPrefixName)).toBe(true);
		} finally {
			await admin!.unsafe(
				`DROP DATABASE IF EXISTS "${freshName}" WITH (FORCE)`,
			);
			await admin!.unsafe(
				`DROP DATABASE IF EXISTS "${otherPrefixName}" WITH (FORCE)`,
			);
			await admin!.unsafe(
				`DROP DATABASE IF EXISTS "${staleName}" WITH (FORCE)`,
			);
		}
	},
	30_000,
);

postgresTest(
	"createMigratedTemplateDatabase + createTestDatabaseFromTemplate clone without replaying migrations",
	async () => {
		// `seed apply` needs the application's generated schema projection, so
		// build a disposable copy first rather than writing build output into
		// the committed fixture directory.
		const applicationRoot = await mkdtemp(
			join(tmpdir(), "questpie-testing-template-"),
		);
		await cp(fixtureRoot, applicationRoot, { recursive: true });
		await runQuestpieCli({ applicationRoot, arguments: ["build"] });
		const template = await createMigratedTemplateDatabase({
			adminConnectionUrl: adminConnectionUrl(),
			applicationRoot,
			namePrefix: "questpie_testing_template",
			seed: true,
		});
		try {
			const clone = await createTestDatabaseFromTemplate({
				adminConnectionUrl: adminConnectionUrl(),
				template,
				namePrefix: "questpie_testing_clone",
			});
			try {
				const client = new Client({ connectionString: clone.connectionUrl });
				await client.connect();
				try {
					const seeded = await client.query(
						"SELECT count(*)::int AS count FROM collaboration.companies",
					);
					expect(seeded.rows[0]?.count).toBeGreaterThan(0);
				} finally {
					await client.end();
				}
			} finally {
				await clone.dispose();
			}
		} finally {
			await template.dispose();
			await rm(applicationRoot, { recursive: true, force: true });
		}
	},
	60_000,
);

postgresTest(
	"runQuestpieCli kills a child that runs past timeoutMilliseconds",
	async () => {
		await expect(
			runQuestpieCli({
				applicationRoot: fixtureRoot,
				arguments: ["check"],
				timeoutMilliseconds: 1,
			}),
		).rejects.toThrow(/did not exit within 1ms and was killed/);
	},
	30_000,
);

postgresTest(
	"createIsolatedApplicationDatabase creates a database matching the application's declared collation",
	async () => {
		const database = await createIsolatedApplicationDatabase({
			adminConnectionUrl: adminConnectionUrl(),
			applicationRoot: fixtureRoot,
			namePrefix: "questpie_testing_collation",
			seed: false,
		});
		try {
			const [row] = await admin!.unsafe<
				Readonly<{ datcollate: string; datctype: string }>[]
			>(
				"SELECT datcollate, datctype FROM pg_catalog.pg_database WHERE datname = $1",
				[database.databaseName],
			);
			expect(row).toMatchObject({
				datcollate: "C.UTF-8",
				datctype: "C.UTF-8",
			});
		} finally {
			await database.dispose();
		}
	},
	30_000,
);
