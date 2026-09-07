import { expect, test } from "bun:test";
import { resolve } from "node:path";

import pg from "pg";

import { expectPostgresMajor } from "./helpers/postgres-major";

const postgresTest = process.env.PGHOST ? test.serial : test.skip;

postgresTest(
	"explicit compiler connection URL owns migration, Seed and fingerprint targets despite inherited PG settings",
	async () => {
		const name = `qp_target_${crypto.randomUUID().replaceAll("-", "")}`;
		const decoyName = `qp_decoy_${crypto.randomUUID().replaceAll("-", "")}`;
		const admin = new pg.Client({ database: "postgres" });
		let owned = false;
		let decoyOwned = false;
		try {
			await admin.connect();
			const identity = await admin.query(
				"SELECT current_database() AS database, current_setting('server_version_num') AS version",
			);
			expect(identity.rows[0].database === "postgres").toBe(true);
			expectPostgresMajor(identity.rows[0].version);
			await admin.query(
				`CREATE DATABASE "${name}" TEMPLATE template0 LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'`,
			);
			owned = true;
			await admin.query(
				`CREATE DATABASE "${decoyName}" TEMPLATE template0 LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'`,
			);
			decoyOwned = true;
			const url = new URL("postgres://localhost/");
			url.hostname = process.env.PGHOST!;
			url.port = process.env.PGPORT ?? "5432";
			url.username = process.env.PGUSER ?? "postgres";
			if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
			// Percent-encoded database paths must resolve to the named target.
			url.pathname = `/%71${name.slice(1)}`;
			url.searchParams.set("sslmode", "disable");
			url.searchParams.set("application_name", "compiler-target-proof");
			for (const hostile of [
				{ PGDATABASE: "postgres" },
				{
					PG_DATABASE: "postgres",
					PGDATABASE: "postgres",
					PGHOST: "127.0.0.2",
					PGPORT: "1",
					PGUSER: "absent_probe_role",
				},
			]) {
				const child = Bun.spawn(
					[
						process.execPath,
						resolve(import.meta.dir, "helpers/compiler-connection-child.ts"),
					],
					{
						env: {
							...process.env,
							...hostile,
							DATABASE_URL: url.toString(),
							PROBE_DATABASE: name,
							PROBE_APPLY: "false",
						},
						stdout: "pipe",
						stderr: "pipe",
					},
				);
				const output = JSON.parse(await new Response(child.stdout).text());
				expect(await child.exited).toBe(0);
				expect(output).toEqual({
					targetCorrect: true,
					userCorrect: true,
					queryPreserved: true,
					environmentUnchanged: true,
				});
			}
			const apply = Bun.spawn(
				[
					process.execPath,
					resolve(import.meta.dir, "helpers/compiler-connection-child.ts"),
				],
				{
					env: {
						...process.env,
						PG_DATABASE: decoyName,
						PGDATABASE: decoyName,
						DATABASE_URL: url.toString(),
						PROBE_DATABASE: name,
						PROBE_APPLY: "true",
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const output = JSON.parse(await new Response(apply.stdout).text());
			expect(output).toEqual({
				targetCorrect: true,
				userCorrect: true,
				queryPreserved: true,
				environmentUnchanged: true,
			});
			expect(await apply.exited).toBe(0);
		} finally {
			if (owned) await admin.query(`DROP DATABASE "${name}"`);
			if (decoyOwned) await admin.query(`DROP DATABASE "${decoyName}"`);
			await admin.end();
		}
	},
	60000,
);
