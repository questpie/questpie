import { afterAll, expect, test } from "bun:test";
import { resolve } from "node:path";

import { SQL } from "bun";

import {
	applyCommittedMigrations,
	loadCommittedMigration,
} from "@questpie/compiler";

import {
	beta05Ids,
	beta05PostgresUrl,
	prepareBeta05PostgresApplication,
} from "./helpers/beta05-runtime";

const database = process.env.PGHOST ? new SQL({ max: 2 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const fixtureRoot = resolve(import.meta.dir, "../../../fixtures/collaboration");

type GeneratedApplication = Readonly<{
	fetch(request: Request): Promise<Response>;
	close(): Promise<void>;
}>;

type GeneratedInternal = Readonly<{
	createApplication(
		input: Readonly<{
			postgres: Readonly<{ url: string }>;
			realtime: Readonly<{ hmacKey: Uint8Array }>;
		}>,
	): Promise<GeneratedApplication>;
	bindIngressPrincipalForRequest(request: Request, principal: unknown): Request;
}>;

type Delivery = Readonly<{ kind: "initial" | "reset" | "update" }>;
type MessagePage = Readonly<{
	nodes: ReadonlyArray<Readonly<{ body: string; id: string }>>;
}>;

type GeneratedClient = Readonly<{
	withContext(context: Readonly<{ companyId: string }>): Readonly<{
		queries: Readonly<{
			"messages.page": Readonly<{
				watch(
					input: Readonly<{
						after: string | null;
						channelId: string;
						first: number;
					}>,
					callback: (page: MessagePage, delivery: Delivery) => void,
				): () => void;
			}>;
		}>;
		mutations: Readonly<{
			"message.publish"(
				input: Readonly<{ channelId: string; body: string }>,
				options: Readonly<{ callId: string }>,
			): Promise<unknown>;
		}>;
	}>;
}>;

type TimerCallback = (...arguments_: readonly unknown[]) => void;

function installDeterministicNetworkTimers() {
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	const intervals: Array<
		Readonly<{ callback: TimerCallback; handle: object }>
	> = [];
	const reconnects: Array<Readonly<{ handle: object; run(): void }>> = [];
	let armedIntervals = 0;
	let invokedIntervals = 0;

	globalThis.setInterval = ((
		callback: TimerCallback,
		milliseconds?: number,
	) => {
		expect(typeof callback).toBe("function");
		expect(milliseconds).toBe(10_000);
		armedIntervals += 1;
		const handle = { unref() {} };
		intervals.push({ callback, handle });
		return handle as never;
	}) as typeof globalThis.setInterval;
	globalThis.clearInterval = ((handle: unknown) => {
		const index = intervals.findIndex((interval) => interval.handle === handle);
		if (index >= 0) {
			intervals.splice(index, 1);
			return;
		}
		originalClearInterval(handle as never);
	}) as typeof globalThis.clearInterval;
	globalThis.setTimeout = ((
		callback: TimerCallback,
		milliseconds?: number,
		...arguments_: readonly unknown[]
	) => {
		if (milliseconds !== 250)
			return originalSetTimeout(
				callback as (...arguments_: unknown[]) => void,
				milliseconds,
				...arguments_,
			);
		const handle = {};
		reconnects.push({
			handle,
			run: () => callback(...arguments_),
		});
		return handle as never;
	}) as typeof globalThis.setTimeout;
	globalThis.clearTimeout = ((handle: unknown) => {
		const index = reconnects.findIndex((pending) => pending.handle === handle);
		if (index >= 0) {
			reconnects.splice(index, 1);
			return;
		}
		originalClearTimeout(handle as never);
	}) as typeof globalThis.clearTimeout;

	return Object.freeze({
		get armedIntervals() {
			return armedIntervals;
		},
		get invokedIntervals() {
			return invokedIntervals;
		},
		runInterval(index: number) {
			const interval = intervals[index];
			if (!interval) throw new Error(`Runtime interval ${index} is not armed`);
			invokedIntervals += 1;
			interval.callback();
		},
		runReconnect() {
			const pending = reconnects.shift();
			if (!pending) throw new Error("generated client did not arm reconnect");
			pending.run();
		},
		restore() {
			globalThis.setInterval = originalSetInterval;
			globalThis.clearInterval = originalClearInterval;
			globalThis.setTimeout = originalSetTimeout;
			globalThis.clearTimeout = originalClearTimeout;
		},
	});
}

function cutStreamAfter(response: Response, delivery: "initial" | "update") {
	if (!response.body)
		throw new Error("generated realtime response has no body");
	const reader = response.body.getReader();
	const marker = `"delivery":"${delivery}"`;
	let observed = "";
	return new Response(
		new ReadableStream<Uint8Array>({
			async pull(controller) {
				const part = await reader.read();
				if (part.done) {
					controller.close();
					return;
				}
				controller.enqueue(part.value);
				observed += new TextDecoder().decode(part.value);
				if (observed.includes(marker)) controller.close();
			},
		}),
		{ headers: response.headers, status: response.status },
	);
}

function deferred() {
	let resolvePromise!: () => void;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
}

function valueDeferred<Value>() {
	let resolvePromise!: (value: Value) => void;
	const promise = new Promise<Value>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
}

afterAll(async () => {
	await database?.close({ timeout: 0 });
});

postgresTest(
	"reconciles a committed Message after lost wake and Runtime crash with fresh Context authority",
	async () => {
		const prepared = await prepareBeta05PostgresApplication(database!);
		const timers = installDeterministicNetworkTimers();
		const applications: GeneratedApplication[] = [];
		let blocker: Awaited<ReturnType<SQL["reserve"]>> | undefined;
		try {
			const migrations = await Promise.all(
				[
					"000001_create-collaboration",
					"000002_authorize-message-pages",
					"000003_publish-message-transaction",
					"000004_watch-message-query",
				].map((name) =>
					loadCommittedMigration(
						resolve(fixtureRoot, "questpie/migrations", name),
					),
				),
			);
			expect(await applyCommittedMigrations({ migrations })).toEqual(
				expect.objectContaining({ status: "applied" }),
			);

			const internal =
				(await prepared.generated.loadInternal()) as GeneratedInternal;
			const createApplication = async () => {
				const application = await internal.createApplication({
					postgres: { url: beta05PostgresUrl() },
					realtime: { hmacKey: new Uint8Array(32).fill(7) },
				});
				applications.push(application);
				return application;
			};
			const runtimeA = await createApplication();
			const commandRuntimeB = await createApplication();
			const acknowledgementRuntimeC = await createApplication();
			const user = prepared.generated.framework.principal.user({
				id: beta05Ids.principal,
			});
			const context = { companyId: beta05Ids.company };
			const queryInput = {
				after: null,
				channelId: beta05Ids.channel,
				first: 20,
			};
			const initialAcknowledged = deferred();
			const updateAcknowledged = deferred();
			const closeResponse = valueDeferred<number>();
			let downstream = 0;
			let initialScanRequested = false;
			let reconnectRuntime: GeneratedApplication | undefined;
			let reconnectResponse = valueDeferred<number>();
			const transport = async (request: Request): Promise<Response> => {
				const ingress = internal.bindIngressPrincipalForRequest(request, user);
				if (request.method === "GET") {
					downstream += 1;
					const runtime = downstream === 1 ? runtimeA : reconnectRuntime;
					if (!runtime) throw new Error("fresh reconnect Runtime is not ready");
					const response = await runtime.fetch(ingress);
					if (downstream > 1) reconnectResponse.resolve(response.status);
					if (downstream === 1) return cutStreamAfter(response, "initial");
					if (downstream === 2) return cutStreamAfter(response, "update");
					return response;
				}
				if (new URL(request.url).pathname === "/_questpie/operation")
					return runtimeA.fetch(ingress);
				const command = (await request.clone().json()) as Readonly<{
					command?: string;
				}>;
				const target =
					command.command === "ack" ? acknowledgementRuntimeC : commandRuntimeB;
				const response = await target.fetch(ingress);
				if (
					response.status === 202 &&
					command.command === "open" &&
					!initialScanRequested
				) {
					initialScanRequested = true;
					timers.runInterval(0);
				}
				if (response.status === 202 && command.command === "ack") {
					if (downstream === 1) initialAcknowledged.resolve();
					else updateAcknowledged.resolve();
				}
				if (command.command === "close") closeResponse.resolve(response.status);
				return response;
			};
			const client = prepared.generated.client.createClient({
				baseUrl: "http://runtime.test",
				fetch: transport,
			}) as GeneratedClient;
			const scope = client.withContext(context);
			const deliveries: Array<Readonly<{ page: MessagePage; kind: string }>> =
				[];
			const initialDelivered = deferred();
			const updateDelivered = deferred();
			const stop = scope.queries["messages.page"].watch(
				queryInput,
				(page, delivery) => {
					deliveries.push({ page, kind: delivery.kind });
					if (delivery.kind === "initial") initialDelivered.resolve();
					if (delivery.kind === "update") updateDelivered.resolve();
				},
			);
			await initialDelivered.promise;
			await initialAcknowledged.promise;
			expect(deliveries).toEqual([
				expect.objectContaining({
					kind: "initial",
					page: expect.objectContaining({
						nodes: [expect.objectContaining({ body: "one engine" })],
					}),
				}),
			]);

			await scope.mutations["message.publish"](
				{ channelId: beta05Ids.channel, body: "after lost wake" },
				{ callId: "beta07:lost-wake:publish" },
			);
			expect(timers.armedIntervals).toBe(3);
			expect(timers.invokedIntervals).toBe(1);
			expect(deliveries).toHaveLength(1);

			reconnectRuntime = await createApplication();
			timers.runReconnect();
			expect(await reconnectResponse.promise).toBe(200);
			await updateDelivered.promise;
			await updateAcknowledged.promise;
			expect(deliveries).toHaveLength(2);
			expect(deliveries[1]).toEqual(
				expect.objectContaining({
					kind: "update",
					page: expect.objectContaining({
						nodes: expect.arrayContaining([
							expect.objectContaining({ body: "one engine" }),
							expect.objectContaining({ body: "after lost wake" }),
						]),
					}),
				}),
			);

			await database!`
				update collaboration.memberships
				set status = 'inactive'
				where id = ${beta05Ids.membership}
			`;
			reconnectRuntime = await createApplication();
			reconnectResponse = valueDeferred<number>();
			blocker = await database!.reserve();
			await blocker.unsafe("BEGIN");
			await blocker.unsafe(
				"LOCK TABLE collaboration.memberships IN ACCESS EXCLUSIVE MODE",
			);
			timers.runReconnect();
			expect(await reconnectResponse.promise).toBe(200);
			let reachedRevokedContext = false;
			for (let attempt = 0; attempt < 200; attempt += 1) {
				const [blocked] = await database!.unsafe<
					ReadonlyArray<{ blocked: boolean }>
				>(`select exists (
				  select 1 from pg_catalog.pg_stat_activity
				  where pid <> pg_catalog.pg_backend_pid()
				    and state = 'active'
				    and query ilike '%collaboration%memberships%'
				    and pg_catalog.cardinality(pg_catalog.pg_blocking_pids(pid)) > 0
				) as blocked`);
				if (blocked?.blocked) {
					reachedRevokedContext = true;
					break;
				}
			}
			expect(reachedRevokedContext).toBe(true);
			await blocker.unsafe("COMMIT");
			await blocker.release();
			blocker = undefined;
			let revokedContextFinished = false;
			for (let attempt = 0; attempt < 200; attempt += 1) {
				const [active] = await database!.unsafe<
					ReadonlyArray<{ active: boolean }>
				>(`select exists (
				  select 1 from pg_catalog.pg_stat_activity
				  where pid <> pg_catalog.pg_backend_pid()
				    and state = 'active'
				    and query ilike '%collaboration%memberships%'
				) as active`);
				if (!active?.active) {
					revokedContextFinished = true;
					break;
				}
			}
			expect(revokedContextFinished).toBe(true);
			const [dirty] = await database!.unsafe<
				ReadonlyArray<{
					evaluated: string;
					invalidated: string;
				}>
			>(`select
			  evaluated_invalidation_generation::text as evaluated,
			  invalidation_generation::text as invalidated
			from questpie_internal.realtime_watch_bindings
			where application_name = 'collaboration' and state = 'open'`);
			expect(BigInt(dirty!.invalidated)).toBeGreaterThan(
				BigInt(dirty!.evaluated),
			);
			expect(deliveries).toHaveLength(2);
			expect(timers.invokedIntervals).toBe(1);

			stop();
			expect(await closeResponse.promise).toBe(202);
			expect(downstream).toBe(3);
		} finally {
			if (blocker) {
				await blocker.unsafe("ROLLBACK").catch(() => {});
				await blocker.release();
			}
			await Promise.allSettled(
				applications.map((application) => application.close()),
			);
			timers.restore();
			await prepared.dispose();
		}
	},
	30_000,
);
