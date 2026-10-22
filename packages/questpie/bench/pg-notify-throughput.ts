/** Broker saturation check. Isolated PostgreSQL + pg_stat_statements required. */
import pg from "pg";

import { PgNotifyChangeBroker } from "../src/exports/adapters/pg-notify.js";

const connectionString = process.env.QUESTPIE_EPHEMERAL_DATABASE_URL;
if (!connectionString)
	throw new Error("An isolated benchmark database is required");
const pool = new pg.Pool({ connectionString });
const channel = `throughput_${crypto.randomUUID().replaceAll("-", "")}`;
const publisher = new PgNotifyChangeBroker({ connectionString, channel });
const listener = new PgNotifyChangeBroker({ connectionString, channel });
const count = 10_000;
const latencies: number[] = [];
const sent = new Map<number, number>();
let received = 0;
async function stats() {
	return (
		await pool.query(
			"select coalesce(sum(calls),0)::float8 as calls, coalesce(sum(rows),0)::float8 as notifications from pg_stat_statements where dbid=(select oid from pg_database where datname=current_database()) and query like 'select pg_notify(%'",
		)
	).rows[0];
}
try {
	await listener.start({
		onWake: (wake) => {
			if (wake.kind !== "topology-maybe-advanced") return;
			if (wake.desiredRevision !== received)
				throw new Error("Notice order/uniqueness changed");
			received++;
			latencies.push(performance.now() - sent.get(wake.desiredRevision)!);
		},
		onError: (error) => {
			throw error;
		},
	});
	await publisher.start({
		onWake: () => {},
		onError: (error) => {
			throw error;
		},
	});
	await publisher.startPublisher();
	const before = await stats();
	const start = performance.now();
	// Fixed concurrency below the existing 256-request admission bound. Each
	// caller immediately offers the next notice after its commit completes.
	let next = 0;
	await Promise.all(
		Array.from({ length: 128 }, async () => {
			while (next < count) {
				const desiredRevision = next++;
				sent.set(desiredRevision, performance.now());
				await publisher.publish({
					kind: "topology-maybe-advanced",
					sessionKey: "bench",
					ownerId: "publisher",
					ownerGeneration: 1,
					desiredRevision,
					reason: "submit",
				});
			}
		}),
	);
	const deadline = Date.now() + 5000;
	for (;;) {
		if (received >= count || Date.now() >= deadline) break;
		await Bun.sleep(1);
	}
	const elapsedMs = performance.now() - start;
	const after = await stats();
	latencies.sort((a, b) => a - b);
	console.log(
		JSON.stringify(
			{
				count,
				concurrency: 128,
				received,
				elapsedMs,
				notifiesPerSecond: received / (elapsedMs / 1000),
				sqlCalls: after.calls - before.calls,
				sqlRows: after.notifications - before.notifications,
				latencyP95Ms: latencies[Math.floor(latencies.length * 0.95)],
				latencyP99Ms: latencies[Math.floor(latencies.length * 0.99)],
			},
			null,
			2,
		),
	);
	if (received !== count) throw new Error("Not all notices delivered");
} finally {
	await publisher.stop();
	await listener.stop();
	await pool.end();
}
