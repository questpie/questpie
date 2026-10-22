import { expect, test } from "bun:test";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle as postgresDrizzle } from "drizzle-orm/node-postgres";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import pg from "pg";

import { questpieRealtimeTopologyTable as topologyTable } from "../../src/server/modules/core/integrated/realtime/collection.js";
import {
	MemoryRealtimeTopologyStore,
	PostgresRealtimeTopologyStore,
	RealtimeTopologyCoordinator,
	type RealtimeDesiredTopology,
} from "../../src/server/modules/core/integrated/realtime/topology-coordinator.js";

const topology: RealtimeDesiredTopology = {
	protocol: "questpie-realtime-topology",
	version: 2,
	revision: 0,
	subscriptions: [],
};

for (const backend of ["pglite", "postgres"] as const) {
	const databaseUrl = process.env.QUESTPIE_REALTIME_TXID_DATABASE_URL;
	const contract = backend === "postgres" && !databaseUrl ? test.skip : test;
	contract(
		`${backend}: lease batches retain ownership, paired generations and per-client expiry`,
		async () => {
			const queries: string[] = [];
			const logger = { logQuery: (query: string) => queries.push(query) };
			const pglite = backend === "pglite" ? await PGlite.create() : undefined;
			const pool =
				backend === "postgres"
					? new pg.Pool({ connectionString: databaseUrl, max: 1 })
					: undefined;
			const schema = `lease_batch_${crypto.randomUUID().replaceAll("-", "")}`;
			if (pool) {
				await pool.query(`create schema ${schema}`);
				await pool.query(`set search_path to ${schema}`);
			}
			const db = pglite
				? pgliteDrizzle({ client: pglite, logger })
				: postgresDrizzle({ client: pool!, logger });
			try {
				await db.execute(sql`create table questpie_realtime_topology (
				session_key text primary key, owner_id text not null,
				owner_generation bigserial not null, protocol_version integer not null,
				token_hash text not null, identity_hash text not null,
				lease_expires_at timestamptz not null,
				desired_revision bigint not null default 0, applied_revision bigint not null default 0,
				desired_topology jsonb not null,
				created_at timestamp(3) not null default now(), updated_at timestamp(3) not null default now()
			)`);
				const store = new PostgresRealtimeTopologyStore(db);
				const rows = await db
					.insert(topologyTable)
					.values(
						Array.from({ length: 1001 }, (_, i) => ({
							sessionKey: String(i),
							ownerId: i === 1 ? "another-owner" : "owner",
							protocolVersion: 2,
							tokenHash: "token",
							identityHash: "identity",
							leaseExpiresAt: sql`now() + interval '1 minute'`,
							desiredTopology: topology,
						})),
					)
					.returning();
				await db.execute(sql`update ${topologyTable} set updated_at = now() - interval '1 minute'
				where session_key in ('4', '5', '6')`);
				await db.execute(sql`update ${topologyTable} set lease_expires_at = now() - interval '1 second'
				where session_key = '7'`);
				const sessions = rows.map((row) => ({
					sessionKey: row.sessionKey,
					ownerGeneration: row.ownerGeneration,
					clientLeaseMs: ["4", "8"].includes(row.sessionKey)
						? 30_000
						: row.sessionKey === "6"
							? 120_000
							: undefined,
				}));
				// Both generations occur in the input, but neither belongs to its paired key.
				[sessions[2]!.ownerGeneration, sessions[3]!.ownerGeneration] = [
					sessions[3]!.ownerGeneration,
					sessions[2]!.ownerGeneration,
				];
				queries.length = 0;
				const renewed = await store.renewMany({
					ownerId: "owner",
					leaseMs: 120_000,
					sessions,
				});
				expect(
					queries.filter((query) => query.startsWith("update ")),
				).toHaveLength(2);
				expect(renewed).toHaveLength(996);
				const keys = new Set(renewed.map((row) => row.sessionKey));
				for (const denied of ["1", "2", "3", "4", "7"])
					expect(keys.has(denied)).toBe(false);
				for (const allowed of ["0", "5", "6", "8", "1000"])
					expect(keys.has(allowed)).toBe(true);
				const [staleUnmanaged] = await db
					.select()
					.from(topologyTable)
					.where(sql`session_key = '5'`);
				expect(staleUnmanaged!.updatedAt.getTime()).toBeLessThan(
					Date.now() - 50_000,
				);
				expect(staleUnmanaged!.leaseExpiresAt.getTime()).toBeGreaterThan(
					Date.now() + 100_000,
				);
				queries.length = 0;
				expect(
					await store.renewMany({ ownerId: "owner", leaseMs: 1, sessions: [] }),
				).toEqual([]);
				expect(queries).toHaveLength(0);
			} finally {
				if (pool) {
					await pool.query(`drop schema ${schema} cascade`);
					await pool.end();
				}
				await pglite?.close();
			}
		},
	);
}

test("heartbeat is single-flight and a stale failure cannot close a replacement handler", async () => {
	let release!: () => void;
	let began!: () => void;
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const started = new Promise<void>((resolve) => {
		began = resolve;
	});
	let calls = 0;
	class Store extends MemoryRealtimeTopologyStore {
		async renewMany() {
			calls++;
			began();
			await blocked;
			return [];
		}
	}
	const coordinator = new RealtimeTopologyCoordinator(new Store(), {
		heartbeatMs: 0,
		reconcileMs: 0,
	});
	let oldCloses = 0;
	let newCloses = 0;
	const input = {
		sessionId: "same-session",
		token: "token",
		identity: "user",
		topology,
		apply: async () => {},
	};
	try {
		const first = await coordinator.open({
			...input,
			onClose: () => {
				oldCloses++;
			},
		});
		const heartbeat = coordinator["heartbeat"]();
		await started;
		const overlap = coordinator["heartbeat"]();
		expect(overlap).toBe(heartbeat);
		await first.close();
		const replacement = await coordinator.open({
			...input,
			onClose: () => {
				newCloses++;
			},
		});
		release();
		await heartbeat;
		expect(calls).toBe(1);
		expect(oldCloses).toBe(0);
		expect(newCloses).toBe(0);
		expect(replacement.signal.aborted).toBe(false);
	} finally {
		release();
		await coordinator.stop();
	}
});
