import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";

import { backendPid } from "../../../packages/compiler/src/postgres-session";
import {
	ensureInternalProtocolV2,
	internalProtocolV2Checksum,
	verifyInternalProtocolV2,
} from "../../../packages/compiler/src/schema";
import { bootstrap } from "../../../packages/compiler/src/schema/postgres/bootstrap";

const database = process.env.PGHOST ? new SQL() : undefined;
const control = { lockTimeoutMs: 1_000, statementTimeoutMs: 5_000 } as const;
const expectedV2Checksum =
	"5e7e6ae37dba4887f31887333274c59f236840f224a19fbabbee4f2c6a841d45";

async function protocolCatalog(sql: SQL): Promise<unknown> {
	const [catalog] = await sql<{ value: unknown }[]>`
		select jsonb_build_object(
			'protocol', (
				select jsonb_build_object('version', version, 'checksum', checksum)
				from questpie_internal.protocol
				where singleton = true
			),
			'tables', (
				select jsonb_agg(jsonb_build_object(
					'name', c.relname,
					'columns', (
						select jsonb_agg(jsonb_build_array(
							a.attname,
							pg_catalog.format_type(a.atttypid, a.atttypmod),
							a.attnotnull
						) order by a.attnum)
						from pg_catalog.pg_attribute a
						where a.attrelid = c.oid
						  and a.attnum > 0
						  and not a.attisdropped
					)
				) order by c.relname)
				from pg_catalog.pg_class c
				join pg_catalog.pg_namespace n on n.oid = c.relnamespace
				where n.nspname = 'questpie_internal' and c.relkind = 'r'
			)
		) as value
	`;
	return catalog?.value;
}

async function ensure(sql: SQL): Promise<void> {
	const [current] = await sql<{ name: string }[]>`
		select current_database() as name
	`;
	await ensureInternalProtocolV2(
		sql,
		current!.name,
		await backendPid(sql),
		control,
	);
}

beforeEach(async () => {
	await database?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
});

afterAll(async () => {
	await database?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	await database?.close();
});

describe.skipIf(!database)("BETA-06 questpie_internal protocol v2", () => {
	test("fresh install and existing v1 upgrade converge on one exact v2 catalog", async () => {
		expect(internalProtocolV2Checksum).toBe(expectedV2Checksum);
		const fresh = await database!.reserve();
		let freshCatalog: unknown;
		try {
			await ensure(fresh);
			freshCatalog = await protocolCatalog(fresh);
		} finally {
			fresh.release();
		}

		expect(freshCatalog).toMatchObject({
			protocol: { version: 2, checksum: expectedV2Checksum },
			tables: [
				{ name: "application_bindings" },
				{ name: "committed_change_facts" },
				{ name: "mutation_call_receipts" },
				{ name: "pending_reaction_intents" },
				{ name: "protocol" },
				{ name: "schema_migration_receipts" },
				{ name: "seed_attempt_events" },
				{ name: "seed_receipts" },
			],
		});

		await database!.unsafe("DROP SCHEMA questpie_internal CASCADE");
		const upgraded = await database!.reserve();
		try {
			const [current] = await upgraded<{ name: string }[]>`
				select current_database() as name
			`;
			const pid = await backendPid(upgraded);
			await bootstrap(upgraded, current!.name, pid, control);
			const [v1] = await upgraded<{ version: number }[]>`
				select version from questpie_internal.protocol where singleton = true
			`;
			expect(v1?.version).toBe(1);

			await ensureInternalProtocolV2(upgraded, current!.name, pid, control);
			expect(await protocolCatalog(upgraded)).toEqual(freshCatalog);

			await ensureInternalProtocolV2(upgraded, current!.name, pid, control);
			expect(await protocolCatalog(upgraded)).toEqual(freshCatalog);
		} finally {
			upgraded.release();
		}
	});

	test("serializes concurrent first upgrades and preserves one v2 protocol", async () => {
		const left = await database!.reserve();
		const right = await database!.reserve();
		try {
			await Promise.all([ensure(left), ensure(right)]);
			const [state] = await database!<
				{ protocolRows: number; version: number; tables: number }[]
			>`
				select
				  (select count(*)::integer from questpie_internal.protocol) as "protocolRows",
				  (select version from questpie_internal.protocol where singleton = true) as version,
				  (select count(*)::integer
				   from pg_catalog.pg_class c
				   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
				   where n.nspname = 'questpie_internal' and c.relkind = 'r') as tables
			`;
			expect(state).toEqual({ protocolRows: 1, version: 2, tables: 8 });
		} finally {
			left.release();
			right.release();
		}
	});

	test("readiness verification rejects v1 without mutating it", async () => {
		const session = await database!.reserve();
		try {
			const [current] = await session<{ name: string }[]>`
				select current_database() as name
			`;
			await bootstrap(
				session,
				current!.name,
				await backendPid(session),
				control,
			);
			await expect(verifyInternalProtocolV2(session)).rejects.toMatchObject({
				code: "QP-SCHEMA-023",
			});
			const [state] = await session<
				{ version: number; receipts: string | null }[]
			>`
				select version,
				       pg_catalog.to_regclass('questpie_internal.mutation_call_receipts')::text as receipts
				from questpie_internal.protocol where singleton = true
			`;
			expect(state).toEqual({ version: 1, receipts: null });
		} finally {
			session.release();
		}
	});

	test("rejects v1 or v2 catalog tampering without partially upgrading", async () => {
		const session = await database!.reserve();
		try {
			const [current] = await session<{ name: string }[]>`
				select current_database() as name
			`;
			const pid = await backendPid(session);
			await bootstrap(session, current!.name, pid, control);
			await session.unsafe(
				"CREATE INDEX unexpected_protocol_index ON questpie_internal.protocol (version)",
			);

			await expect(
				ensureInternalProtocolV2(session, current!.name, pid, control),
			).rejects.toMatchObject({ code: "QP-SCHEMA-023" });
			const [notUpgraded] = await session<
				{ version: number; v2Table: string | null }[]
			>`
				select version,
				       pg_catalog.to_regclass('questpie_internal.mutation_call_receipts')::text as "v2Table"
				from questpie_internal.protocol where singleton = true
			`;
			expect(notUpgraded).toEqual({ version: 1, v2Table: null });

			await session.unsafe(
				"DROP INDEX questpie_internal.unexpected_protocol_index",
			);
			await ensureInternalProtocolV2(session, current!.name, pid, control);
			await session.unsafe(
				"ALTER TABLE questpie_internal.pending_reaction_intents DROP CONSTRAINT reaction_intent_payload_bytes_bounded",
			);
			await expect(
				ensureInternalProtocolV2(session, current!.name, pid, control),
			).rejects.toMatchObject({ code: "QP-SCHEMA-023" });
		} finally {
			session.release();
		}
	});

	test("enforces bounded receipts, committed facts, and pending-only intents", async () => {
		const session = await database!.reserve();
		try {
			await ensure(session);
			await expect(
				session
					.unsafe(`
					insert into questpie_internal.mutation_call_receipts
					(application_name, tenant_id, operation_name, principal_kind, principal_id, call_id,
					 input_digest, transaction_id, operation_time, outcome)
					values ('collaboration', 'tenant-one', 'message.publish', 'user', 'principal-one',
					 'call-one', repeat('a', 64),
					 pg_current_xact_id(), transaction_timestamp(), 'committed')
				`)
					.execute(),
			).rejects.toMatchObject({ errno: "23514" });

			await expect(
				session
					.unsafe(`
					insert into questpie_internal.committed_change_facts
					(application_name, transaction_id, sequence, operation_name, call_id,
					 collection_name, record_key_bytes, kind, committed_at)
					values ('collaboration', pg_current_xact_id(), 1, 'message.publish',
					 'call-one', 'messages',
					 decode(repeat('00', 65537), 'hex'), 'insert', transaction_timestamp())
				`)
					.execute(),
			).rejects.toMatchObject({ errno: "23514" });

			await expect(
				session
					.unsafe(`
					insert into questpie_internal.pending_reaction_intents
					(application_name, tenant_id, source_operation, principal_kind, principal_id, call_id,
					 dispatch_slot, intent_id, reaction_name, input_digest, payload_bytes,
					 transaction_id, accepted_at, state)
					values ('collaboration', 'tenant-one', 'message.publish', 'user', 'principal-one',
					 'call-one', 'messagePublished',
					 '00000000-0000-4000-8000-000000000002', 'message.published',
					 repeat('b', 64), decode(repeat('00', 262145), 'hex'),
					 pg_current_xact_id(), transaction_timestamp(), 'ready')
				`)
					.execute(),
			).rejects.toMatchObject({ errno: "23514" });
		} finally {
			session.release();
		}
	});
});
