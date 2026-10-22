import { expect, test } from "bun:test";

import { z } from "zod";

import { createClient } from "../../src/client/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { channel } from "../../src/server/channels/channel-builder.js";
import { InProcessEphemeralBroker } from "../../src/server/channels/ephemeral-broker.js";
import { ChannelTokenBucketLimiter } from "../../src/server/channels/security.js";
import {
	questpieChannelEventTable,
	questpieChannelHeadTable,
	questpieChannelPresenceTable,
	questpieChannelAuthorityFenceTable,
} from "../../src/server/modules/core/integrated/realtime/collection.js";
import { setChannelPublishLimiterForTests } from "../../src/server/modules/core/routes/channels/_shared.js";
import { service } from "../../src/server/services/define-service.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, timeoutMs = 3000) {
	for (let i = 0; i < timeoutMs / 10; i++) {
		if (check()) return;
		await wait(10);
	}
	throw new Error("Timed out waiting for SSE client");
}

class DisconnectableBroker extends InProcessEphemeralBroker {
	disconnect?: (error: unknown) => void;
	override async start(
		onMessage: (message: string) => void,
		onDisconnect?: (error: unknown) => void,
	) {
		this.disconnect = onDisconnect;
		await super.start(onMessage);
	}
}

test("HTTP + public client: shared SSE, dates, limits, no ledger/presence rows and idle access loss", async () => {
	let allowed = true;
	let session: any = { user: { id: "ada" }, session: { id: "ada-session" } };
	const setup = await buildMockApp(
		{
			channels: {
				page: channel("page-[id]")
					.events({
						cursor: z.object({ x: z.number(), at: z.date() }),
						typing: z.string(),
					})
					.authorize({
						subscribe: ({ session }) => allowed && !!session,
						publish: ({ session }) => allowed && !!session,
					})
					.presence(({ session }) => ({ id: session!.user.id }))
					.ephemeral(),
			},
		},
		{
			app: { url: "http://localhost:3000" },
			realtime: {
				retentionDays: 0,
				ephemeral: {
					authorizationIntervalMs: 30,
					heartbeatMs: 50,
					leaseMs: 200,
				},
			},
		},
	);
	let streams = 0;
	const requests: any[] = [];
	let client: ReturnType<typeof createClient<any>> | undefined;
	try {
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, {
			getSession: async () => session,
		});
		client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: async (input, init) => {
				const request = new Request(input as string, init);
				if (request.url.endsWith("/realtime") && init?.body) {
					const body = JSON.parse(String(init.body));
					requests.push(body);
					if (body.channels) streams++;
				}
				return handler(request);
			},
		});
		const events: any[] = [],
			presence: any[] = [],
			errors: Error[] = [];
		const one = client.channels.page({ id: "one" });
		let ready = false;
		const stop = one.subscribe((message: any) => events.push(message), {
			onReady: () => {
				ready = true;
			},
			onError: (e: Error) => errors.push(e),
		});
		const stopPresence = one.subscribePresence((members: any[]) =>
			presence.push(members),
		);
		await until(
			() => ready && presence.some((members) => members.length === 1),
		);
		const at = new Date("2026-10-22T10:00:00Z");
		await one.publish("cursor", { x: 1, at });
		await one.publish("cursor", { x: 2, at });
		await until(() => events.length === 1);
		expect(events[0].data).toEqual({ x: 2, at });
		expect(streams).toBe(1);
		await expect(one.publish("typing", "é".repeat(600))).rejects.toThrow();
		const post = (data: string) =>
			handler(
				new Request("http://localhost:3000/channels/publish", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						channel: "page",
						params: { id: "one" },
						event: "typing",
						data,
					}),
				}),
			);
		expect((await post("é".repeat(600))).status).toBe(413);
		setChannelPublishLimiterForTests(
			setup.app,
			new ChannelTokenBucketLimiter({ ratePerSecond: 1, burst: 1 }),
		);
		expect((await post("typing")).status).toBe(200);
		expect((await post("typing")).status).toBe(429);

		const replay = await handler(
			new Request("http://localhost:3000/channels/replay", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					channel: "page",
					params: { id: "one" },
					afterEventId: "ignored",
				}),
			}),
		);
		expect(replay.status).toBe(409);
		for (const table of [
			questpieChannelEventTable,
			questpieChannelHeadTable,
			questpieChannelPresenceTable,
			questpieChannelAuthorityFenceTable,
		])
			expect(await setup.app.db.select().from(table)).toEqual([]);
		allowed = false;
		await until(() => errors.length > 0);
		const count = events.length;
		await wait(120);
		expect(events).toHaveLength(count);
		stop();
		stopPresence();
		session = null;
		const denied = await handler(
			new Request("http://localhost:3000/realtime", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					channels: [{ id: "denied", channel: "page", params: { id: "one" } }],
				}),
			}),
		);
		expect(denied.status).toBeGreaterThanOrEqual(400);
		expect(
			requests.every((r) => !r.channels?.some((c: any) => c.lastEventId)),
		).toBe(true);
	} finally {
		client?.channels.destroy();
		await setup.cleanup();
	}
}, 15_000);

test("revoking an ephemeral binding ends its client epoch while another channel keeps the shared SSE open", async () => {
	let allowed = true;
	const setup = await buildMockApp(
		{
			channels: {
				page: channel("mixed-page-[id]")
					.events({ cursor: z.number() })
					.authorize({ subscribe: () => allowed, publish: true })
					.presence(() => ({ id: "ada" }))
					.ephemeral(),
				activity: channel("mixed-activity")
					.events({ changed: z.number() })
					.authorize({ subscribe: true, publish: true }),
			},
		},
		{
			realtime: {
				retentionDays: 0,
				ephemeral: { authorizationIntervalMs: 20 },
			},
		},
	);
	let client: ReturnType<typeof createClient<any>> | undefined;
	try {
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, {
			getSession: async () => ({
				user: { id: "ada" },
				session: { id: "ada-session" },
			}),
		});
		client = createClient<any>({
			baseURL: "http://localhost",
			fetch: async (input, init) => handler(new Request(input as string, init)),
		});
		const errors: Error[] = [],
			activity: number[] = [];
		let pageReady = false,
			activityReady = false;
		const page = client.channels.page({ id: "one" });
		const stopPage = page.subscribe(() => {}, {
			onReady: () => {
				pageReady = true;
			},
			onError: (error: Error) => errors.push(error),
		});
		let members: unknown[] = [];
		const stopPresence = page.subscribePresence((value: unknown[]) => {
			members = value;
		});
		const stopActivity = client.channels.activity.subscribe(
			(message: { data: number }) => activity.push(message.data),
			{
				onReady: () => {
					activityReady = true;
				},
			},
		);
		await until(() => pageReady && activityReady && members.length === 1);
		expect(await page.presence()).toEqual([{ id: "ada" }]);
		allowed = false;
		await until(() => errors.length > 0);
		await client.channels.activity.publish("changed", 42);
		await until(() => activity.includes(42));
		stopPage();
		stopPresence();
		stopActivity();
	} finally {
		client?.channels.destroy();
		await setup.cleanup();
	}
}, 10000);

test("timer-driven ephemeral authorization owns a fresh disposable service scope", async () => {
	let allowed = true,
		created = 0,
		disposed = 0;
	const setup = await buildMockApp(
		{
			services: {
				policy: service()
					.lifecycle("request")
					.create(() => {
						created++;
						return { allowed };
					})
					.dispose(() => {
						disposed++;
					}),
			},
			channels: {
				page: channel("scoped-page")
					.events({ cursor: z.number() })
					.authorize({
						subscribe: (ctx) => (ctx as any).services.policy.allowed,
						publish: true,
					})
					.ephemeral(),
			},
		},
		{
			realtime: {
				retentionDays: 0,
				ephemeral: { authorizationIntervalMs: 20 },
			},
		},
	);
	let client: ReturnType<typeof createClient<any>> | undefined;
	try {
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, {
			getSession: async () => ({
				user: { id: "ada" },
				session: { id: "ada-session" },
			}),
		});
		client = createClient<any>({
			baseURL: "http://localhost",
			fetch: async (input, init) => handler(new Request(input as string, init)),
		});
		let ready = false;
		const errors: Error[] = [],
			events: number[] = [];
		const stop = client.channels.page.subscribe(
			(message: { data: number }) => events.push(message.data),
			{
				onReady: () => {
					ready = true;
				},
				onError: (error: Error) => errors.push(error),
			},
		);
		await until(() => ready);
		await wait(100);
		expect(errors).toEqual([]);
		expect(created).toBeGreaterThan(2);
		await client.channels.page.publish("cursor", 1);
		await until(() => events.includes(1));
		allowed = false;
		await until(() => errors.length > 0);
		await until(() => disposed === created);
		stop();
	} finally {
		client?.channels.destroy();
		await setup.cleanup();
	}
}, 10000);

test("a broker blip reconnects the shared SSE without removing logical subscriptions", async () => {
	const broker = new DisconnectableBroker();
	const setup = await buildMockApp(
		{
			channels: {
				page: channel("reconnecting-page")
					.events({ cursor: z.number() })
					.authorize({ subscribe: true, publish: true })
					.ephemeral(),
			},
		},
		{ realtime: { retentionDays: 0, ephemeral: { broker } } },
	);
	let client: ReturnType<typeof createClient<any>> | undefined;
	try {
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, {
			getSession: async () => ({
				user: { id: "ada" },
				session: { id: "ada-session" },
			}),
		});
		client = createClient<any>({
			baseURL: "http://localhost",
			fetch: async (input, init) => handler(new Request(input as string, init)),
		});
		let ready = 0,
			notReady = 0;
		const events: number[] = [],
			errors: Error[] = [];
		const stop = client.channels.page.subscribe(
			(message: { data: number }) => events.push(message.data),
			{
				onReady: () => {
					ready++;
				},
				onNotReady: () => {
					notReady++;
				},
				onError: (error: Error) => errors.push(error),
			},
		);
		await until(() => ready === 1);
		await client.channels.page.publish("cursor", 1);
		await until(() => events.includes(1));
		broker.disconnect!(new Error("transient LISTEN loss"));
		await until(() => ready >= 2);
		expect(notReady).toBeGreaterThan(0);
		await client.channels.page.publish("cursor", 2);
		await until(() => events.includes(2));
		expect(errors).toEqual([]);
		stop();
	} finally {
		client?.channels.destroy();
		await setup.cleanup();
	}
}, 10000);

for (const scenario of ["alone", "mixed", "incremental", "timeout"] as const) {
	const withSibling = scenario === "mixed" || scenario === "incremental";
	test(`ACL infrastructure recovery (${scenario})`, async () => {
		const broker = new DisconnectableBroker();
		let failing = false;
		const setup = await buildMockApp(
			{
				channels: {
					page: channel("recovering-acl-page")
						.events({ cursor: z.number() })
						.authorize({
							subscribe: async () => {
								if (failing && scenario === "timeout")
									return new Promise<boolean>(() => {});
								if (failing) throw new Error("database unavailable");
								return true;
							},
							publish: true,
						})
						.ephemeral(),
					activity: channel("recovering-acl-activity")
						.events({ changed: z.number() })
						.authorize({ subscribe: true }),
				},
			},
			{
				realtime: {
					retentionDays: 0,
					ephemeral: { broker },
					channelSecurity: { authorizationTimeoutMs: 20 },
				},
			},
		);
		let client: ReturnType<typeof createClient<any>> | undefined;
		try {
			await runTestDbMigrations(setup.app);
			const handler = createFetchHandler(setup.app, {
				getSession: async () => ({
					user: { id: "ada" },
					session: { id: "ada-session" },
				}),
			});
			const statuses: number[] = [];
			client = createClient<any>({
				baseURL: "http://localhost",
				fetch: async (input, init) => {
					const response = await handler(new Request(input as string, init));
					if (response.status === 503) {
						statuses.push(response.status);
						failing = false;
					}
					return response;
				},
			});
			let ready = 0;
			const errors: Error[] = [];
			const events: number[] = [];
			if (scenario === "incremental") {
				let siblingReady = false;
				client.channels.activity.subscribe(() => {}, {
					onReady: () => {
						siblingReady = true;
					},
				});
				await until(() => siblingReady);
				failing = true;
			}
			client.channels.page.subscribe(
				(event: { data: number }) => events.push(event.data),
				{
					onReady: () => {
						ready++;
					},
					onError: (error: Error) => errors.push(error),
				},
			);
			if (scenario === "mixed") client.channels.activity.subscribe(() => {});
			if (scenario !== "incremental") {
				await until(() => ready === 1);
				failing = true;
				broker.disconnect!(
					new Error("LISTEN reconnect during database failover"),
				);
			}
			await until(() => ready >= (scenario === "incremental" ? 1 : 2), 10000);
			expect(statuses).toEqual([503]);
			expect(errors).toEqual([]);
			expect(client.channels.channelCount).toBe(withSibling ? 2 : 1);
			await client.channels.page.publish("cursor", 7);
			await until(() => events.includes(7));
		} finally {
			client?.channels.destroy();
			await setup.cleanup();
		}
	}, 15000);
}
