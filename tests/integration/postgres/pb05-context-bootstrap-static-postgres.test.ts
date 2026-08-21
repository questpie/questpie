import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";

import { SQL } from "bun";

import {
	applyCommittedMigrations,
	compileApplication,
	loadCommittedMigration,
} from "@questpie/compiler";

const postgresTest = process.env.PGHOST ? test : test.skip;
const fixtureRoot = resolve(import.meta.dir, "../../../fixtures/collaboration");
const admin = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;

const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const sensitiveName = "pb05-sensitive-company-name";

function postgresUrl(): string {
	const url = new URL("postgres://localhost/postgres");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.href;
}

beforeAll(async () => {
	if (!admin) return;
	await admin.unsafe(
		'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
	);
	const migration = await loadCommittedMigration(
		resolve(fixtureRoot, "questpie/migrations/000001_create-collaboration"),
	);
	const applied = await applyCommittedMigrations({ migrations: [migration] });
	if (applied.status !== "applied")
		throw new Error(`failed to apply PB-05 migration: ${applied.status}`);
	await admin`
		insert into collaboration.companies (id, name)
		values (${companyId}, ${sensitiveName})
	`;
});

afterAll(async () => {
	await admin?.close();
});

postgresTest(
	"does not return an unselected ContextBootstrap value across the PG17 driver boundary",
	async () => {
		const compilation = await compileApplication({
			applicationRoot: fixtureRoot,
		});
		const {
			executeLinkedPostgresContextBootstrap,
			linkPostgresContextBootstrapPlans,
		} =
			await import("../../../packages/runtime/src/relational/context-bootstrap-database");
		const { createPostgresDatabase } =
			await import("../../../packages/runtime/src/postgres");
		const artifact =
			compilation.generatedFiles["postgres-context-bootstrap-plans.json"]!;
		const envelope = JSON.parse(artifact);
		const linked = linkPostgresContextBootstrapPlans({
			artifact,
			schemaProjection: JSON.parse(
				compilation.generatedFiles["schema-projection.json"]!,
			),
			expectedDigest: envelope.digest,
		});
		const company = linked.get("collection:companies")!;
		const key = { id: companyId };
		const nameIndex = company.plan.fields.findIndex(
			(field) => field.key === "name",
		);
		expect(nameIndex).toBeGreaterThanOrEqual(0);

		const selectedRows = await admin!.unsafe(
			company.plan.sql,
			company.statement.parameters({ key, select: { name: true } }),
		);
		expect(JSON.stringify(selectedRows)).toContain(sensitiveName);

		const unselectedRows = await admin!.unsafe(
			company.plan.sql,
			company.statement.parameters({ key, select: { id: true } }),
		);
		const rawRow = unselectedRows[0] as Readonly<Record<string, unknown>>;
		expect(rawRow[`qp_selected_${nameIndex}`]).toBe(false);
		expect(rawRow[`qp_value_${nameIndex}`]).toBeNull();
		expect(JSON.stringify(unselectedRows)).not.toContain(sensitiveName);

		const database = createPostgresDatabase({
			connectionUrl: postgresUrl(),
			directConnectionUrl: postgresUrl(),
			pool: {
				max: 1,
				connectTimeoutMs: 1_000,
				checkoutTimeoutMs: 1_000,
				idleTimeoutMs: 1_000,
				maxLifetimeSeconds: 60,
			},
			timeouts: {
				statementMs: 1_000,
				lockMs: 500,
				idleInTransactionMs: 1_000,
			},
		});
		try {
			const result = await executeLinkedPostgresContextBootstrap(
				database,
				company,
				{ key, select: { id: true } },
			);
			expect(result).toEqual({ id: companyId });
			expect(JSON.stringify(result)).not.toContain(sensitiveName);
		} finally {
			await database.close({ deadlineAt: Date.now() + 2_000 });
		}
	},
);
