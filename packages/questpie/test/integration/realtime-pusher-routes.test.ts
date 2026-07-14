import { afterEach, describe, expect, test } from "bun:test";

import { createFetchHandler } from "../../src/server/adapters/http.js";
import { collection } from "../../src/server/collection/builder/collection-builder.js";
import {
	PusherClientTransport,
	type PusherProvider,
} from "../../src/server/modules/core/integrated/realtime/pusher-transport.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db.js";

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

describe("pusher transport module routes", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	afterEach(async () => {
		await setup.cleanup();
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
		};
		expect(session.channel).toMatch(/^private-questpie-rt-/);

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
					frames: [{ type: "remove_topic", topicId: "posts-topic" }],
				}),
			}),
		);
		expect(removeResponse.status).toBe(204);

		const staleAuthResponse = await handler(
			new Request("http://localhost/realtime/auth", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: auth,
			}),
		);
		expect(staleAuthResponse.status).toBe(403);
	});
});
