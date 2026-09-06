import { SQL } from "bun";
import { Client } from "pg";

import { ensureInternalProtocolV8 } from "../../packages/compiler/src/schema/postgres/internal-protocol-v8";
import { internalProtocolV9CheckpointSql } from "../../packages/compiler/src/schema/postgres/internal-protocol-v9-checkpoint-sql";
import { internalProtocolV9ScheduleSql } from "../../packages/compiler/src/schema/postgres/internal-protocol-v9-schedule-sql";

const name = `qp_schedule_catalog_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = new Client({ database: "postgres" });
await admin.connect();
let created = false;
let database: SQL | undefined;
try {
	await admin.query(`CREATE DATABASE "${name}"`);
	created = true;
	database = new SQL({ database: name, max: 1 });
	const [env] =
		await database`SELECT current_database() AS name, current_setting('server_version_num')::int AS version, pg_backend_pid() AS pid`;
	if (env.name !== name || env.version < 170000 || env.version >= 180000)
		throw new Error("candidate requires its owned PostgreSQL 17 database");
	await ensureInternalProtocolV8(database, name, env.pid, {
		statementTimeoutMs: 10000,
		lockTimeoutMs: 2000,
	});
	await database.unsafe(
		internalProtocolV9ScheduleSql + internalProtocolV9CheckpointSql,
	);
	const columns =
		await database`select c.relname, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='questpie_internal' and (c.relname like 'schedule_%' or c.relname='mutation_checkpoints') and c.relkind='r' and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum`;
	const constraints =
		await database`select c.relname, con.conname, con.contype::text, pg_get_constraintdef(con.oid,true) from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='questpie_internal' and (c.relname like 'schedule_%' or c.relname='mutation_checkpoints' or con.conname='durable_run_failure_code_known') and con.contype<>'n' order by c.relname,con.conname`;
	const indexes =
		await database`select t.relname, i.relname as indexname, am.amname, x.indisunique, x.indisprimary, pg_get_indexdef(i.oid) from pg_index x join pg_class i on i.oid=x.indexrelid join pg_class t on t.oid=x.indrelid join pg_namespace n on n.oid=t.relnamespace join pg_am am on am.oid=i.relam where n.nspname='questpie_internal' and (t.relname like 'schedule_%' or t.relname='mutation_checkpoints') order by t.relname,i.relname`;
	const parts = [
		["columns", columns],
		["constraints", constraints],
		["indexes", indexes],
	] as const;
	console.log("*** Begin Patch");
	for (const [kind, rows] of parts) {
		const title = kind[0]!.toUpperCase() + kind.slice(1);
		console.log(
			`*** Add File: packages/compiler/src/schema/postgres/internal-protocol-v9-${kind}.ts`,
		);
		const source = `/** Candidate protocol delta generated from its isolated PostgreSQL 17 catalog. */\nexport const internalProtocolV9${title} = ${JSON.stringify(
			rows.map((row) => Object.values(row)),
			null,
			"\t",
		)} as const;\n`;
		console.log(
			source
				.trimEnd()
				.split("\n")
				.map((line) => `+${line}`)
				.join("\n"),
		);
	}
	console.log("*** End Patch");
} finally {
	await database?.close({ timeout: 2 });
	if (created) await admin.query(`DROP DATABASE "${name}"`);
	await admin.end();
}
