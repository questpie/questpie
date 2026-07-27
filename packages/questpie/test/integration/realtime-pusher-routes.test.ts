import { afterEach, describe, expect, test } from "bun:test";

import {
	createAdapterRoutes,
	createFetchHandler,
} from "../../src/server/adapters/http.js";
import { collection } from "../../src/server/collection/builder/collection-builder.js";
import {
	PusherClientTransport,
	type PusherProvider,
} from "../../src/server/modules/core/integrated/realtime/pusher-transport.js";
import type {
	ChangeBroker,
	ChangeWake,
} from "../../src/server/modules/core/integrated/realtime/transport.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestDb, runTestDbMigrations } from "../utils/test-db.js";

class SharedChangeBus {
	private readonly listeners = new Set<(wake: ChangeWake) => void>();

	createBroker(): ChangeBroker {
		let listener: ((wake: ChangeWake) => void) | undefined;
		return {
			start: async ({ onWake, onStateChange }) => {
				listener = onWake;
				this.listeners.add(onWake);
				onStateChange?.("connected");
			},
			publish: async (wake) => {
				for (const onWake of this.listeners) onWake(wake);
			},
			stop: async () => {
				if (listener) this.listeners.delete(listener);
			},
		};
	}
}

async function waitFor(assertion: () => boolean, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for cross-instance Pusher topology");
}

const provider: PusherProvider = {
	trigger: async () => {},
	authorizeChannel: (socketId, channel) => ({
		auth: `${socketId}:${channel}`,
	}),
	authenticateUser: (socketId, user) => ({
		auth: `${socketId}:${user.id}`,
		user_data: JSON.stringify(user),
	}),
	terminateUserConnections: async () => {},
	getPresenceMemberCount: async () => 0,
};

describe("pusher channel matrix module routes", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>> | undefined;

	afterEach(async () => {
		await setup?.cleanup();
		setup = undefined;
	});

	test("exposes secret-free config and no-store session-bound auth", async () => {
		const transport = new PusherClientTransport({
			provider,
			key: "public-key",
			identityKey: "never-expose-this-secret",
			wsHost: "soketi.internal",
			forceTLS: false,
		});
		setup = await buildMockApp(
			{},
			{ realtime: { clientTransport: transport, retentionDays: 0 } },
		);
		const sessionId = "018f1d92-7ab0-7d68-a230-000000000001";
		await setup.app.realtime.openClientSession({
			sessionId,
			principal: null,
			resolvePrincipal: async () => null,
		});
		const channel = transport.getSessionChannel(sessionId);
		const handler = createFetchHandler(setup.app);

		const configResponse = await handler(
			new Request("http://localhost/realtime/config"),
		);
		expect(configResponse.status).toBe(200);
		expect(configResponse.headers.get("cache-control")).toBe("no-store");
		const serializedConfig = JSON.stringify(await configResponse.json());
		expect(serializedConfig).toContain("public-key");
		expect(serializedConfig).toContain("soketi.internal");
		expect(serializedConfig).not.toContain("never-expose-this-secret");

		const body = new FormData();
		body.set("socket_id", "123.456");
		body.set("channel_name", channel);
		const authResponse = await handler(
			new Request("http://localhost/realtime/auth", {
				method: "POST",
				body,
			}),
		);
		expect(authResponse.status).toBe(200);
		expect(authResponse.headers.get("cache-control")).toBe("no-store");
		expect(await authResponse.json()).toEqual({
			auth: `123.456:${channel}`,
		});
	});

	test("rejects auth for an inactive private channel", async () => {
		const transport = new PusherClientTransport({
			provider,
			key: "public-key",
			identityKey: "test-secret",
		});
		setup = await buildMockApp(
			{},
			{ realtime: { clientTransport: transport, retentionDays: 0 } },
		);
		const handler = createFetchHandler(setup.app);
		const response = await handler(
			new Request("http://localhost/realtime/auth", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					socket_id: "123.456",
					channel_name: "private-questpie-rt-deadbeef",
				}),
			}),
		);

		expect(response.status).toBe(403);
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	test("releases principal admission when provider config loading fails", async () => {
		setup = await buildMockApp(
			{},
			{
				realtime: {
					admission: { maxConnectionsPerPrincipal: 1 },
					retentionDays: 0,
				},
			},
		);
		let configCalls = 0;
		const realtime = setup.app.realtime as typeof setup.app.realtime & {
			getClientTransportConfig(): Promise<never>;
		};
		realtime.getClientTransportConfig = async () => {
			configCalls += 1;
			throw new Error("provider config unavailable");
		};
		const handler = createFetchHandler(setup.app, {
			getSession: async () => ({
				user: { id: "admission-user" },
				session: { id: "admission-session" },
			}),
		});
		const request = () =>
			new Request("http://localhost/realtime", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					transport: "shared-provider",
					crdtHold: true,
				}),
			});

		expect((await handler(request())).status).toBe(500);
		expect((await handler(request())).status).toBe(500);
		expect(configCalls).toBe(2);
	});

	test("bootstraps and tears down a private provider live-query session", async () => {
		const authorizedChannels: string[] = [];
		const sessionProvider: PusherProvider = {
			...provider,
			authorizeChannel: (socketId, channel) => {
				authorizedChannels.push(channel);
				return { auth: `${socketId}:${channel}` };
			},
		};
		const transport = new PusherClientTransport({
			provider: sessionProvider,
			key: "public-key",
			identityKey: "test-secret",
		});
		setup = await buildMockApp(
			{
				collections: {
					posts: collection("posts")
						.fields(({ f }) => ({
							title: f.text().required(),
						}))
						.access({ read: true }),
				},
			},
			{ realtime: { clientTransport: transport, retentionDays: 0 } },
		);
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app);
		const sessionResponse = await handler(
			new Request("http://localhost/realtime", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					transport: "shared-provider",
					topics: [
						{
							id: "posts-topic",
							resourceType: "collection",
							resource: "posts",
							operation: "find",
						},
					],
				}),
			}),
		);
		expect(sessionResponse.status).toBe(200);
		expect(sessionResponse.headers.get("content-type")).toContain(
			"application/json",
		);
		const session = (await sessionResponse.json()) as {
			sessionId: string;
			token: string;
			channel: string;
			control: {
				protocol: "questpie-realtime-topology";
				versions: number[];
			};
		};
		expect(session.channel).toMatch(/^private-questpie-rt-/);
		expect(session.control.versions).toContain(2);

		const auth = new URLSearchParams({
			socket_id: "123.456",
			channel_name: session.channel,
		});
		const authResponse = await handler(
			new Request("http://localhost/realtime/auth", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: auth,
			}),
		);
		expect(authResponse.status).toBe(200);
		expect(authorizedChannels).toEqual([session.channel]);

		const removeResponse = await handler(
			new Request("http://localhost/realtime", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sessionId: session.sessionId,
					token: session.token,
					topology: {
						protocol: "questpie-realtime-topology",
						version: 2,
						revision: 1,
						subscriptions: [],
					},
				}),
			}),
		);
		expect(removeResponse.status).toBe(202);

		const staleAuthResponse = await handler(
			new Request("http://localhost/realtime/auth", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: auth,
			}),
		);
		expect(staleAuthResponse.status).toBe(403);
	});

	test("applies and closes a Pusher live-query topology through another app instance", async () => {
		const database = await createTestDb();
		const bus = new SharedChangeBus();
		const transport = new PusherClientTransport({
			provider,
			key: "public-key",
			identityKey: "test-secret",
		});
		const posts = () =>
			collection("posts")
				.fields(({ f }) => ({ title: f.text().required() }))
				.access({ read: true });
		const second = await buildMockApp(
			{ name: "pusher-control", collections: { posts: posts() } },
			{
				db: { pglite: database },
				realtime: {
					changeBroker: bus.createBroker(),
					retentionDays: 0,
				},
			},
		);
		const first = await buildMockApp(
			{ name: "pusher-owner", collections: { posts: posts() } },
			{
				db: { pglite: database },
				realtime: {
					changeBroker: bus.createBroker(),
					clientTransport: transport,
					retentionDays: 0,
				},
			},
		);
		try {
			await runTestDbMigrations(first.app);
			const firstRoutes = createAdapterRoutes(first.app, {
				accessMode: "user",
			});
			const secondRoutes = createAdapterRoutes(second.app, {
				accessMode: "user",
			});
			const opened = await firstRoutes.realtime.subscribe(
				new Request("http://localhost/realtime", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						transport: "shared-provider",
						topics: [
							{
								id: "posts-base",
								resourceType: "collection",
								resource: "posts",
								operation: "find",
							},
						],
					}),
				}),
				{},
				undefined,
			);
			if (opened.status !== 200) {
				throw new Error(`Pusher session failed: ${await opened.text()}`);
			}
			const session = (await opened.json()) as {
				sessionId: string;
				token: string;
				channel: string;
			};
			await waitFor(() => first.app.realtime.listeners.size === 1);

			const control = (revision: number, topics: unknown[]) =>
				secondRoutes.realtime.subscribe(
					new Request("http://localhost/realtime", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							sessionId: session.sessionId,
							token: session.token,
							topology: {
								protocol: "questpie-realtime-topology",
								version: 2,
								revision,
								subscriptions: topics.map((topic) => ({
									kind: "query",
									...(topic as object),
								})),
							},
						}),
					}),
					{},
					undefined,
				);
			const added = await control(1, [
				{
					id: "posts-base",
					topic: {
						resourceType: "collection",
						resource: "posts",
						operation: "find",
					},
				},
				{
					id: "posts-added",
					topic: {
						resourceType: "collection",
						resource: "posts",
						operation: "find",
						where: { title: "added" },
					},
				},
			]);
			expect(added.status).toBe(202);
			await waitFor(() => first.app.realtime.listeners.size === 2);

			const closed = await control(2, []);
			expect(closed.status).toBe(202);
			await waitFor(() => first.app.realtime.listeners.size === 0);
			await expect(
				transport.generateAuth({
					socketId: "123.456",
					channel: session.channel,
					principal: null,
				}),
			).rejects.toThrow("Realtime session is not authorized");
		} finally {
			await Promise.all([first.cleanup(), second.cleanup()]);
			await database.close();
		}
	});
});
