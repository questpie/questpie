import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";

import { backendPid } from "../../../packages/compiler/src/postgres-session";
import {
	ensureInternalProtocolV3,
	ensureInternalProtocolV2,
	internalProtocolV3Checksum,
	projectPostgresChangeCapture,
	verifyInternalProtocolV3,
	verifyPostgresChangeCapture,
} from "../../../packages/compiler/src/schema";

const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const control = { lockTimeoutMs: 1_000, statementTimeoutMs: 10_000 } as const;
const writerRole = `questpie_beta07_writer_${process.env.QUESTPIE_POSTGRES_MAJOR ?? "local"}`;
const projection = projectPostgresChangeCapture({
	applicationName: "collaboration",
	postgresSchema: "collaboration",
	collections: [
		{
			identity: "collection:channels",
			postgresName: "channels",
			keyColumns: ["id"],
		},
		{
			identity: "collection:messages",
			postgresName: "messages",
			keyColumns: ["id"],
		},
	],
});

async function ensure(sql: SQL): Promise<void> {
	const [current] = await sql<
		{ name: string }[]
	>`select current_database() as name`;
	await ensureInternalProtocolV3(
		sql,
		current!.name,
		await backendPid(sql),
		control,
	);
}

async function ensureV2(sql: SQL): Promise<void> {
	const [current] = await sql<
		{ name: string }[]
	>`select current_database() as name`;
	await ensureInternalProtocolV2(
		sql,
		current!.name,
		await backendPid(sql),
		control,
	);
}

async function installApplicationSchema(sql: SQL): Promise<void> {
	await sql.unsafe(`CREATE SCHEMA collaboration;
CREATE TABLE collaboration.channels (
  id text PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE collaboration.messages (
  id text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES collaboration.channels(id) ON DELETE CASCADE,
  body text NOT NULL
);`);
	await sql.unsafe(projection.sql);
}

async function expectPostgresDenied(
	query: PromiseLike<unknown>,
): Promise<void> {
	await expectPostgresError(query, "42501");
}

async function expectPostgresError(
	query: PromiseLike<unknown>,
	errno: string,
): Promise<void> {
	let rejected: unknown;
	try {
		await query;
	} catch (error) {
		rejected = error;
	}
	expect(rejected).toMatchObject({ errno });
}

beforeEach(async () => {
	await database?.unsafe(`DROP SCHEMA IF EXISTS collaboration CASCADE;
DROP SCHEMA IF EXISTS questpie_internal CASCADE;
DROP ROLE IF EXISTS ${writerRole};`);
});

afterAll(async () => {
	await database?.unsafe(`DROP SCHEMA IF EXISTS collaboration CASCADE;
DROP SCHEMA IF EXISTS questpie_internal CASCADE;
DROP ROLE IF EXISTS ${writerRole};`);
	await database?.close({ timeout: 0 });
});

describe.skipIf(!database)(
	"BETA-07 internal protocol v3 and Change Ledger capture",
	() => {
		postgresTest(
			"installs and verifies one exact v3 catalog from a fresh database",
			async () => {
				await ensure(database!);
				await verifyInternalProtocolV3(database!);
				const [protocol] = await database!<
					{ version: number; checksum: string }[]
				>`
			select version, checksum from questpie_internal.protocol where singleton = true
		`;
				expect(protocol).toEqual({
					version: 3,
					checksum: internalProtocolV3Checksum,
				});
				const tables = await database!<{ name: string }[]>`
			select c.relname as name
			from pg_catalog.pg_class c
			join pg_catalog.pg_namespace n on n.oid = c.relnamespace
			where n.nspname = 'questpie_internal' and c.relkind = 'r'
			order by c.relname
		`;
				const tableNames = tables.map(({ name }) => name);
				for (const name of [
					"change_ledger",
					"observed_dependency_plans",
					"processed_change_facts",
					"realtime_scope_attachments",
					"realtime_watch_bindings",
					"reconciliation_consumers",
					"retained_live_query_results",
				])
					expect(tableNames).toContain(name);

				await database!.unsafe(
					"ALTER TABLE questpie_internal.change_ledger ALTER COLUMN conservative SET DEFAULT true",
				);
				await expect(verifyInternalProtocolV3(database!)).rejects.toMatchObject(
					{ code: "QP-SCHEMA-023" },
				);
				await database!.unsafe(
					"ALTER TABLE questpie_internal.change_ledger ALTER COLUMN conservative SET DEFAULT false",
				);
				await verifyInternalProtocolV3(database!);
				await database!
					.unsafe(`CREATE OR REPLACE FUNCTION questpie_internal.capture_reactive_row()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, questpie_internal AS $$
BEGIN
  RETURN NULL;
END;
$$;`);
				await expect(verifyInternalProtocolV3(database!)).rejects.toMatchObject(
					{ code: "QP-SCHEMA-023" },
				);
			},
		);

		postgresTest(
			"upgrades immutable v2 and enforces no-affinity Principal watch state",
			async () => {
				await ensureV2(database!);
				await ensure(database!);
				await verifyInternalProtocolV3(database!);

				const openedAt = new Date("2026-08-16T00:00:00.000Z");
				const expiresAt = new Date(openedAt.getTime() + 30_000);
				const deployment = "a".repeat(64);
				const authority = "b".repeat(64);
				await database!`
					insert into questpie_internal.realtime_scope_attachments
					(application_name, scope_identity, deployment_digest,
					 authority_partition_digest, principal_kind, principal_id,
					 opened_at, renewed_at, expires_at, state)
					values ('collaboration', 'scope:one', ${deployment}, null,
					        'user', 'user:one', ${openedAt}, ${openedAt}, ${expiresAt}, 'attached')
				`;
				await database!`
					update questpie_internal.realtime_scope_attachments
					set authority_partition_digest = ${authority}, state = 'open'
					where application_name = 'collaboration' and scope_identity = 'scope:one'
					  and principal_kind = 'user' and principal_id = 'user:one'
					  and state = 'attached' and authority_partition_digest is null
				`;
				await expectPostgresError(
					database!`
						insert into questpie_internal.realtime_watch_bindings
						(application_name, scope_identity, binding_identity,
						 deployment_digest, authority_partition_digest, principal_kind,
						 principal_id, active_slot, query_identity, query_bytes,
						 input_bytes, context_input_bytes, opened_at, state)
						values ('collaboration', 'scope:one', 'binding:mismatched-context',
						        ${deployment}, ${"d".repeat(64)}, 'user', 'user:one', 1,
						        'messages.page', 'query'::bytea, '{}'::bytea, '{}'::bytea,
						        ${openedAt}, 'open')
					`,
					"23503",
				);
				await database!`
					insert into questpie_internal.realtime_watch_bindings
					(application_name, scope_identity, binding_identity,
					 deployment_digest, authority_partition_digest, principal_kind,
					 principal_id, active_slot, query_identity, query_bytes,
					 input_bytes, context_input_bytes, opened_at, state)
					select 'collaboration', 'scope:one', 'binding:' || slot,
					       ${deployment}, ${authority}, 'user', 'user:one', slot,
					       'messages.page', 'query:messages.page'::bytea,
					       '{"first":20}'::bytea, '{"tenant":"company:one"}'::bytea,
					       ${openedAt}, 'open'
					from generate_series(1, 64) slot
				`;

				await expectPostgresError(
					database!`
						insert into questpie_internal.realtime_watch_bindings
						(application_name, scope_identity, binding_identity,
						 deployment_digest, authority_partition_digest, principal_kind,
						 principal_id, active_slot, query_identity, query_bytes,
						 input_bytes, context_input_bytes, opened_at, state)
						values ('collaboration', 'scope:one', 'binding:overflow',
						        ${deployment}, ${authority}, 'user', 'user:one', 65,
						        'messages.page', 'query'::bytea, '{}'::bytea, '{}'::bytea,
						        ${openedAt}, 'open')
					`,
					"23514",
				);

				await database!`
					update questpie_internal.realtime_watch_bindings
					set acknowledged_generation = 1,
					    acknowledged_token_digest = ${"c".repeat(64)},
					    acknowledged_at = ${openedAt}
					where application_name = 'collaboration'
					  and scope_identity = 'scope:one' and binding_identity = 'binding:1'
				`;
				await database!`
					update questpie_internal.realtime_watch_bindings
					set state = 'withdrawn', active_slot = null, withdrawn_at = ${openedAt}
					where application_name = 'collaboration'
					  and scope_identity = 'scope:one' and binding_identity = 'binding:1'
				`;
				const [state] = await database!<
					{ state: string; generation: string; hasCredentialColumn: boolean }[]
				>`
					select binding.state,
					       binding.acknowledged_generation as generation,
					       exists (
					         select 1 from information_schema.columns
					         where table_schema = 'questpie_internal'
					           and table_name in ('realtime_scope_attachments', 'realtime_watch_bindings')
					           and column_name in ('credential', 'resolved_context', 'policy_evidence', 'run_as')
					       ) as "hasCredentialColumn"
					from questpie_internal.realtime_watch_bindings binding
					where application_name = 'collaboration'
					  and scope_identity = 'scope:one' and binding_identity = 'binding:1'
				`;
				expect(state).toEqual({
					state: "withdrawn",
					generation: "1",
					hasCredentialColumn: false,
				});
				await database!`
					delete from questpie_internal.realtime_scope_attachments
					where application_name = 'collaboration' and expires_at <= ${expiresAt}
				`;
				const [expired] = await database!<{ watches: number }[]>`
					select count(*)::integer as watches
					from questpie_internal.realtime_watch_bindings
					where application_name = 'collaboration'
				`;
				expect(expired).toEqual({ watches: 0 });

				await database!.unsafe(
					"ALTER TABLE questpie_internal.realtime_watch_bindings DROP CONSTRAINT realtime_watch_binding_payload_bounded",
				);
				await expect(verifyInternalProtocolV3(database!)).rejects.toMatchObject(
					{
						code: "QP-SCHEMA-023",
					},
				);
			},
			15_000,
		);

		postgresTest(
			"captures raw DML, cascades, COPY, ON CONFLICT, MERGE, rollback, and TRUNCATE",
			async () => {
				await ensure(database!);
				await installApplicationSchema(database!);
				await verifyPostgresChangeCapture(database!, projection);

				await database!
					.unsafe(`INSERT INTO collaboration.channels VALUES ('general', 'General');
INSERT INTO collaboration.messages VALUES ('inserted', 'general', 'first');
INSERT INTO collaboration.messages VALUES ('inserted', 'general', 'conflict')
  ON CONFLICT (id) DO UPDATE SET body = excluded.body;
MERGE INTO collaboration.messages target
USING (VALUES ('merged', 'general', 'merge')) source(id, channel_id, body)
ON target.id = source.id
WHEN NOT MATCHED THEN INSERT (id, channel_id, body)
VALUES (source.id, source.channel_id, source.body);
UPDATE collaboration.messages SET body = body WHERE id = 'missing';
COPY collaboration.messages (id, channel_id, body)
FROM PROGRAM 'printf ''copied|general|copy\\n''' WITH (FORMAT csv, DELIMITER '|');
DELETE FROM collaboration.channels WHERE id = 'general';`);
				const facts = await database!<
					{
						collection: string;
						kind: string;
						oldId: string | null;
						newId: string | null;
					}[]
				>`
			select collection_identity as collection, change_kind as kind,
			       old_key->>'id' as "oldId", new_key->>'id' as "newId"
			from questpie_internal.change_ledger order by fact_id
		`;
				expect(facts).toEqual([
					{
						collection: "collection:channels",
						kind: "insert",
						oldId: null,
						newId: "general",
					},
					{
						collection: "collection:messages",
						kind: "insert",
						oldId: null,
						newId: "inserted",
					},
					{
						collection: "collection:messages",
						kind: "update",
						oldId: "inserted",
						newId: "inserted",
					},
					{
						collection: "collection:messages",
						kind: "insert",
						oldId: null,
						newId: "merged",
					},
					{
						collection: "collection:messages",
						kind: "insert",
						oldId: null,
						newId: "copied",
					},
					{
						collection: "collection:channels",
						kind: "delete",
						oldId: "general",
						newId: null,
					},
					{
						collection: "collection:messages",
						kind: "delete",
						oldId: "inserted",
						newId: null,
					},
					{
						collection: "collection:messages",
						kind: "delete",
						oldId: "merged",
						newId: null,
					},
					{
						collection: "collection:messages",
						kind: "delete",
						oldId: "copied",
						newId: null,
					},
				]);
				const [factIdentities] = await database!<
					{ facts: number; identities: number }[]
				>`
				select count(*)::integer as facts,
				       count(distinct fact_identity)::integer as identities
				from questpie_internal.change_ledger
			`;
				expect(factIdentities).toEqual({ facts: 9, identities: 9 });

				try {
					await database!.begin(async (transaction) => {
						await transaction`insert into collaboration.channels values ('rolled-back', 'Rollback')`;
						throw new Error("rollback witness");
					});
				} catch (error) {
					expect(error).toMatchObject({ message: "rollback witness" });
				}
				const [rolledBack] = await database!<{ facts: number }[]>`
			select count(*)::integer as facts from questpie_internal.change_ledger
			where new_key->>'id' = 'rolled-back'
		`;
				expect(rolledBack).toEqual({ facts: 0 });

				await database!
					.unsafe(`TRUNCATE questpie_internal.change_ledger RESTART IDENTITY CASCADE;
INSERT INTO collaboration.channels VALUES ('bulk', 'Bulk');
INSERT INTO collaboration.messages
SELECT 'message-' || value, 'bulk', 'body' FROM generate_series(1, 17) value;`);
				const [widened] = await database!<
					{ count: number; kind: string; conservative: boolean }[]
				>`
			select count(*)::integer as count, min(change_kind) as kind,
			       bool_and(conservative) as conservative
			from questpie_internal.change_ledger
			where collection_identity = 'collection:messages'
		`;
				expect(widened).toEqual({
					count: 1,
					kind: "collection",
					conservative: true,
				});

				await database!`truncate collaboration.messages`;
				const [truncated] = await database!<{ kind: string }[]>`
			select change_kind as kind
			from questpie_internal.change_ledger
			where collection_identity = 'collection:messages'
			order by fact_id desc limit 1
		`;
				expect(truncated).toEqual({ kind: "truncate" });
			},
		);

		postgresTest(
			"keeps managed writers outside ledger authority and detects trigger drift",
			async () => {
				await ensure(database!);
				await installApplicationSchema(database!);
				await database!
					.unsafe(`CREATE ROLE ${writerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA collaboration TO ${writerRole};
GRANT SELECT, INSERT, UPDATE, DELETE ON collaboration.channels, collaboration.messages TO ${writerRole};`);
				const writer = new SQL({
					database: process.env.PGDATABASE,
					hostname: process.env.PGHOST,
					password: "",
					port: Number(process.env.PGPORT ?? "5432"),
					username: writerRole,
					max: 1,
				});
				try {
					await writer`insert into collaboration.channels values ('managed', 'Managed')`;
					for (const table of [
						"change_ledger",
						"reconciliation_consumers",
						"processed_change_facts",
						"observed_dependency_plans",
						"realtime_scope_attachments",
						"realtime_watch_bindings",
						"retained_live_query_results",
					])
						await expectPostgresDenied(
							writer.unsafe(`SELECT * FROM questpie_internal.${table}`),
						);
					await expectPostgresDenied(
						writer.unsafe(
							"ALTER TABLE collaboration.channels DISABLE TRIGGER USER",
						),
					);
					await expectPostgresDenied(
						writer.unsafe("SET session_replication_role = replica"),
					);
				} finally {
					await writer.close({ timeout: 1 });
				}
				const [role] = await database!<
					{ superuser: boolean; replication: boolean }[]
				>`
			select rolsuper as superuser, rolreplication as replication
			from pg_catalog.pg_roles where rolname = ${writerRole}
		`;
				expect(role).toEqual({ superuser: false, replication: false });

				await database!.unsafe(
					"ALTER TABLE collaboration.messages DISABLE TRIGGER messages_questpie_capture_row",
				);
				await expect(
					verifyPostgresChangeCapture(database!, projection),
				).rejects.toMatchObject({ code: "QP-SCHEMA-028" });
			},
			15_000,
		);
	},
);
