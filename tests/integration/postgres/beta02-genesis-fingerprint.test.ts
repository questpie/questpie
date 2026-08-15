import { afterAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { SQL } from "bun";

const admin = process.env.PGHOST ? new SQL() : undefined;
const inspectorPath = resolve(
	import.meta.dir,
	"helpers/inspect-genesis-fingerprint.ts",
);

afterAll(async () => {
	await admin?.close();
});

describe.skipIf(!admin)("BETA-02 PostgreSQL Genesis fingerprint", () => {
	test("inspects a truly fresh database as canonical unbound Genesis", async () => {
		await withFreshDatabase("unbound", async (databaseName, database) => {
			const [namespaces] = await database<
				{ application: boolean; database: string; internal: boolean }[]
			>`
				select pg_catalog.to_regnamespace('genesis_probe') is not null as application,
				       current_database() as database,
				       pg_catalog.to_regnamespace('questpie_internal') is not null as internal
			`;
			expect(namespaces).toEqual({
				application: false,
				database: databaseName,
				internal: false,
			});

			const inspected = await inspectFreshDatabase(databaseName);
			expect(inspected).toEqual({
				ok: true,
				comparable: {
					application: "genesis-probe",
					applicationSchema: "genesis_probe",
					applicationSchemaExists: false,
					objects: [],
					unsupportedObjects: [],
					externalDependencies: [],
					installedRequiredExtensions: [],
				},
			});
		});
	});

	test("rejects an existing application namespace without a binding catalog", async () => {
		await withFreshDatabase(
			"existing_namespace",
			async (databaseName, database) => {
				await database.unsafe('create schema "genesis_probe"');
				const [internal] = await database<{ exists: boolean }[]>`
					select pg_catalog.to_regnamespace('questpie_internal') is not null as exists
				`;
				expect(internal?.exists).toBe(false);

				await expect(inspectFreshDatabase(databaseName)).resolves.toEqual({
					ok: false,
					code: "QP-SCHEMA-029",
					diagnosticClass: "applicationBindingMismatch",
				});
			},
		);
	});
});

async function withFreshDatabase(
	suffix: string,
	run: (databaseName: string, database: SQL) => Promise<void>,
): Promise<void> {
	const databaseName = `qp_genesis_${process.pid}_${suffix}`;
	await admin!.unsafe(`drop database if exists "${databaseName}" with (force)`);
	await admin!.unsafe(
		`create database "${databaseName}" template template0 encoding 'UTF8' lc_collate 'C.UTF-8' lc_ctype 'C.UTF-8'`,
	);
	const database = freshDatabase(databaseName);
	try {
		await run(databaseName, database);
	} finally {
		await database.close();
		await admin!.unsafe(`drop database "${databaseName}" with (force)`);
	}
}

function freshDatabase(database: string): SQL {
	return new SQL({
		database,
		hostname: process.env.PGHOST,
		password: process.env.PGPASSWORD ?? "",
		port: Number(process.env.PGPORT ?? "5432"),
		username: process.env.PGUSER,
	});
}

async function inspectFreshDatabase(
	databaseName: string,
): Promise<Record<string, unknown>> {
	const subprocess = Bun.spawn([process.execPath, inspectorPath], {
		env: { ...process.env, PGDATABASE: databaseName },
		stderr: "pipe",
		stdout: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		subprocess.exited,
		new Response(subprocess.stdout).text(),
		new Response(subprocess.stderr).text(),
	]);
	if (exitCode !== 0)
		throw new Error(`Genesis fingerprint inspector failed: ${stderr.trim()}`);
	return JSON.parse(stdout) as Record<string, unknown>;
}
