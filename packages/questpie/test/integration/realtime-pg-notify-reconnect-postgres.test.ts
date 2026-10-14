import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	spyOn,
} from "bun:test";
import net from "node:net";

import pg from "pg";

import { PgNotifyChangeBroker } from "../../src/server/modules/core/integrated/realtime/adapters/pg-notify.js";
import type {
	ChangeBrokerState,
	ChangeWake,
} from "../../src/server/modules/core/integrated/realtime/transport.js";

// A Postgres server terminating a backend (pg_terminate_backend, failover,
// restart) or a network path that silently stops delivering must not leave the
// broker without its LISTEN connection, and must not break later publishes.
const databaseUrl = process.env.QUESTPIE_REALTIME_TXID_DATABASE_URL;
const runPostgresContract = Boolean(databaseUrl);

const RECOVERY_TIMEOUT_MS = 5_000;
const BROKER_TIMEOUT_MS = 500;
const BROKER_HEALTH_CHECK_INTERVAL_MS = 200;

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

/** Settles with the promise, or rejects if it is still pending at the deadline. */
async function withinRecoveryTimeout<T>(
	label: string,
	promise: Promise<T>,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new Error(
								`Still pending after ${RECOVERY_TIMEOUT_MS}ms: ${label}`,
							),
						),
					RECOVERY_TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * A TCP forwarder to Postgres that can turn into a dead peer: once blackholed,
 * every open connection and every new one is held open but nothing crosses it,
 * not even a FIN. Restoring affects new connections only.
 */
class BlackholeProxy {
	private server: net.Server;
	private blackholed = false;
	private readonly pairs = new Set<{
		client: net.Socket;
		upstream?: net.Socket;
		dead: boolean;
	}>();

	constructor(
		private readonly upstreamHost: string,
		private readonly upstreamPort: number,
	) {
		this.server = net.createServer({ allowHalfOpen: true }, (client) =>
			this.accept(client),
		);
	}

	async listen(): Promise<number> {
		await new Promise<void>((resolve) =>
			this.server.listen(0, "127.0.0.1", resolve),
		);
		return (this.server.address() as net.AddressInfo).port;
	}

	blackhole(): void {
		this.blackholed = true;
		for (const pair of this.pairs) pair.dead = true;
	}

	restore(): void {
		this.blackholed = false;
	}

	/** Drop every client connection at once, as a crashing peer would. */
	closeAbruptly(): void {
		for (const pair of this.pairs) {
			pair.client.destroy();
			pair.upstream?.destroy();
		}
		this.pairs.clear();
	}

	async close(): Promise<void> {
		this.closeAbruptly();
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
	}

	private accept(client: net.Socket): void {
		const pair: {
			client: net.Socket;
			upstream?: net.Socket;
			dead: boolean;
		} = { client, dead: this.blackholed };
		this.pairs.add(pair);
		client.on("error", () => {});
		const forget = () => {
			this.pairs.delete(pair);
			client.destroy();
			pair.upstream?.destroy();
		};
		client.on("close", forget);
		if (pair.dead) return;
		const upstream = net.connect(this.upstreamPort, this.upstreamHost);
		pair.upstream = upstream;
		upstream.on("error", () => {});
		upstream.on("close", () => {
			if (!pair.dead) forget();
		});
		client.on("end", () => {
			if (!pair.dead) upstream.end();
		});
		upstream.on("end", () => {
			if (!pair.dead) client.end();
		});
		client.on("data", (chunk) => {
			if (!pair.dead) upstream.write(chunk);
		});
		upstream.on("data", (chunk) => {
			if (!pair.dead) client.write(chunk);
		});
	}
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
		let proxy: BlackholeProxy | undefined;

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
			proxy?.restore();
			await broker?.stop();
			broker = undefined;
			await proxy?.close();
			proxy = undefined;
		});

		afterAll(async () => {
			await notifier.end();
			await admin.query(`drop database if exists "${database}" with (force)`);
			await admin.end();
		});

		const useProxy = async () => {
			const upstream = new URL(databaseUrl!);
			proxy = new BlackholeProxy(
				upstream.hostname,
				Number(upstream.port || 5432),
			);
			return proxy.listen();
		};

		const createBroker = (options: { proxyPort?: number } = {}) => {
			const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
			const channel = `qp_reconnect_${suffix}`;
			const applicationName = `qp_pgnotify_${suffix}`;
			const url = new URL(databaseUrl!);
			url.pathname = `/${database}`;
			if (options.proxyPort !== undefined) {
				url.hostname = "127.0.0.1";
				url.port = String(options.proxyPort);
			}
			url.searchParams.set("application_name", applicationName);
			const wakes: ChangeWake[] = [];
			const states: ChangeBrokerState[] = [];
			const errors: unknown[] = [];
			broker = new PgNotifyChangeBroker({
				channel,
				connectionString: url.toString(),
				reconnectInitialDelayMs: 50,
				reconnectMaxDelayMs: 200,
				connectionTimeoutMs: BROKER_TIMEOUT_MS,
				healthCheckIntervalMs: BROKER_HEALTH_CHECK_INTERVAL_MS,
			});
			const start = () =>
				broker!.start({
					onWake: (wake) => wakes.push(wake),
					onError: (error) => errors.push(error),
					onStateChange: (state) => states.push(state),
				});
			return { channel, applicationName, wakes, states, errors, start };
		};

		const startBroker = async (options: { proxyPort?: number } = {}) => {
			const created = createBroker(options);
			await created.start();
			return created;
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

		// Each publish is bounded by the broker's timeout, so a refused or
		// timed-out attempt is retried instead of ending the wait.
		const waitForPublish = (highWaterSeq: number) =>
			waitFor(`publish ${highWaterSeq} accepted`, () =>
				broker!.publish(wake(highWaterSeq)).then(
					() => true,
					() => undefined,
				),
			);

		const waitForNewListener = (
			applicationName: string,
			channel: string,
			previousPids: number[],
		) =>
			waitFor("a new LISTEN backend", async () => {
				const pids = await backendPids(applicationName, `LISTEN ${channel}%`);
				return pids.find((pid) => !previousPids.includes(pid));
			});

		it("re-establishes LISTEN after its backend is terminated", async () => {
			const { channel, applicationName, wakes, states } = await startBroker();
			const [listenerPid] = await backendPids(
				applicationName,
				`LISTEN ${channel}%`,
			);
			expect(listenerPid).toBeNumber();

			await admin.query("select pg_terminate_backend($1)", [listenerPid]);

			const newListenerPid = await waitForNewListener(
				applicationName,
				channel,
				[listenerPid!],
			);
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

			await waitForNewListener(applicationName, channel, [listenerPid!]);
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

			await waitForPublish(3);
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
				(await backendPids(applicationName, "%")).includes(publisherPid!)
					? undefined
					: true,
			);

			// The terminated connection's error event is delivered asynchronously;
			// a publish must succeed whichever side of it the call lands on.
			await sleep(100);
			await broker!.publish(wake(2));
			await waitForWake(wakes, 2);
		});

		it("publishes after startPublisher() was refused while the database was down", async () => {
			const { wakes } = await startBroker();
			await allowConnections(false);
			await expect(broker!.startPublisher()).rejects.toThrow();
			await allowConnections(true);

			await withinRecoveryTimeout(
				"startPublisher() after the outage",
				broker!.startPublisher(),
			);
			await withinRecoveryTimeout(
				"publish after the outage",
				broker!.publish(wake(1)),
			);
			await waitForWake(wakes, 1);
		});

		it("reconnects on a new session when LISTEN fails on a live connection", async () => {
			const { channel, applicationName, wakes } = await startBroker();
			const [listenerPid] = await backendPids(
				applicationName,
				`LISTEN ${channel}%`,
			);
			// LISTEN refused by a server that stays up, as on a standby after a
			// failover: the connection survives, the subscription does not exist.
			const failedListenPids: number[] = [];
			const query = pg.Client.prototype.query;
			const querySpy = spyOn(pg.Client.prototype, "query").mockImplementation(
				function (this: pg.Client, ...args: any[]) {
					if (
						failedListenPids.length === 0 &&
						args[0] === `LISTEN ${channel}`
					) {
						failedListenPids.push((this as any).processID);
						return Promise.reject(
							Object.assign(
								new Error("cannot execute LISTEN during recovery"),
								{ code: "25006" },
							),
						);
					}
					return (query as any).apply(this, args);
				} as any,
			);
			try {
				await admin.query("select pg_terminate_backend($1)", [listenerPid]);
				const newListenerPid = await waitForNewListener(
					applicationName,
					channel,
					[listenerPid!],
				);
				expect(failedListenPids).toHaveLength(1);
				expect(newListenerPid).not.toBe(failedListenPids[0]);
			} finally {
				querySpy.mockRestore();
			}
			await notifier.query("select pg_notify($1, $2)", [
				channel,
				JSON.stringify(wake(1)),
			]);
			await waitForWake(wakes, 1);
		});

		it("re-establishes LISTEN after the network path silently stopped delivering", async () => {
			const proxyPort = await useProxy();
			const { channel, applicationName, wakes } = await startBroker({
				proxyPort,
			});
			const [listenerPid] = await backendPids(
				applicationName,
				`LISTEN ${channel}%`,
			);
			expect(listenerPid).toBeNumber();

			proxy!.blackhole();
			await sleep(BROKER_HEALTH_CHECK_INTERVAL_MS + BROKER_TIMEOUT_MS + 300);
			proxy!.restore();

			// The blackholed backend is still alive on the server, so the new
			// LISTEN session is any other one.
			await waitForNewListener(applicationName, channel, [listenerPid!]);
			await notifier.query("select pg_notify($1, $2)", [
				channel,
				JSON.stringify(wake(1)),
			]);
			await waitForWake(wakes, 1);
			await waitForPublish(2);
			await waitForWake(wakes, 2);
		});

		it("bounds start() against a server that accepts TCP but never answers", async () => {
			const proxyPort = await useProxy();
			proxy!.blackhole();
			const { start } = createBroker({ proxyPort });
			await expect(
				withinRecoveryTimeout("start() against a dead peer", start()),
			).rejects.not.toThrow(/Still pending/);
		});

		it("survives the connection closing abruptly while stop() runs", async () => {
			const proxyPort = await useProxy();
			await startBroker({ proxyPort });
			proxy!.blackhole();
			// UNLISTEN is now in flight on a dead path; the peer then drops the
			// connection, which node-postgres reports as an 'error' event.
			const stopping = broker!.stop();
			await sleep(50);
			proxy!.closeAbruptly();
			await withinRecoveryTimeout("stop()", stopping);
			broker = undefined;
			// Let any late lifecycle event surface as an unhandled error.
			await sleep(100);
		});
	},
);
