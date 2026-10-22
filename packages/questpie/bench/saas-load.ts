/** Real TCP HTTP/SSE, two OS web processes and disk-backed PostgreSQL.
 * Synthetic B2B workload, not an Autopilot end-to-end capacity claim.
 */
import os from "node:os";

import pg from "pg";

import { parseCompatibleTypedEventWire } from "../src/shared/typed-wire.js";
import {
	seedSaas,
	tenants,
	url,
	tunedReads,
	preparedAuth,
} from "./saas-app.js";

if (Number(process.env.BUN_CONFIG_MAX_HTTP_REQUESTS ?? 256) < 4096)
	throw new Error(
		"Run with BUN_CONFIG_MAX_HTTP_REQUESTS=4096: SSE must not exhaust the load generator fetch budget",
	);
const pool = new pg.Pool({ connectionString: url, max: 4 });
const mode = process.env.SAAS_ACCESS_SHARING ?? "default";
const durationMs = Number(process.env.SAAS_DURATION_MS ?? 30000);
const selected = (
	process.env.SAAS_SCENARIOS ?? "50:20,250:40,1000:100,250:40:faults"
).split(",");
const percentile = (values: number[], fraction: number) =>
	values.sort((a, b) => a - b)[
		Math.min(values.length - 1, Math.floor(values.length * fraction))
	] ?? null;
async function until(check: () => boolean, timeout = 15000) {
	const end = Date.now() + timeout;
	for (;;) {
		if (check()) return;
		if (Date.now() > end) throw new Error("Timed out waiting for worker");
		await Bun.sleep(20);
	}
}
function pod() {
	const messages: any[] = [];
	const child = Bun.spawn(
		[process.execPath, new URL("./saas-pod.ts", import.meta.url).pathname],
		{
			env: process.env,
			stdout: "ignore",
			stderr: "inherit",
			ipc(message) {
				messages.push(message);
			},
		},
	);
	return {
		child,
		messages,
		url: "",
		dead: false,
		async start() {
			await until(() => messages.some((m) => m.ready));
			this.url = messages.find((m) => m.ready).url;
		},
		async send(operation: string) {
			const request = crypto.randomUUID();
			child.send({ operation, request });
			await until(() => messages.some((m) => m.request === request));
			return messages.find((m) => m.request === request);
		},
	};
}
async function databaseStats() {
	return {
		statements: (
			await pool.query(
				"select query,calls::float8,rows::float8,total_exec_time from pg_stat_statements where dbid=(select oid from pg_database where datname=current_database()) and query not like '%pg_stat_statements%'",
			)
		).rows,
		wal: Number(
			(await pool.query("select wal_bytes from pg_stat_wal")).rows[0].wal_bytes,
		),
		counts: (
			await pool.query(
				"select (select count(*) from questpie_channel_event)::int as events,(select count(*) from questpie_channel_presence)::int as presence,(select count(*) from questpie_realtime_log)::int as outbox",
			)
		).rows[0],
	};
}
async function scenario(label: string) {
	const [userText, pageText, kind] = label.split(":");
	const users = Number(userText),
		pages = Number(pageText),
		faults = kind === "faults",
		control = kind === "control";
	if (pages % tenants || users > 2000)
		throw new Error(
			"Pages must divide evenly into the 20 fixture tenants; max 2000 users",
		);
	await pool.query(
		"update saas_memberships set active=true where actor='actor-0'",
	);
	let pods = [pod(), pod()];
	await Promise.all(pods.map((p) => p.start()));
	const pending = new Set<Promise<unknown>>();
	const timings: Record<string, number[]> = {
		cursor: [],
		save: [],
		list: [],
		refetch: [],
		delivery: [],
		slowDelivery: [],
		activity: [],
		reconnect: [],
	};
	const statuses: Record<string, number> = {};
	const errorMessages: Record<string, number> = {};
	let running = true,
		measuring = false,
		attempted = 0,
		skipped = 0,
		missedTicks = 0,
		pendingMax = 0,
		frames = 0,
		presenceFrames = 0,
		activityFrames = 0,
		leaks = 0,
		ready = 0,
		closes = 0,
		revokedAt = 0,
		revocationMs: number | null = null;
	let queueUsageMax = 0,
		dbConnectionsMax = 0,
		snapshotFrames = 0;
	let phaseStartedAt = 0;
	const snapshotLatency: number[] = [];
	const waits: Record<string, number> = {};
	const latestSent = new Map<number, number>();
	const progress = new Map<string, number>();
	type Client = {
		i: number;
		tenant: number;
		page: number;
		home: number;
		slow: boolean;
		ready: boolean;
		controller?: AbortController;
		session?: { sessionId: string; token: string };
		refetching: boolean;
		cursorPending: boolean;
		reconnectAt?: number;
	};
	const clients: Client[] = Array.from({ length: users }, (_, i) => ({
		i,
		tenant: i % tenants,
		page: i % pages,
		home: Math.floor(i / pages) % 2,
		slow: i % 20 === 19,
		ready: false,
		refetching: false,
		cursorPending: false,
	}));
	function isRunning() {
		return running;
	}
	function track(task: Promise<unknown>) {
		pending.add(task);
		pendingMax = Math.max(pendingMax, pending.size);
		void task.finally(() => pending.delete(task));
	}
	function headers(i: number) {
		return {
			authorization: `Bearer fixture-${i}`,
			"content-type": "application/json",
		};
	}
	async function post(
		client: Client,
		operation: string,
		body: object,
		index = 1 - client.home,
	) {
		const start = performance.now();
		if (measuring) attempted++;
		try {
			const response = await fetch(
				pods[index]!.url +
					`bench/${operation === "refetch" ? "list" : operation}`,
				{
					method: "POST",
					headers: headers(client.i),
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(10000),
				},
			);
			const text = await response.text();
			if (measuring) {
				const key = `${operation}:${response.status}`;
				statuses[key] = (statuses[key] ?? 0) + 1;
				timings[operation]!.push(performance.now() - start);
			}
			if (response.ok) {
				if (operation === "list" || operation === "refetch") {
					const parsed = JSON.parse(text);
					if (
						parsed.items.some(
							(row: { tenant: number }) => row.tenant !== client.tenant,
						)
					)
						leaks++;
				}
				if (operation === "cursor")
					latestSent.set(client.i, (body as { seq: number }).seq);
			} else if (measuring) {
				const key = `${operation}:${text.slice(0, 200)}`;
				errorMessages[key] = (errorMessages[key] ?? 0) + 1;
			}
			return response.status;
		} catch (error) {
			if (measuring) {
				const key = `${operation}:${String(error).slice(0, 160)}`;
				errorMessages[key] = (errorMessages[key] ?? 0) + 1;
				statuses[`${operation}:network`] =
					(statuses[`${operation}:network`] ?? 0) + 1;
				timings[operation]!.push(performance.now() - start);
			}
			return 0;
		}
	}
	function refetch(client: Client) {
		if (!measuring || client.refetching) return;
		client.refetching = true;
		track(
			post(client, "refetch", { tenant: client.tenant }).finally(() => {
				client.refetching = false;
			}),
		);
	}
	async function stream(client: Client) {
		let attempt = 0;
		while (isRunning()) {
			const controller = new AbortController();
			client.controller = controller;
			const index = attempt ? (client.home + attempt) % 2 : client.home;
			try {
				const response = await fetch(pods[index]!.url + "realtime", {
					method: "POST",
					headers: headers(client.i),
					body: JSON.stringify({
						topics:
							client.i % 10 === 5
								? [
										{
											id: "tasks",
											resourceType: "collection",
											resource: "tasks",
											operation: "find",
											where: { tenant: client.tenant },
											...(tunedReads
												? {
														columns: {
															id: true,
															tenant: true,
															space: true,
															title: true,
															status: true,
															revision: true,
															updatedAt: true,
														},
													}
												: {}),
											limit: 20,
											orderBy: { updatedAt: "desc" },
										},
									]
								: [],
						channels: [
							...(!control
								? [
										{
											id: "page",
											channel: "page",
											params: { pageId: String(client.page) },
										},
									]
								: []),
							{
								id: "activity",
								channel: "activity",
								params: { tenant: String(client.tenant) },
							},
						],
					}),
					signal: controller.signal,
				});
				if (!response.ok)
					throw new Error(
						`stream status ${response.status}: ${(await response.text()).slice(0, 100)}`,
					);
				const reader = response.body!.getReader();
				let buffer = "";
				try {
					while (isRunning()) {
						const next = await reader.read();
						if (next.done) break;
						if (client.slow && measuring) await Bun.sleep(500);
						buffer += new TextDecoder().decode(next.value);
						let end: number;
						while ((end = buffer.indexOf("\n\n")) >= 0) {
							const frame = buffer.slice(0, end);
							buffer = buffer.slice(end + 2);
							const lines = frame.split("\n"),
								event = lines
									.find((line) => line.startsWith("event: "))
									?.slice(7),
								data = lines
									.find((line) => line.startsWith("data: "))
									?.slice(6);
							if (!data) continue;
							const payload = parseCompatibleTypedEventWire(data) as any;
							if (event === "session") client.session = payload;
							if (
								event === "channel_ready" &&
								payload.channelSubscriptionId ===
									(control ? "activity" : "page")
							) {
								if (!client.ready) {
									client.ready = true;
									ready++;
								}
								if (client.reconnectAt) {
									timings.reconnect!.push(Date.now() - client.reconnectAt);
									delete client.reconnectAt;
								}
							}
							if (!measuring && event !== "error") continue;
							if (event === "error") {
								const key = `sse:${payload.message ?? payload.code ?? "error"}`;
								errorMessages[key] = (errorMessages[key] ?? 0) + 1;
								if (client.i === 0 && revokedAt && revocationMs === null)
									revocationMs = Date.now() - revokedAt;
							}
							if (event === "snapshot") {
								snapshotFrames++;
								if (
									payload.data.docs.some(
										(row: { tenant: number }) => row.tenant !== client.tenant,
									)
								)
									leaks++;
								const revision = Math.max(
									0,
									...payload.data.docs.map(
										(row: { revision: number }) => row.revision,
									),
								);
								if (revision >= phaseStartedAt)
									snapshotLatency.push(Date.now() - revision);
							}
							if (event === "channel_presence") {
								presenceFrames++;
								if (
									payload.members.some(
										(m: { id: string }) =>
											Number(m.id.slice(6)) % tenants !== client.tenant,
									)
								)
									leaks++;
							}
							if (event === "channel_ephemeral") {
								frames++;
								if (
									payload.data.tenant !== client.tenant ||
									payload.data.pageId !== client.page
								)
									leaks++;
								const latency = Date.now() - payload.data.sentAt;
								timings[client.slow ? "slowDelivery" : "delivery"]!.push(
									latency,
								);
								progress.set(
									`${client.i}:${payload.data.actor.slice(6)}`,
									payload.data.seq,
								);
							}
							if (event === "channel_event") {
								activityFrames++;
								if (payload.data.tenant !== client.tenant) leaks++;
								timings.activity!.push(Date.now() - payload.data.sentAt);
								refetch(client);
							}
						}
					}
				} finally {
					await reader.cancel().catch(() => {});
				}
			} catch (error) {
				if (running) {
					const key = String(error).slice(0, 180);
					errorMessages[key] = (errorMessages[key] ?? 0) + 1;
				}
			}
			if (!running) break;
			if (client.ready) {
				client.ready = false;
				ready--;
			}
			if (measuring) {
				closes++;
				client.reconnectAt ??= Date.now();
			}
			attempt++;
			await Bun.sleep(100);
		}
	}
	const readers: Promise<unknown>[] = [];
	try {
		// Bounded admission ramp. Every stream uses a real independent TCP fetch.
		for (let start = 0; start < users; start += 25) {
			for (const client of clients.slice(start, start + 25))
				readers.push(stream(client));
			await Bun.sleep(20);
		}
		try {
			await until(() => ready === users, 30000);
		} catch (error) {
			const result = {
				label,
				stage: "admission",
				ready,
				users,
				pages,
				errorMessages,
				pods: await Promise.all(pods.map((p) => p.send("stats"))),
				error: String(error),
			};
			console.log(JSON.stringify(result));
			return result;
		}
		// Tenant denial probes exercise the same HTTP/session/RBAC/page path.
		const probe = await post(clients[0]!, "list", { tenant: 1 });
		const publishProbe = await post(clients[0]!, "cursor", {
			pageId: 1,
			seq: 0,
			sentAt: Date.now(),
			x: 1,
			y: 1,
		});
		if (probe !== 403 || publishProbe !== 403)
			throw new Error(`Tenant denial probes failed: ${probe},${publishProbe}`);
		const before = await databaseStats();
		const podBefore = await Promise.all(pods.map((p) => p.send("stats")));
		const start = Date.now();
		phaseStartedAt = start;
		measuring = true;
		const sampler = (async () => {
			while (isRunning()) {
				const rows = await pool.query(
					"select coalesce(wait_event_type,'CPU')||'/'||coalesce(wait_event,'running') as event,count(*)::int as n from pg_stat_activity where datname=current_database() and state='active' and pid<>pg_backend_pid() group by 1",
				);
				for (const row of rows.rows)
					waits[row.event] = (waits[row.event] ?? 0) + row.n;
				const status = (
					await pool.query(
						"select pg_notification_queue_usage() as queue,(select count(*)::int from pg_stat_activity) as connections",
					)
				).rows[0];
				queueUsageMax = Math.max(queueUsageMax, status.queue);
				dbConnectionsMax = Math.max(dbConnectionsMax, status.connections);
				await Bun.sleep(1000);
			}
		})();
		let tick = 0,
			next = start,
			revoked = false,
			restarted = false;
		while (Date.now() - start < durationMs) {
			const now = Date.now();
			if (now - next > 100) {
				missedTicks += Math.floor((now - next) / 100);
				next = now;
			}
			const active = clients.filter(
				(client) => (Math.floor(client.i / pages) + client.i) % 5 === 0,
			);
			if (!control)
				for (const client of active) {
					if (client.cursorPending || pending.size > 2048) {
						skipped++;
						continue;
					}
					client.cursorPending = true;
					track(
						post(client, "cursor", {
							pageId: client.page,
							seq: tick,
							sentAt: next,
							x: tick % 1000,
							y: client.i,
						}).finally(() => {
							client.cursorPending = false;
						}),
					);
				}
			// Steady 20/50/100 writes/s at 50/250/1000 users; writes traverse CRUD,
			// outbox capture and one durable invalidation for every five saves.
			const saves = Math.min(10, Math.max(2, Math.ceil(users / 50)));
			for (let n = 0; n < saves; n++) {
				const client = clients[(tick * saves + n) % users]!;
				if (pending.size < 2048)
					track(
						post(client, "save", {
							taskId: `task-${client.i}`,
							sentAt: Date.now(),
							body: `revision ${tick} ${"x".repeat(1024)}`,
						}),
					);
				else skipped++;
			}
			for (let n = 0; n < saves; n++) {
				const client = clients[(tick * 7 + n) % users]!;
				if (pending.size < 2048)
					track(post(client, "list", { tenant: client.tenant }));
				else skipped++;
			}
			if (faults && !revoked && now - start > durationMs / 3) {
				revoked = true;
				await pool.query(
					"update saas_memberships set active=false where actor='actor-0'",
				);
				revokedAt = Date.now();
				for (const client of clients.filter((c) => c.i > 0 && c.i % 10 === 0)) {
					client.reconnectAt = Date.now();
					client.controller?.abort();
				}
			}
			if (faults && !restarted && now - start > (durationMs * 2) / 3) {
				restarted = true;
				pods[0]!.dead = true;
				pods[0]!.child.kill();
				const replacement = pod();
				await replacement.start();
				pods[0] = replacement;
			}
			tick++;
			next += 100;
			await Bun.sleep(Math.max(0, next - Date.now()));
		}
		await Promise.allSettled(pending);
		await Bun.sleep(1000);
		const elapsedMs = Date.now() - start;
		const after = await databaseStats();
		const podAfter = await Promise.all(pods.map((p) => p.send("stats")));
		running = false;
		await sampler;
		const statements = after.statements
			.map((a) => {
				const b = before.statements.find((b) => b.query === a.query);
				return {
					query: a.query,
					calls: a.calls - (b?.calls ?? 0),
					rows: a.rows - (b?.rows ?? 0),
					executionMs: a.total_exec_time - (b?.total_exec_time ?? 0),
				};
			})
			.filter((q) => q.calls > 0);
		const notify = statements.filter((q) =>
			q.query.startsWith("select pg_notify("),
		);
		let expectedLatest = 0,
			receivedLatest = 0;
		for (const [actor, seq] of latestSent) {
			if (actor === 0 && revoked) continue;
			for (const client of clients) {
				if (client.page !== actor % pages) continue;
				if (client.slow) continue;
				expectedLatest++;
				if ((progress.get(`${client.i}:${actor}`) ?? -1) >= seq)
					receivedLatest++;
			}
		}
		const result = {
			label,
			tunedReads,
			preparedAuth,
			accessSharing: mode,
			users,
			pages,
			tenants,
			pods: 2,
			durationMs,
			elapsedMs,
			activePublishers: control
				? 0
				: clients.filter((c) => (Math.floor(c.i / pages) + c.i) % 5 === 0)
						.length,
			ticks: tick,
			attempted,
			skipped,
			missedTicks,
			pendingMax,
			statuses,
			errorMessages,
			frames,
			presenceFrames,
			activityFrames,
			snapshotFrames,
			closes,
			leaks,
			revocationMs,
			expectedLatest,
			receivedLatest,
			snapshotLatency: {
				count: snapshotLatency.length,
				p95: percentile(snapshotLatency, 0.95),
				p99: percentile(snapshotLatency, 0.99),
			},
			latency: Object.fromEntries(
				Object.entries(timings).map(([name, values]) => [
					name,
					{
						count: values.length,
						p50: percentile(values, 0.5),
						p95: percentile(values, 0.95),
						p99: percentile(values, 0.99),
					},
				]),
			),
			notifies: notify.reduce((n, q) => n + q.rows, 0),
			notifySqlCalls: notify.reduce((n, q) => n + q.calls, 0),
			walBytes: after.wal - before.wal,
			ledgerInserts: after.counts.events - before.counts.events,
			presenceRows: after.counts.presence - before.counts.presence,
			outboxInserts: after.counts.outbox - before.counts.outbox,
			queueUsageMax,
			dbConnectionsMax,
			postgresWaitSamples: waits,
			podBefore,
			podAfter,
			topSqlByTime: statements
				.sort((a, b) => b.executionMs - a.executionMs)
				.slice(0, 12),
			generator: {
				cpu: process.cpuUsage(),
				rss: process.memoryUsage().rss,
				loadAverage: os.loadavg(),
			},
		};
		console.log(JSON.stringify(result));
		return result;
	} finally {
		running = false;
		for (const client of clients) client.controller?.abort();
		await Promise.allSettled(readers);
		await Promise.allSettled(pending);
		for (const p of pods) {
			if (!p.dead) {
				try {
					await p.send("stop");
				} catch {}
				p.child.kill();
			}
		}
	}
}
try {
	await seedSaas();
	const results = [];
	for (const label of selected) results.push(await scenario(label));
	console.log(
		JSON.stringify(
			{
				environment: {
					bun: Bun.version,
					postgres: (await pool.query("select version() as version")).rows[0]
						.version,
					cpu: os.cpus()[0]?.model,
					cpus: os.cpus().length,
					hostMemory: os.totalmem(),
					databaseBytes: (
						await pool.query(
							"select pg_database_size(current_database()) as size",
						)
					).rows[0].size,
				},
				results,
			},
			null,
			2,
		),
	);
} finally {
	await pool.end();
}
