import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { createPostgresCommandConnection } from "../../../../packages/compiler/src/postgres-session";

const connectionString = process.env.DATABASE_URL!;
const url = new URL(connectionString);
const expected = process.env.PROBE_DATABASE!;
const before = JSON.stringify(process.env);
const database = createPostgresCommandConnection(connectionString);
let stage = "identity";
try {
	const [row] = await database`SELECT current_database() AS database,
    current_user AS actor, current_setting('application_name') AS application`;
	const targetCorrect = row.database === expected;
	const userCorrect = row.actor === decodeURIComponent(url.username);
	const queryPreserved =
		row.application === url.searchParams.get("application_name");
	// This SELECT-only guard is deliberately before any migration or Seed DDL.
	if (!targetCorrect || !userCorrect || !queryPreserved)
		throw new Error("explicit connection target mismatch");
	if (process.env.PROBE_APPLY === "true") {
		stage = "artifacts";
		const api = await import("../../../../packages/compiler/src");
		const fixture = resolve(
			import.meta.dir,
			"../../../../fixtures/collaboration/questpie",
		);
		const migrations = await Promise.all(
			(await readdir(resolve(fixture, "migrations")))
				.sort()
				.map((name) =>
					api.loadCommittedMigration(resolve(fixture, "migrations", name)),
				),
		);
		const seeds = await Promise.all(
			(await readdir(resolve(fixture, "seeds")))
				.sort()
				.map((name) => api.loadCommittedSeed(resolve(fixture, "seeds", name))),
		);
		const schema = migrations.at(-1)!.targetSchema;
		stage = "migration";
		const applied = await api.applyCommittedMigrations({
			connectionString,
			migrations,
		});
		if (applied.applied.length !== migrations.length)
			throw new Error("migration not applied");
		const [target] =
			await database`SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = ${schema.application.postgresSchema}) AS applied`;
		if (!target.applied) throw new Error("migration escaped target");
		const migrationReplay = await api.applyCommittedMigrations({
			connectionString,
			migrations,
		});
		if (
			migrationReplay.applied.length !== 0 ||
			migrationReplay.status !== "alreadyApplied"
		)
			throw new Error("migration replay changed");
		stage = "seed";
		const seeded = await api.applyCommittedSeeds({
			connectionString,
			schema,
			seeds,
		});
		if (seeded.applied.length !== seeds.length)
			throw new Error("Seed not applied");
		stage = "fingerprint";
		await api.inspectSchemaFingerprint({ connectionString, schema });
		stage = "replay";
		const replay = await api.applyCommittedSeeds({
			connectionString,
			schema,
			seeds,
		});
		if (
			replay.applied.length !== 0 ||
			replay.alreadyApplied.length !== seeds.length
		)
			throw new Error("Seed replay changed");
	}
	console.log(
		JSON.stringify({
			targetCorrect,
			userCorrect,
			queryPreserved,
			environmentUnchanged: before === JSON.stringify(process.env),
		}),
	);
} catch {
	console.log(JSON.stringify({ failed: true, stage }));
	process.exitCode = 1;
} finally {
	await database.close();
}
