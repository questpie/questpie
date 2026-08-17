import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";

import { backendPid } from "../../../packages/compiler/src/postgres-session";
import {
	ensureInternalProtocolV3,
	internalProtocolV3Checksum,
} from "../../../packages/compiler/src/schema/postgres/internal-protocol-v3";
import {
	ensureInternalProtocolV4,
	internalProtocolV4Checksum,
	verifyInternalProtocolV4,
} from "../../../packages/compiler/src/schema/postgres/internal-protocol-v4";

const database = process.env.PGHOST ? new SQL({ max: 4 }) : undefined;
const control = { lockTimeoutMs: 5_000, statementTimeoutMs: 30_000 } as const;

const durableTables = [
	"durable_attempts",
	"durable_cancellations",
	"durable_effects",
	"durable_maintenance_commands",
	"durable_run_events",
	"durable_runs",
] as const;

async function ensure(sql: SQL): Promise<void> {
	const [current] = await sql<{ name: string }[]>`
		select current_database() as name
	`;
	await ensureInternalProtocolV4(
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

describe.skipIf(!database)("BETA-08 questpie_internal protocol v4", () => {
	test("a fresh install and a v3 upgrade converge on one verified durable catalog", async () => {
		const fresh = await database!.reserve();
		try {
			await ensure(fresh);
			const [protocol] = await fresh<
				{ version: number; checksum: string }[]
			>`select version, checksum from questpie_internal.protocol where singleton = true`;
			expect(protocol).toEqual({
				version: 4,
				checksum: internalProtocolV4Checksum,
			});
			await verifyInternalProtocolV4(fresh);
			await ensure(fresh);
			await verifyInternalProtocolV4(fresh);
		} finally {
			fresh.release();
		}

		await database!.unsafe("DROP SCHEMA questpie_internal CASCADE");
		const upgraded = await database!.reserve();
		try {
			const [current] = await upgraded<{ name: string }[]>`
				select current_database() as name
			`;
			const pid = await backendPid(upgraded);
			await ensureInternalProtocolV3(upgraded, current!.name, pid, control);
			const [before] = await upgraded<{ checksum: string }[]>`
				select checksum from questpie_internal.protocol where singleton = true
			`;
			expect(before?.checksum).toBe(internalProtocolV3Checksum);
			await ensureInternalProtocolV4(upgraded, current!.name, pid, control);
			await verifyInternalProtocolV4(upgraded);
			const [intents] = await upgraded<{ definition: string }[]>`
				select pg_catalog.pg_get_constraintdef(con.oid, true) as definition
				from pg_catalog.pg_constraint con
				join pg_catalog.pg_class c on c.oid = con.conrelid
				join pg_catalog.pg_namespace n on n.oid = c.relnamespace
				where n.nspname = 'questpie_internal'
				  and c.relname = 'pending_reaction_intents'
				  and con.conname = 'reaction_intent_state_known'
			`;
			expect(intents?.definition).toBe(
				"CHECK (state = ANY (ARRAY['accepted'::text, 'pending'::text]))",
			);
		} finally {
			upgraded.release();
		}
	});

	test("durable state rejects direct application and worker writes", async () => {
		const session = await database!.reserve();
		try {
			await ensure(session);
			for (const table of [...durableTables, "pending_reaction_intents"]) {
				await expect(
					session
						.unsafe(
							`INSERT INTO questpie_internal.${table} (application_name) VALUES ('application:collaboration')`,
						)
						.execute(),
				).rejects.toMatchObject({ errno: "42501" });
				await expect(
					session.unsafe(`DELETE FROM questpie_internal.${table}`).execute(),
				).rejects.toMatchObject({ errno: "42501" });
			}
		} finally {
			session.release();
		}
	});

	test("durable run history stays append only even inside a kernel transaction", async () => {
		const session = await database!.reserve();
		const marked = async (statement: string): Promise<unknown> => {
			await session.unsafe("BEGIN").execute();
			try {
				await session
					.unsafe("SELECT set_config('questpie.durable_kernel', 'on', true)")
					.execute();
				return await session.unsafe(statement).execute();
			} finally {
				await session.unsafe("ROLLBACK").execute();
			}
		};
		try {
			await ensure(session);
			// The kernel marker admits an insert: the guard no longer refuses it,
			// so the statement now fails on the row contract instead. The run
			// history and the maintenance audit are both append only.
			await expect(
				marked(
					`INSERT INTO questpie_internal.durable_run_events (application_name) VALUES ('application:collaboration')`,
				),
			).rejects.toMatchObject({ errno: "23502" });
			for (const statement of [
				"UPDATE questpie_internal.durable_run_events SET kind = 'failed'",
				"DELETE FROM questpie_internal.durable_run_events",
				"TRUNCATE questpie_internal.durable_run_events",
				"UPDATE questpie_internal.durable_maintenance_commands SET outcome = 'applied'",
				"DELETE FROM questpie_internal.durable_maintenance_commands",
				"TRUNCATE questpie_internal.durable_maintenance_commands",
			])
				await expect(marked(statement)).rejects.toMatchObject({
					errno: "42501",
				});
		} finally {
			session.release();
		}
	});

	test("every durable index is B-tree and no durable table enables RLS", async () => {
		const session = await database!.reserve();
		try {
			await ensure(session);
			const indexes = await session<
				{ method: string; partial: boolean; expression: boolean }[]
			>`
				select am.amname as method,
				       x.indpred is not null as partial,
				       x.indexprs is not null as expression
				from pg_catalog.pg_index x
				join pg_catalog.pg_class i on i.oid = x.indexrelid
				join pg_catalog.pg_class t on t.oid = x.indrelid
				join pg_catalog.pg_namespace n on n.oid = t.relnamespace
				join pg_catalog.pg_am am on am.oid = i.relam
				where n.nspname = 'questpie_internal'
			`;
			expect(indexes.length).toBeGreaterThan(0);
			expect(
				indexes.every(
					(index) =>
						index.method === "btree" && !index.partial && !index.expression,
				),
			).toBe(true);
			const [rls] = await session<{ enabled: number }[]>`
				select count(*)::int as enabled
				from pg_catalog.pg_class c
				join pg_catalog.pg_namespace n on n.oid = c.relnamespace
				where n.nspname = 'questpie_internal'
				  and (c.relrowsecurity or c.relforcerowsecurity)
			`;
			expect(rls?.enabled).toBe(0);
		} finally {
			session.release();
		}
	});

	test("a tampered durable guard fails verification", async () => {
		const session = await database!.reserve();
		try {
			await ensure(session);
			await session.unsafe(
				"DROP TRIGGER durable_run_events_append_only ON questpie_internal.durable_run_events",
			);
			await expect(verifyInternalProtocolV4(session)).rejects.toMatchObject({
				code: "QP-SCHEMA-023",
			});
		} finally {
			session.release();
		}
	});
});
