import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";

import pg from "pg";

import { PgNotifyChangeBroker } from "../../src/server/modules/core/integrated/realtime/adapters/pg-notify.js";
import type {
	ChangeBrokerState,
	ChangeWake,
} from "../../src/server/modules/core/integrated/realtime/transport.js";

// A Postgres server terminating a backend (pg_terminate_backend, failover,
// restart) must not leave the broker without its LISTEN connection, and a
// terminated publisher connection must not break later publishes.
const databaseUrl = process.env.QUESTPIE_REALTIME_TXID_DATABASE_URL;
const runPostgresContract = Boolean(databaseUrl);

const RECOVERY_TIMEOUT_MS = 5_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(
	label: string,
	probe: () => Promise<T | undefined>,
): Promise<T> {
	const deadline = Date.now() + RECOVERY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const value = await probe();
		if (value !== undefined) return value;
		await sleep(50);
	}
	throw new Error(`Timed out after ${RECOVERY_TIMEOUT_MS}ms: ${label}`);
}

describe.skipIf(!runPostgresContract)(
	"PgNotifyChangeBroker connection recovery on PostgreSQL",
	() => {
		// The broker connects to its own database so the test can refuse new
		// connections to it, as during a server restart, without touching admin.
		const database = `qp_pgnotify_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
		let admin: pg.Client;
		// NOTIFY is per database: a session in the broker's database sends it.
		let notifier: pg.Client;
		let broker: PgNotifyChangeBroker | undefined;

		const allowConnections = (allow: boolean) =>
			admin.query(
				`alter database "${database}" with allow_connections ${allow}`,
			);

		beforeAll(async () => {
			admin = new pg.Client({ connectionString: databaseUrl });
			await admin.connect();
			await admin.query(`create database "${database}"`);
			const url = new URL(databaseUrl!);
			url.pathname = `/${database}`;
			notifier = new pg.Client({ connectionString: url.toString() });
			await notifier.connect();
		});

		afterEach(async () => {
			await allowConnections(true);
			await broker?.stop();
			broker = undefined;
		});

		afterAll(async () => {
			await notifier.end();
			await admin.query(`drop database if exists "${database}" with (force)`);
			await admin.end();
		});

		const startBroker = async () => {
			const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
			const channel = `qp_reconnect_${suffix}`;
			const applicationName = `qp_pgnotify_${suffix}`;
			const url = new URL(databaseUrl!);
			url.pathname = `/${database}`;
			url.searchParams.set("application_name", applicationName);
			const wakes: ChangeWake[] = [];
			const states: ChangeBrokerState[] = [];
			const errors: unknown[] = [];
			broker = new PgNotifyChangeBroker({
				channel,
				connectionString: url.toString(),
				reconnectInitialDelayMs: 50,
				reconnectMaxDelayMs: 200,
			});
			await broker.start({
				onWake: (wake) => wakes.push(wake),
				onError: (error) => errors.push(error),
				onStateChange: (state) => states.push(state),
			});
			return { channel, applicationName, wakes, states, errors };
		};

		const backendPids = async (
			applicationName: string,
			queryPattern: string,
		): Promise<number[]> => {
			const result = await admin.query<{ pid: number }>(
				`select pid from pg_stat_activity
				 where application_name = $1 and query ilike $2
				 order by pid`,
				[applicationName, queryPattern],
			);
			return result.rows.map((row) => row.pid);
		};

		const wake = (highWaterSeq: number): ChangeWake => ({
			kind: "outbox-maybe-advanced",
			reason: "publish",
			highWaterSeq,
		});

		const waitForWake = (wakes: ChangeWake[], highWaterSeq: number) =>
			waitFor(`wake ${highWaterSeq} delivered`, async () =>
				wakes.some(
					(w) =>
						w.kind === "outbox-maybe-advanced" &&
						w.highWaterSeq === highWaterSeq,
				)
					? true
					: undefined,
			);

		it("re-establishes LISTEN after its backend is terminated", async () => {
			const { channel, applicationName, wakes, states } = await startBroker();
			const [listenerPid] = await backendPids(
				applicationName,
				`LISTEN ${channel}%`,
			);
			expect(listenerPid).toBeNumber();

			await admin.query("select pg_terminate_backend($1)", [listenerPid]);

			const newListenerPid = await waitFor("a new LISTEN backend", async () => {
				const pids = await backendPids(applicationName, `LISTEN ${channel}%`);
				return pids.find((pid) => pid !== listenerPid);
			});
			expect(newListenerPid).not.toBe(listenerPid);
			expect(states).toContain("unavailable");
			expect(states.at(-1)).toBe("connected");

			// A NOTIFY from another session reaches the re-subscribed listener.
			await notifier.query("select pg_notify($1, $2)", [
				channel,
				JSON.stringify(wake(1)),
			]);
			await waitForWake(wakes, 1);

			// So does the broker's own publish.
			await broker!.publish(wake(2));
			await waitForWake(wakes, 2);
		});

		it("re-establishes LISTEN after reconnect attempts were refused", async () => {
			const { channel, applicationName, wakes, errors } = await startBroker();
			const [listenerPid] = await backendPids(
				applicationName,
				`LISTEN ${channel}%`,
			);
			expect(listenerPid).toBeNumber();

			await allowConnections(false);
			await admin.query("select pg_terminate_backend($1)", [listenerPid]);
			// At least one reconnect attempt is refused while the database is down.
			await waitFor("a refused reconnect attempt", async () =>
				errors.length >= 2 ? true : undefined,
			);
			await allowConnections(true);

			await waitFor("a new LISTEN backend", async () => {
				const pids = await backendPids(applicationName, `LISTEN ${channel}%`);
				return pids.find((pid) => pid !== listenerPid);
			});
			await notifier.query("select pg_notify($1, $2)", [
				channel,
				JSON.stringify(wake(1)),
			]);
			await waitForWake(wakes, 1);
		});

		it("publishes again after a publish was refused while the database was down", async () => {
			const { applicationName, wakes } = await startBroker();
			await broker!.publish(wake(1));
			await waitForWake(wakes, 1);
			const [publisherPid] = await backendPids(
				applicationName,
				"select pg_notify%",
			);
			expect(publisherPid).toBeNumber();

			await allowConnections(false);
			await admin.query("select pg_terminate_backend($1)", [publisherPid]);
			await sleep(100);
			await expect(broker!.publish(wake(2))).rejects.toThrow();
			await allowConnections(true);

			await waitFor("a publish after the outage", async () => {
				const published = await Promise.race([
					broker!.publish(wake(3)).then(() => true),
					sleep(RECOVERY_TIMEOUT_MS).then(() => false),
				]);
				return published ? true : undefined;
			});
			await waitForWake(wakes, 3);
		});

		it("publishes again after its publisher backend is terminated", async () => {
			const { applicationName, wakes } = await startBroker();
			await broker!.publish(wake(1));
			await waitForWake(wakes, 1);
			const [publisherPid] = await backendPids(
				applicationName,
				"select pg_notify%",
			);
			expect(publisherPid).toBeNumber();

			await admin.query("select pg_terminate_backend($1)", [publisherPid]);
			await waitFor("the publisher backend to exit", async () =>
				(await backendPids(applicationName, "%")).includes(publisherPid)
					? undefined
					: true,
			);

			// The terminated connection's error event is delivered asynchronously;
			// a publish must succeed whichever side of it the call lands on.
			await sleep(100);
			await broker!.publish(wake(2));
			await waitForWake(wakes, 2);
		});
	},
);
