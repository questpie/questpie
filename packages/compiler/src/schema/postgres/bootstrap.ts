import { createHash } from "node:crypto";

import { SQL } from "bun";

import { canonicalBytes, compareAscii } from "../../canonical";
import {
	acquireSessionLock,
	assertBackendPid,
	lockKey,
	withPinnedTransaction,
} from "../../postgres-session";
import type { PostgresControl } from "../../postgres-session";
import { fail } from "./shared";

const bootstrapSql = `CREATE SCHEMA IF NOT EXISTS questpie_internal AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA questpie_internal FROM PUBLIC;

CREATE TABLE IF NOT EXISTS questpie_internal.protocol (
  singleton boolean PRIMARY KEY,
  version integer NOT NULL,
  checksum text NOT NULL,
  CONSTRAINT protocol_singleton_true CHECK (singleton),
  CONSTRAINT protocol_checksum_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS questpie_internal.application_bindings (
  application_name text PRIMARY KEY,
  postgres_schema text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS questpie_internal.schema_migration_receipts (
  application_name text NOT NULL,
  migration_identity text NOT NULL,
  sequence integer NOT NULL,
  parent_identity text,
  checksum text NOT NULL,
  base_schema_digest text NOT NULL,
  target_schema_digest text NOT NULL,
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (application_name, migration_identity),
  UNIQUE (application_name, sequence),
  CONSTRAINT migration_sequence_positive CHECK (sequence > 0),
  CONSTRAINT migration_checksum_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_base_digest_sha256 CHECK (base_schema_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_target_digest_sha256 CHECK (target_schema_digest ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS questpie_internal.seed_receipts (
  application_name text NOT NULL,
  seed_identity text NOT NULL,
  checksum text NOT NULL,
  applied_schema_digest text NOT NULL,
  committed_at timestamptz NOT NULL,
  attempt_id uuid NOT NULL,
  PRIMARY KEY (application_name, seed_identity),
  CONSTRAINT seed_checksum_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT seed_applied_digest_sha256 CHECK (applied_schema_digest ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS questpie_internal.seed_attempt_events (
  application_name text NOT NULL,
  attempt_id uuid NOT NULL,
  sequence smallint NOT NULL,
  seed_identity text NOT NULL,
  checksum text NOT NULL,
  event text NOT NULL,
  occurred_at timestamptz NOT NULL,
  error_code text,
  PRIMARY KEY (application_name, attempt_id, sequence),
  CONSTRAINT seed_attempt_sequence_nonnegative CHECK (sequence >= 0),
  CONSTRAINT seed_attempt_checksum_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT seed_attempt_event_known CHECK (
    event IN ('started', 'succeeded', 'failed', 'interrupted', 'alreadyApplied', 'blocked')
  )
);

REVOKE ALL ON ALL TABLES IN SCHEMA questpie_internal FROM PUBLIC;
`;

const bootstrapChecksum = createHash("sha256")
	.update("questpie-internal-bootstrap-v1\0")
	.update(bootstrapSql)
	.digest("hex");

const bootstrapColumns = [
	["application_bindings", "application_name", "text", true],
	["application_bindings", "postgres_schema", "text", true],
	["application_bindings", "created_at", "timestamp with time zone", true],
	["protocol", "singleton", "boolean", true],
	["protocol", "version", "integer", true],
	["protocol", "checksum", "text", true],
	["schema_migration_receipts", "application_name", "text", true],
	["schema_migration_receipts", "migration_identity", "text", true],
	["schema_migration_receipts", "sequence", "integer", true],
	["schema_migration_receipts", "parent_identity", "text", false],
	["schema_migration_receipts", "checksum", "text", true],
	["schema_migration_receipts", "base_schema_digest", "text", true],
	["schema_migration_receipts", "target_schema_digest", "text", true],
	["schema_migration_receipts", "applied_at", "timestamp with time zone", true],
	["seed_attempt_events", "application_name", "text", true],
	["seed_attempt_events", "attempt_id", "uuid", true],
	["seed_attempt_events", "sequence", "smallint", true],
	["seed_attempt_events", "seed_identity", "text", true],
	["seed_attempt_events", "checksum", "text", true],
	["seed_attempt_events", "event", "text", true],
	["seed_attempt_events", "occurred_at", "timestamp with time zone", true],
	["seed_attempt_events", "error_code", "text", false],
	["seed_receipts", "application_name", "text", true],
	["seed_receipts", "seed_identity", "text", true],
	["seed_receipts", "checksum", "text", true],
	["seed_receipts", "applied_schema_digest", "text", true],
	["seed_receipts", "committed_at", "timestamp with time zone", true],
	["seed_receipts", "attempt_id", "uuid", true],
] as const;

const bootstrapConstraints = [
	[
		"application_bindings",
		"application_bindings_pkey",
		"p",
		"PRIMARY KEY (application_name)",
	],
	[
		"application_bindings",
		"application_bindings_postgres_schema_key",
		"u",
		"UNIQUE (postgres_schema)",
	],
	[
		"protocol",
		"protocol_checksum_sha256",
		"c",
		"CHECK (checksum ~ '^[0-9a-f]{64}$'::text)",
	],
	["protocol", "protocol_pkey", "p", "PRIMARY KEY (singleton)"],
	["protocol", "protocol_singleton_true", "c", "CHECK (singleton)"],
	[
		"schema_migration_receipts",
		"migration_base_digest_sha256",
		"c",
		"CHECK (base_schema_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"schema_migration_receipts",
		"migration_checksum_sha256",
		"c",
		"CHECK (checksum ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"schema_migration_receipts",
		"migration_sequence_positive",
		"c",
		"CHECK (sequence > 0)",
	],
	[
		"schema_migration_receipts",
		"migration_target_digest_sha256",
		"c",
		"CHECK (target_schema_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"schema_migration_receipts",
		"schema_migration_receipts_application_name_sequence_key",
		"u",
		"UNIQUE (application_name, sequence)",
	],
	[
		"schema_migration_receipts",
		"schema_migration_receipts_pkey",
		"p",
		"PRIMARY KEY (application_name, migration_identity)",
	],
	[
		"seed_attempt_events",
		"seed_attempt_checksum_sha256",
		"c",
		"CHECK (checksum ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"seed_attempt_events",
		"seed_attempt_event_known",
		"c",
		"CHECK (event = ANY (ARRAY['started'::text, 'succeeded'::text, 'failed'::text, 'interrupted'::text, 'alreadyApplied'::text, 'blocked'::text]))",
	],
	[
		"seed_attempt_events",
		"seed_attempt_events_pkey",
		"p",
		"PRIMARY KEY (application_name, attempt_id, sequence)",
	],
	[
		"seed_attempt_events",
		"seed_attempt_sequence_nonnegative",
		"c",
		"CHECK (sequence >= 0)",
	],
	[
		"seed_receipts",
		"seed_applied_digest_sha256",
		"c",
		"CHECK (applied_schema_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"seed_receipts",
		"seed_checksum_sha256",
		"c",
		"CHECK (checksum ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"seed_receipts",
		"seed_receipts_pkey",
		"p",
		"PRIMARY KEY (application_name, seed_identity)",
	],
] as const;

const bootstrapIndexes = [
	[
		"application_bindings",
		"application_bindings_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX application_bindings_pkey ON questpie_internal.application_bindings USING btree (application_name)",
	],
	[
		"application_bindings",
		"application_bindings_postgres_schema_key",
		"btree",
		true,
		false,
		"CREATE UNIQUE INDEX application_bindings_postgres_schema_key ON questpie_internal.application_bindings USING btree (postgres_schema)",
	],
	[
		"protocol",
		"protocol_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX protocol_pkey ON questpie_internal.protocol USING btree (singleton)",
	],
	[
		"schema_migration_receipts",
		"schema_migration_receipts_application_name_sequence_key",
		"btree",
		true,
		false,
		"CREATE UNIQUE INDEX schema_migration_receipts_application_name_sequence_key ON questpie_internal.schema_migration_receipts USING btree (application_name, sequence)",
	],
	[
		"schema_migration_receipts",
		"schema_migration_receipts_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX schema_migration_receipts_pkey ON questpie_internal.schema_migration_receipts USING btree (application_name, migration_identity)",
	],
	[
		"seed_attempt_events",
		"seed_attempt_events_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX seed_attempt_events_pkey ON questpie_internal.seed_attempt_events USING btree (application_name, attempt_id, sequence)",
	],
	[
		"seed_receipts",
		"seed_receipts_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX seed_receipts_pkey ON questpie_internal.seed_receipts USING btree (application_name, seed_identity)",
	],
] as const;

async function verifyBootstrapCatalog(sql: SQL): Promise<void> {
	const [namespace] = await sql<
		{
			publicPrivileges: boolean;
		}[]
	>`
		select pg_catalog.has_schema_privilege('public', n.oid, 'USAGE')
		       or pg_catalog.has_schema_privilege('public', n.oid, 'CREATE') as "publicPrivileges"
		from pg_catalog.pg_namespace n
		where n.nspname = 'questpie_internal'
	`;
	const tables = await sql<
		{
			name: string;
			ownerMatches: boolean;
			publicPrivileges: boolean;
		}[]
	>`
		select c.relname as name,
		       c.relowner = n.nspowner as "ownerMatches",
		       pg_catalog.has_table_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as "publicPrivileges"
		from pg_catalog.pg_class c
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = 'questpie_internal' and c.relkind = 'r'
		order by c.relname
	`;
	const columns = await sql<
		{
			table: string;
			name: string;
			type: string;
			notNull: boolean;
		}[]
	>`
		select c.relname as table,
		       a.attname as name,
		       pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
		       a.attnotnull as "notNull"
		from pg_catalog.pg_attribute a
		join pg_catalog.pg_class c on c.oid = a.attrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = 'questpie_internal' and c.relkind = 'r'
		  and a.attnum > 0 and not a.attisdropped
		order by c.relname, a.attnum
	`;
	const constraints = await sql<
		{ table: string; name: string; type: string; definition: string }[]
	>`
		select c.relname as table,
		       con.conname as name,
		       con.contype::text as type,
		       pg_catalog.pg_get_constraintdef(con.oid, true) as definition
		from pg_catalog.pg_constraint con
		join pg_catalog.pg_class c on c.oid = con.conrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = 'questpie_internal'
		  and con.contype <> 'n'
		order by c.relname, con.conname
	`;
	const notNullConstraints = await sql<
		{
			table: string;
			field: string | null;
			fieldCount: number;
			validated: boolean;
			local: boolean;
			inheritedCount: number;
			noInherit: boolean;
		}[]
	>`
		select c.relname as table,
		       a.attname as field,
		       cardinality(con.conkey)::integer as "fieldCount",
		       con.convalidated as validated,
		       con.conislocal as local,
		       con.coninhcount::integer as "inheritedCount",
		       con.connoinherit as "noInherit"
		from pg_catalog.pg_constraint con
		join pg_catalog.pg_class c on c.oid = con.conrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		left join pg_catalog.pg_attribute a
		  on a.attrelid = con.conrelid
		 and cardinality(con.conkey) = 1
		 and a.attnum = con.conkey[1]
		where n.nspname = 'questpie_internal' and con.contype = 'n'
		order by c.relname, a.attname nulls first, con.conname
	`;
	const indexes = await sql<
		{
			table: string;
			name: string;
			method: string;
			unique: boolean;
			primary: boolean;
			definition: string;
			ownerMatches: boolean;
		}[]
	>`
		select t.relname as table,
		       i.relname as name,
		       am.amname as method,
		       x.indisunique as unique,
		       x.indisprimary as primary,
		       pg_catalog.pg_get_indexdef(i.oid) as definition,
		       i.relowner = n.nspowner as "ownerMatches"
		from pg_catalog.pg_index x
		join pg_catalog.pg_class i on i.oid = x.indexrelid
		join pg_catalog.pg_class t on t.oid = x.indrelid
		join pg_catalog.pg_namespace n on n.oid = t.relnamespace
		join pg_catalog.pg_am am on am.oid = i.relam
		where n.nspname = 'questpie_internal'
		order by t.relname, i.relname
	`;
	const expectedTables = [
		"application_bindings",
		"protocol",
		"schema_migration_receipts",
		"seed_attempt_events",
		"seed_receipts",
	];
	const notNullColumns = columns
		.filter((column) => column.notNull)
		.map((column) => [column.table, column.name])
		.sort((left, right) =>
			compareAscii(canonicalBytes(left), canonicalBytes(right)),
		);
	const validNotNullConstraints =
		notNullConstraints.length === 0 ||
		(notNullConstraints.every(
			(constraint) =>
				constraint.field !== null &&
				constraint.fieldCount === 1 &&
				constraint.validated &&
				constraint.local &&
				constraint.inheritedCount === 0 &&
				!constraint.noInherit,
		) &&
			canonicalBytes(
				notNullConstraints.map((constraint) => [
					constraint.table,
					constraint.field,
				]),
			) === canonicalBytes(notNullColumns));
	if (
		!namespace ||
		namespace.publicPrivileges ||
		canonicalBytes(tables.map((table) => table.name)) !==
			canonicalBytes(expectedTables) ||
		tables.some((table) => !table.ownerMatches || table.publicPrivileges) ||
		!validNotNullConstraints ||
		canonicalBytes(
			columns.map((column) => [
				column.table,
				column.name,
				column.type,
				column.notNull,
			]),
		) !== canonicalBytes(bootstrapColumns) ||
		canonicalBytes(
			constraints.map((constraint) => [
				constraint.table,
				constraint.name,
				constraint.type,
				constraint.definition,
			]),
		) !== canonicalBytes(bootstrapConstraints) ||
		indexes.some((index) => !index.ownerMatches) ||
		canonicalBytes(
			indexes.map((index) => [
				index.table,
				index.name,
				index.method,
				index.unique,
				index.primary,
				index.definition,
			]),
		) !== canonicalBytes(bootstrapIndexes)
	)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie.internal.v1 catalog shape, ownership, or privileges changed",
		);
	const [protocol] = await sql<{ version: number; checksum: string }[]>`
		select version, checksum
		from questpie_internal.protocol
		where singleton = true
	`;
	if (protocol?.version !== 1 || protocol.checksum !== bootstrapChecksum)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie.internal.v1 protocol is missing or changed",
		);
}

export async function bootstrap(
	sql: SQL,
	databaseName: string,
	expectedPid: number,
	control: PostgresControl,
	signal?: AbortSignal,
): Promise<void> {
	const key = lockKey("questpie-bootstrap-lock-v1", databaseName);
	await assertBackendPid(sql, expectedPid, "before bootstrap lock");
	await acquireSessionLock(sql, key, control, signal);
	try {
		await assertBackendPid(sql, expectedPid, "after bootstrap lock");
		const [state] = await sql<{ exists: boolean }[]>`
			select exists(select 1 from pg_catalog.pg_namespace where nspname = 'questpie_internal') as exists
		`;
		if (!state?.exists) {
			await withPinnedTransaction(
				sql,
				expectedPid,
				"bootstrap transaction",
				signal,
				async (transaction) => {
					await transaction.unsafe(bootstrapSql);
					await transaction`
					insert into questpie_internal.protocol
					(singleton, version, checksum)
					values (true, 1, ${bootstrapChecksum})
				`;
					await verifyBootstrapCatalog(transaction);
				},
			);
		} else await verifyBootstrapCatalog(sql);
	} finally {
		await assertBackendPid(sql, expectedPid, "bootstrap unlock");
		await sql`select pg_catalog.pg_advisory_unlock(${key})`;
	}
}

export { bootstrapChecksum, bootstrapSql };
