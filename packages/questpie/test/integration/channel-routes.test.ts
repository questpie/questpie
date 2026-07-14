import { afterEach, describe, expect, test } from "bun:test";

import { z } from "zod";

import { createFetchHandler } from "../../src/server/adapters/http.js";
import { channel } from "../../src/server/channels/channel-builder.js";
import { ChannelTokenBucketLimiter } from "../../src/server/channels/security.js";
import type { PusherProvider } from "../../src/server/modules/core/integrated/realtime/pusher-transport.js";
import { PusherClientTransport } from "../../src/server/modules/core/integrated/realtime/pusher-transport.js";
import { setChannelPublishLimiterForTests } from "../../src/server/modules/core/routes/channels/_shared.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

function channelRequest(
	path: string,
	body: Record<string, unknown>,
	options: { origin?: string; cookie?: boolean } = {},
): Request {
	return new Request(`https://app.example.com/${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(options.origin ? { Origin: options.origin } : {}),
			...(options.cookie ? { Cookie: "session=test" } : {}),
		},
		body: JSON.stringify(body),
	});
}

async function readSseEvent(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	state: { buffer: string },
	eventType: string,
): Promise<Record<string, unknown>> {
	const decoder = new TextDecoder();
	for (;;) {
		const blocks = state.buffer.split("\n\n");
		state.buffer = blocks.pop() ?? "";
		for (const block of blocks) {
			const type = block
				.split("\n")
				.find((line) => line.startsWith("event: "))
				?.slice(7);
			const data = block
				.split("\n")
				.find((line) => line.startsWith("data: "))
				?.slice(6);
			if (type === eventType && data) return JSON.parse(data);
		}
		const next = await reader.read();
		if (next.done) throw new Error(`SSE ended before ${eventType}`);
		state.buffer += decoder.decode(next.value, { stream: true });
	}
}

describe("channel module routes", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
	});

	test("streams authorized ordered channels and coarse presence over SSE", async () => {
		const setup = await buildMockApp(
			{
				channels: {
					room: channel("room-[roomId]")
						.events({ message: z.object({ text: z.string() }) })
						.authorize({ subscribe: true, publish: true })
						.presence(({ params }) => ({
							id: "member-1",
							roomId: params.roomId,
						})),
				},
			},
			{
				app: { url: "https://app.example.com" },
				realtime: { retentionDays: 0 },
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app);

		const configResponse = await handler(
			new Request("https://app.example.com/channels/config"),
		);
		expect(await configResponse.json()).toMatchObject({
			transport: "sse",
			channels: {
				room: { pattern: "room-[roomId]", visibility: "presence" },
			},
		});

		const streamResponse = await handler(
			new Request("https://app.example.com/realtime", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					channels: [
						{
							id: "room-subscription",
							channel: "room",
							params: { roomId: "one" },
						},
					],
				}),
			}),
		);
		expect(streamResponse.status).toBe(200);
		const reader = streamResponse.body!.getReader();
		const state = { buffer: "" };
		expect(await readSseEvent(reader, state, "session")).toMatchObject({
			sessionId: expect.any(String),
			token: expect.any(String),
		});
		expect(await readSseEvent(reader, state, "channel_presence")).toEqual({
			type: "channel_presence",
			channel: "presence-room-one",
			members: [{ id: "member-1", roomId: "one" }],
		});

		const publishResponse = await handler(
			channelRequest(
				"channels/publish",
				{
					channel: "room",
					params: { roomId: "one" },
					event: "message",
					data: { text: "hello" },
				},
				{ origin: "https://app.example.com", cookie: true },
			),
		);
		expect(publishResponse.status).toBe(200);
		expect(await readSseEvent(reader, state, "channel_event")).toMatchObject({
			type: "channel_event",
			channel: "presence-room-one",
			event: "message",
			eventId: expect.any(String),
			data: { text: "hello" },
		});
		await reader.cancel();
	});

	test("authorizes subscribe independently and never trusts the supplied wire name", async () => {
		const providerCalls: string[] = [];
		const provider: PusherProvider = {
			trigger: async () => {},
			authorizeChannel: (_socket, channelName) => {
				providerCalls.push(channelName);
				return { auth: `signed:${channelName}` };
			},
			authenticateUser: () => ({ auth: "user", user_data: "{}" }),
			terminateUserConnections: async () => {},
			getPresenceMemberCount: async () => 0,
		};
		const transport = new PusherClientTransport({
			provider,
			key: "public-key",
			identityKey: "provider-secret",
		});
		const setup = await buildMockApp(
			{
				channels: {
					readOnly: channel("room-[id]")
						.events({ message: z.object({ text: z.string() }) })
						.authorize({ subscribe: true, publish: false }),
					fallback: channel("fallback-[id]")
						.events({ message: z.object({ text: z.string() }) })
						.authorize({ subscribe: true }),
					publicNews: channel("news"),
					throws: channel("throws").authorize(() => {
						throw new Error("never expose this");
					}),
					timesOut: channel("slow").authorize(
						() => new Promise(() => undefined),
					),
				},
			},
			{
				app: { url: "https://app.example.com" },
				realtime: {
					clientTransport: transport,
					retentionDays: 0,
					channelSecurity: { authorizationTimeoutMs: 5 },
				},
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app);
		const auth = (channelKey: string, channelName: string, params = {}) =>
			handler(
				channelRequest(
					"channels/auth",
					{
						socket_id: "123.456",
						channel_name: channelName,
						channel: channelKey,
						params,
					},
					{ origin: "https://app.example.com", cookie: true },
				),
			);

		const allowed = await auth("readOnly", "private-room-one", { id: "one" });
		expect(allowed.status).toBe(200);
		expect(allowed.headers.get("cache-control")).toBe("no-store");
		expect(allowed.headers.get("access-control-allow-origin")).toBe(
			"https://app.example.com",
		);
		expect(await allowed.json()).toEqual({ auth: "signed:private-room-one" });

		expect((await auth("publicNews", "news")).status).toBe(200);
		expect((await auth("missing", "missing")).status).toBe(404);
		expect((await auth("throws", "private-throws")).status).toBe(403);
		expect((await auth("timesOut", "private-slow")).status).toBe(403);
		expect(
			(await auth("readOnly", "private-room-other", { id: "one" })).status,
		).toBe(403);
		expect(providerCalls).toEqual(["private-room-one", "news"]);

		const configResponse = await handler(
			new Request("https://app.example.com/channels/config", {
				headers: { Origin: "https://app.example.com" },
			}),
		);
		const configText = JSON.stringify(await configResponse.json());
		expect(configResponse.status).toBe(200);
		expect(configText).toContain("public-key");
		expect(configText).not.toContain("provider-secret");
	});

	test("enforces publish authorization, schema, payload, and rate before ledger allocation", async () => {
		const setup = await buildMockApp(
			{
				channels: {
					fallback: channel("fallback-[id]")
						.events({ message: z.string() })
						.authorize({ subscribe: true }),
					readOnly: channel("readonly")
						.events({ message: z.string() })
						.authorize({ subscribe: true, publish: false }),
					publicNews: channel("news").events({ message: z.string() }),
				},
			},
			{
				app: { url: "https://app.example.com" },
				realtime: { retentionDays: 0 },
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app);
		const publish = (body: Record<string, unknown>) =>
			handler(
				channelRequest("channels/publish", body, {
					origin: "https://app.example.com",
					cookie: true,
				}),
			);

		expect(
			(
				await publish({
					channel: "readOnly",
					params: {},
					event: "message",
					data: "denied",
				})
			).status,
		).toBe(403);
		expect(
			(
				await publish({
					channel: "publicNews",
					params: {},
					event: "message",
					data: "denied",
				})
			).status,
		).toBe(403);
		expect(
			(
				await publish({
					channel: "fallback",
					params: { id: "one" },
					event: "message",
					data: 42,
				})
			).status,
		).toBe(422);

		const accepted = await publish({
			channel: "fallback",
			params: { id: "one" },
			event: "message",
			data: "x".repeat(9_998),
		});
		expect(accepted.status).toBe(200);
		expect(await accepted.json()).toEqual({ eventId: expect.any(String) });
		expect(
			(
				await publish({
					channel: "fallback",
					params: { id: "one" },
					event: "message",
					data: "x".repeat(9_999),
				})
			).status,
		).toBe(413);

		let now = 0;
		setChannelPublishLimiterForTests(
			setup.app,
			new ChannelTokenBucketLimiter({
				ratePerSecond: 10,
				burst: 1,
				now: () => now,
			}),
		);
		const rateBody = {
			channel: "fallback",
			params: { id: "rate" },
			event: "message",
			data: "ok",
		};
		expect((await publish(rateBody)).status).toBe(200);
		expect((await publish(rateBody)).status).toBe(429);
		now = 100;
		expect((await publish(rateBody)).status).toBe(200);
	});

	test("uses one strict origin and credentialed CORS policy for auth and publish", async () => {
		const setup = await buildMockApp(
			{ channels: { publicNews: channel("news") } },
			{
				app: { url: "https://app.example.com" },
				realtime: {
					retentionDays: 0,
					channelSecurity: {
						trustedOrigins: ["https://admin.example.com"],
					},
				},
			},
		);
		cleanup = setup.cleanup;
		const handler = createFetchHandler(setup.app);
		for (const path of ["channels/auth", "channels/publish"]) {
			const missing = await handler(channelRequest(path, {}, { cookie: true }));
			expect(missing.status).toBe(403);
			const untrusted = await handler(
				channelRequest(
					path,
					{},
					{
						cookie: true,
						origin: "https://evil.example.com",
					},
				),
			);
			expect(untrusted.status).toBe(403);
			const preflight = await handler(
				new Request(`https://app.example.com/${path}`, {
					method: "OPTIONS",
					headers: { Origin: "https://admin.example.com" },
				}),
			);
			expect(preflight.status).toBe(204);
			expect(preflight.headers.get("access-control-allow-origin")).toBe(
				"https://admin.example.com",
			);
			expect(preflight.headers.get("access-control-allow-credentials")).toBe(
				"true",
			);
			expect(preflight.headers.get("vary")).toContain("Origin");
			expect(preflight.headers.get("access-control-allow-origin")).not.toBe(
				"*",
			);
		}

		const simpleSubmission = await handler(
			new Request("https://app.example.com/channels/publish", {
				method: "POST",
				headers: {
					"Content-Type": "text/plain",
					Origin: "https://app.example.com",
				},
				body: "{}",
			}),
		);
		expect(simpleSubmission.status).toBe(415);

		const sseConfig = await handler(
			new Request("https://app.example.com/channels/config", {
				headers: { Cookie: "session=test" },
			}),
		);
		expect(await sseConfig.json()).toEqual({
			transport: "sse",
			channels: {
				publicNews: { pattern: "news", visibility: "public" },
			},
		});

		const rejectedPreflight = await handler(
			new Request("https://app.example.com/channels/publish", {
				method: "OPTIONS",
				headers: {
					Origin: "https://app.example.com",
					"Access-Control-Request-Method": "POST",
					"Access-Control-Request-Headers": "Content-Type, X-Unsafe",
				},
			}),
		);
		expect(rejectedPreflight.status).toBe(403);
	});

	test("rejects resolved-name collisions before authorization or provider contact", async () => {
		let authorizationCalls = 0;
		let providerCalls = 0;
		const provider: PusherProvider = {
			trigger: async () => {},
			authorizeChannel: () => {
				providerCalls += 1;
				return { auth: "unexpected" };
			},
			authenticateUser: () => ({ auth: "user", user_data: "{}" }),
			terminateUserConnections: async () => {},
			getPresenceMemberCount: async () => 0,
		};
		const setup = await buildMockApp(
			{
				channels: {
					first: channel("room-[id]").authorize(() => {
						authorizationCalls += 1;
						return true;
					}),
					second: channel("room-[slug]").authorize(true),
				},
			},
			{
				app: { url: "https://app.example.com" },
				realtime: {
					retentionDays: 0,
					clientTransport: new PusherClientTransport({
						provider,
						key: "public",
						identityKey: "secret",
					}),
				},
			},
		);
		cleanup = setup.cleanup;
		const response = await createFetchHandler(setup.app)(
			channelRequest("channels/auth", {
				socket_id: "123.456",
				channel_name: "private-room-one",
				channel: "first",
				params: { id: "one" },
			}),
		);
		expect(response.status).toBe(409);
		expect(authorizationCalls).toBe(0);
		expect(providerCalls).toBe(0);
	});
});
