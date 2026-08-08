import { afterEach, describe, expect, test } from "bun:test";

import { z } from "zod";

import { collection } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { channel } from "../../src/server/channels/channel-builder.js";
import { ChannelTokenBucketLimiter } from "../../src/server/channels/security.js";
import { questpieChannelAuthorityRevocationTable } from "../../src/server/modules/core/integrated/realtime/collection.js";
import type { RealtimeObservation } from "../../src/server/modules/core/integrated/realtime/observer.js";
import type { PusherProvider } from "../../src/server/modules/core/integrated/realtime/pusher-transport.js";
import { PusherClientTransport } from "../../src/server/modules/core/integrated/realtime/pusher-transport.js";
import type {
	ClientSink,
	SharedProviderClientTransport,
} from "../../src/server/modules/core/integrated/realtime/transport.js";
import { setChannelPublishLimiterForTests } from "../../src/server/modules/core/routes/channels/_shared.js";
import {
	parseCompatibleTypedEventWire,
	stringifyTypedWire,
} from "../../src/shared/typed-wire.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

function channelRequest(
	path: string,
	body: Record<string, unknown>,
	options: {
		origin?: string;
		cookie?: boolean;
		headers?: Record<string, string>;
	} = {},
): Request {
	return new Request(`https://app.example.com/${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(options.origin ? { Origin: options.origin } : {}),
			...(options.cookie ? { Cookie: "session=test" } : {}),
			...options.headers,
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
			if (type === eventType && data) {
				return parseCompatibleTypedEventWire<Record<string, unknown>>(data);
			}
		}
		const next = await reader.read();
		if (next.done) throw new Error(`SSE ended before ${eventType}`);
		state.buffer += decoder.decode(next.value, { stream: true });
	}
}

async function readSseEventWithin(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	state: { buffer: string },
	eventType: string,
	timeoutMs = 2_000,
): Promise<Record<string, unknown>> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			readSseEvent(reader, state, eventType),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error(`Timed out waiting for SSE ${eventType}`)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

describe("channel module routes", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
	});

	test("streams authorized ordered channels and live presence over SSE", async () => {
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
				realtime: { retentionDays: 0, rowLiveQueries: false },
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, {
			getSession: async () => ({
				user: { id: "member-1" },
				session: { id: "session-1" },
			}),
		});

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

	test("keeps app context resolver reads system-scoped during fresh channel reauthorization", async () => {
		let contextResolutions = 0;
		const memberships = collection("memberships")
			.fields(({ f }) => ({
				userId: f.text().required(),
			}))
			.access({ read: false, create: false, update: false, delete: false });
		const setup = await buildMockApp(
			{
				collections: { memberships },
				channels: {
					workspace: channel("workspace-[workspaceId]")
						.events({ message: z.object({ text: z.string() }) })
						.authorize(
							({ session, hasMembership }: any) =>
								session?.user.id === "user-1" && hasMembership === true,
						),
				},
				config: {
					app: {
						context: async ({ collections, session }: any) => {
							contextResolutions += 1;
							const membershipCount = await collections.memberships.count({
								where: { userId: session?.user.id },
							});
							return { hasMembership: membershipCount === 1 };
						},
					},
				},
			},
			{
				app: { url: "https://app.example.com" },
				realtime: { retentionDays: 0, rowLiveQueries: false },
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		await setup.app.collections.memberships.create({ userId: "user-1" });

		const handler = createFetchHandler(setup.app, {
			getSession: async () => ({
				user: { id: "user-1" },
				session: { id: "session-1" },
			}),
		});
		const response = await handler(
			channelRequest("realtime", {
				channels: [
					{
						id: "workspace-one",
						channel: "workspace",
						params: { workspaceId: "one" },
					},
				],
			}),
		);
		expect(response.status).toBe(200);
		const reader = response.body!.getReader();
		const state = { buffer: "" };
		try {
			await readSseEventWithin(reader, state, "session");

			for (let attempt = 0; attempt < 100; attempt++) {
				if (contextResolutions >= 2) break;
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			expect(contextResolutions).toBeGreaterThanOrEqual(2);

			await setup.app.realtime!.appendChannelEvent({
				channel: "private-workspace-one",
				event: "message",
				schemaIdentity: "workspace:message",
				data: { text: "still-authorized" },
			});
			expect(
				await readSseEventWithin(reader, state, "channel_event"),
			).toMatchObject({
				channel: "private-workspace-one",
				data: { text: "still-authorized" },
			});
		} finally {
			await reader.cancel().catch(() => {});
		}
	});

	test("a held-open SSE stream reruns presence policy and revokes only the exact channel binding", async () => {
		const allowedSpaces = new Set(["a", "b"]);
		let sessionResolutions = 0;
		const setup = await buildMockApp(
			{
				channels: {
					space: channel("space-[spaceId]")
						.events({ message: z.object({ id: z.string() }) })
						.authorize(({ session }: any) => session?.user.id === "user-1")
						.presence(({ params, allowedSpaces }: any) => {
							if (!allowedSpaces.has(params.spaceId)) {
								throw new Error("Space membership is unavailable");
							}
							return { id: `member-${params.spaceId}` };
						}),
				},
			},
			{
				app: { url: "https://app.example.com" },
				realtime: { retentionDays: 0, rowLiveQueries: false },
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, {
			getSession: async () => {
				sessionResolutions += 1;
				return {
					user: { id: "user-1" },
					session: { id: "session-1" },
				};
			},
			extendContext: async () => ({
				allowedSpaces: new Set(allowedSpaces),
			}),
		});
		const response = await handler(
			channelRequest("realtime", {
				channels: [
					{
						id: "space-a",
						channel: "space",
						params: { spaceId: "a" },
					},
					{
						id: "space-b",
						channel: "space",
						params: { spaceId: "b" },
					},
				],
			}),
		);
		const reader = response.body!.getReader();
		const state = { buffer: "" };
		await readSseEvent(reader, state, "session");
		for (let attempt = 0; attempt < 100; attempt++) {
			if (sessionResolutions >= 3) break;
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		expect(sessionResolutions).toBeGreaterThanOrEqual(3);
		await new Promise((resolve) => setTimeout(resolve, 25));
		await setup.app.realtime!.appendChannelEvent({
			channel: "presence-space-b",
			event: "message",
			schemaIdentity: "space:message",
			data: { id: "binding-ready" },
		});
		expect(await readSseEvent(reader, state, "channel_event")).toMatchObject({
			channel: "presence-space-b",
			data: { id: "binding-ready" },
		});

		allowedSpaces.delete("a");
		await expect(
			setup.app.realtime!.revokeChannelAuthority({
				channel: "presence-space-a",
				subject: { kind: "user", id: "user-1" },
				idempotencyKey: "space-a:user-1:membership-v2",
			}),
		).resolves.toEqual({ generation: 1, scope: "exact-subscription" });
		expect(sessionResolutions).toBeGreaterThanOrEqual(2);

		await setup.app.realtime!.appendChannelEvent({
			channel: "presence-space-a",
			event: "message",
			schemaIdentity: "space:message",
			data: { id: "must-not-arrive" },
		});
		await setup.app.realtime!.appendChannelEvent({
			channel: "presence-space-b",
			event: "message",
			schemaIdentity: "space:message",
			data: { id: "still-authorized-binding" },
		});

		expect(await readSseEvent(reader, state, "channel_event")).toMatchObject({
			channel: "presence-space-b",
			data: { id: "still-authorized-binding" },
		});
		await reader.cancel();
	});

	test("preserves typed instants from publish validation through SSE delivery", async () => {
		const instant = new Date("2025-03-30T00:30:00.123Z");
		const setup = await buildMockApp(
			{
				channels: {
					events: channel("events")
						.events({
							scheduled: z.object({
								startsAt: z.date(),
								dateOnly: z.string().date(),
								isoLookingString: z.string(),
							}),
						})
						.authorize({ subscribe: true, publish: true }),
				},
			},
			{
				app: { url: "https://app.example.com" },
				realtime: { retentionDays: 0, rowLiveQueries: false },
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app);
		const streamResponse = await handler(
			channelRequest("realtime", {
				channels: [{ id: "events", channel: "events", params: {} }],
			}),
		);
		expect(streamResponse.status).toBe(200);
		const reader = streamResponse.body!.getReader();
		const state = { buffer: "" };
		await readSseEvent(reader, state, "session");

		const publishResponse = await handler(
			new Request("https://app.example.com/channels/publish", {
				method: "POST",
				headers: {
					"Content-Type": "application/superjson+json",
					Origin: "https://app.example.com",
				},
				body: stringifyTypedWire({
					channel: "events",
					params: {},
					event: "scheduled",
					data: {
						startsAt: instant,
						dateOnly: "2025-03-30",
						isoLookingString: instant.toISOString(),
					},
				}),
			}),
		);
		expect(publishResponse.status).toBe(200);
		const delivered = await readSseEvent(reader, state, "channel_event");
		expect((delivered.data as any).startsAt).toBeInstanceOf(Date);
		expect((delivered.data as any).startsAt.getTime()).toBe(instant.getTime());
		expect((delivered.data as any).dateOnly).toBe("2025-03-30");
		expect((delivered.data as any).isoLookingString).toBe(
			instant.toISOString(),
		);
		expect((delivered.data as any).isoLookingString).not.toBeInstanceOf(Date);
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
		// A rule that THREW is a server fault, not a verdict — 403 claimed the
		// server decided, when it never got that far. The rule's own message
		// still never leaves the process.
		const threw = await auth("throws", "private-throws");
		expect(threw.status).toBe(500);
		expect(await threw.json()).toEqual({ error: "channel_rule_failed" });
		// A rule that ran out of time still DENIES: no answer means no.
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

	test("rejects an unqualified shared-provider grant before policy or provider signing", async () => {
		let policyCalls = 0;
		let grantCalls = 0;
		const transport: SharedProviderClientTransport = {
			channelDeliveryScope: "shared-provider",
			authorityRevocationScope: "principal-connections",
			async start() {},
			async openSession(): Promise<ClientSink> {
				throw new Error("not used");
			},
			async getClientConfig() {
				return { transport: "shared-provider", config: {} };
			},
			async generateAuth() {
				grantCalls += 1;
				return { auth: "must-not-be-issued" };
			},
			async publishChannel() {
				return { status: "accepted", bufferedBytes: null };
			},
			async revokeAuthority() {},
			async stop() {},
		};
		const setup = await buildMockApp(
			{
				channels: {
					room: channel("room-[id]").authorize(() => {
						policyCalls += 1;
						return true;
					}),
				},
			},
			{
				app: { url: "https://app.example.com" },
				realtime: { clientTransport: transport, retentionDays: 0 },
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			channelRequest(
				"channels/auth",
				{
					socket_id: "123.456",
					channel_name: "private-room-one",
					channel: "room",
					params: { id: "one" },
				},
				{ origin: "https://app.example.com", cookie: true },
			),
		);

		expect(response.status).toBe(403);
		expect(policyCalls).toBe(0);
		expect(grantCalls).toBe(0);
	});

	test("rejects unsupported Pusher authority subjects before advancing a durable generation", async () => {
		const provider: PusherProvider = {
			trigger: async () => {},
			authorizeChannel: () => ({ auth: "channel" }),
			authenticateUser: () => ({ auth: "user", user_data: "{}" }),
			terminateUserConnections: async () => {},
			getPresenceMemberCount: async () => 0,
		};
		const setup = await buildMockApp(
			{},
			{
				realtime: {
					clientTransport: new PusherClientTransport({
						provider,
						key: "public-key",
						identityKey: "provider-secret",
					}),
					retentionDays: 0,
				},
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);

		await expect(
			setup.app.realtime!.revokeChannelAuthority({
				channel: "private-room-one",
				subject: { kind: "oauth", id: "token-1" },
				idempotencyKey: "room-one:token-1:unsupported",
			}),
		).rejects.toThrow("requires a user subject");
		expect(
			await setup.app.db.select().from(questpieChannelAuthorityRevocationTable),
		).toEqual([]);
	});

	test("Pusher authority revocation reconnects with fresh channel policy", async () => {
		const terminated: string[] = [];
		const provider: PusherProvider = {
			trigger: async () => {},
			authorizeChannel: (_socket, channelName) => ({
				auth: `signed:${channelName}`,
			}),
			authenticateUser: (socketId, user) => ({
				auth: `${socketId}:${user.id}`,
				user_data: JSON.stringify(user),
			}),
			terminateUserConnections: async (userId) => {
				terminated.push(userId);
			},
			getPresenceMemberCount: async () => 0,
		};
		const transport = new PusherClientTransport({
			provider,
			key: "public-key",
			identityKey: "provider-secret",
		});
		const allowedSpaces = new Set(["a", "b"]);
		const setup = await buildMockApp(
			{
				channels: {
					space: channel("space-[spaceId]").authorize(
						({ params, allowedSpaces: current }: any) =>
							current.has(params.spaceId),
					),
				},
			},
			{
				app: { url: "https://app.example.com" },
				realtime: {
					clientTransport: transport,
					retentionDays: 0,
				},
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, {
			getSession: async () => ({
				user: { id: "user-1" },
				session: { id: "session-1" },
			}),
			extendContext: async () => ({
				allowedSpaces: new Set(allowedSpaces),
			}),
		});

		allowedSpaces.delete("a");
		await setup.app.realtime!.revokeChannelAuthority({
			channel: "private-space-a",
			subject: { kind: "user", id: "user-1" },
			idempotencyKey: "space-a:user-1:membership-v3",
		});
		expect(terminated).toHaveLength(1);

		const userAuth = await handler(
			new Request("https://app.example.com/realtime/auth", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({ socket_id: "123.456" }),
			}),
		);
		expect(userAuth.status).toBe(200);

		const authorize = (spaceId: string) =>
			handler(
				channelRequest(
					"channels/auth",
					{
						socket_id: "123.456",
						channel_name: `private-space-${spaceId}`,
						channel: "space",
						params: { spaceId },
					},
					{ origin: "https://app.example.com", cookie: true },
				),
			);
		expect((await authorize("a")).status).toBe(403);
		expect((await authorize("b")).status).toBe(200);
		expect(terminated).toHaveLength(1);
	});

	test("Pusher channel grants fail closed when a concurrent authority cut wins", async () => {
		let grantStarted!: () => void;
		let releaseGrant!: () => void;
		const grantEntered = new Promise<void>((resolve) => {
			grantStarted = resolve;
		});
		const grantRelease = new Promise<void>((resolve) => {
			releaseGrant = resolve;
		});
		const terminated: string[] = [];
		const provider: PusherProvider = {
			trigger: async () => {},
			authorizeChannel: (_socket, channelName) => {
				grantStarted();
				return grantRelease.then(() => ({
					auth: `signed:${channelName}`,
				})) as unknown as ReturnType<PusherProvider["authorizeChannel"]>;
			},
			authenticateUser: (socketId, user) => ({
				auth: `${socketId}:${user.id}`,
				user_data: JSON.stringify(user),
			}),
			terminateUserConnections: async (userId) => {
				terminated.push(userId);
			},
			getPresenceMemberCount: async () => 0,
		};
		const allowedSpaces = new Set(["a"]);
		const setup = await buildMockApp(
			{
				channels: {
					space: channel("space-[spaceId]").authorize(
						({ params, allowedSpaces: current }: any) =>
							current.has(params.spaceId),
					),
				},
			},
			{
				app: { url: "https://app.example.com" },
				realtime: {
					clientTransport: new PusherClientTransport({
						provider,
						key: "public-key",
						identityKey: "provider-secret",
					}),
					retentionDays: 0,
				},
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, {
			getSession: async () => ({
				user: { id: "user-1" },
				session: { id: "session-1" },
			}),
			extendContext: async () => ({
				allowedSpaces: new Set(allowedSpaces),
			}),
		});

		const grant = handler(
			channelRequest(
				"channels/auth",
				{
					socket_id: "123.456",
					channel_name: "private-space-a",
					channel: "space",
					params: { spaceId: "a" },
				},
				{ origin: "https://app.example.com", cookie: true },
			),
		);
		await grantEntered;

		allowedSpaces.delete("a");
		let revocationFinished = false;
		const revocation = setup.app
			.realtime!.revokeChannelAuthority({
				channel: "private-space-a",
				subject: { kind: "user", id: "user-1" },
				idempotencyKey: "space-a:user-1:grant-race",
			})
			.then(() => {
				revocationFinished = true;
			});
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(revocationFinished).toBe(true);

		releaseGrant();
		expect((await grant).status).toBe(403);
		await revocation;
		expect(terminated).toHaveLength(1);
	});

	test("replays a bounded channel page only after fresh subscribe authorization", async () => {
		const setup = await buildMockApp(
			{
				channels: {
					room: channel("room-[id]")
						.events({ message: z.object({ text: z.string() }) })
						.authorize({
							subscribe: ({ session }) => session?.user?.id === "member-1",
							publish: true,
						}),
				},
			},
			{
				app: { url: "https://app.example.com" },
				realtime: { retentionDays: 0 },
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, {
			getSession: async (request) => ({
				user: { id: request.headers.get("x-user") },
				session: { id: "session-1" },
			}),
		});
		const request = (
			path: string,
			body: Record<string, unknown>,
			user = "member-1",
		) =>
			handler(
				channelRequest(path, body, {
					origin: "https://app.example.com",
					cookie: true,
					headers: { "x-user": user },
				}),
			);
		const publish = (text: string) =>
			request("channels/publish", {
				channel: "room",
				params: { id: "one" },
				event: "message",
				data: { text },
			});
		const first = (await (await publish("one")).json()) as { eventId: string };
		const second = (await (await publish("two")).json()) as { eventId: string };

		const replay = await request("channels/replay", {
			channel: "room",
			params: { id: "one" },
			afterEventId: first.eventId,
		});
		expect(replay.status).toBe(200);
		expect(await replay.json()).toEqual({
			status: "events",
			events: [
				{
					eventId: second.eventId,
					event: "message",
					data: { text: "two" },
				},
			],
			hasMore: false,
		});

		expect(
			(
				await request(
					"channels/replay",
					{
						channel: "room",
						params: { id: "one" },
						afterEventId: first.eventId,
					},
					"member-2",
				)
			).status,
		).toBe(403);

		const gap = await request("channels/replay", {
			channel: "room",
			params: { id: "one" },
			afterEventId: `${"f".repeat(64)}:1`,
		});
		expect(gap.status).toBe(200);
		expect(await gap.json()).toMatchObject({
			status: "gap",
			requestedEventId: `${"f".repeat(64)}:1`,
		});
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
			data: "x".repeat(9_000),
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

		now = 0;
		setChannelPublishLimiterForTests(
			setup.app,
			new ChannelTokenBucketLimiter({
				ratePerSecond: 10,
				burst: 2,
				now: () => now,
			}),
		);
		const authenticatedHandler = createFetchHandler(setup.app, {
			getSession: async (request) => ({
				user: { id: "shared-user" },
				session: { id: request.headers.get("x-test-session") },
			}),
		});
		const publishFromTab = (session: string) =>
			authenticatedHandler(
				channelRequest("channels/publish", rateBody, {
					origin: "https://app.example.com",
					cookie: true,
					headers: { "x-test-session": session },
				}),
			);
		expect((await publishFromTab("tab-1")).status).toBe(200);
		expect((await publishFromTab("tab-2")).status).toBe(200);
		expect((await publishFromTab("tab-3")).status).toBe(429);
		now = 100;
		expect((await publishFromTab("tab-3")).status).toBe(200);
	});

	test("uses one strict origin and credentialed CORS policy for channel authority routes", async () => {
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
		for (const path of [
			"channels/auth",
			"channels/publish",
			"channels/replay",
		]) {
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

	test("SEC-16 channel matrix observations never expose request secrets", async () => {
		const observations: RealtimeObservation[] = [];
		const setup = await buildMockApp(
			{
				channels: {
					room: channel("room-[id]")
						.events({ message: z.object({ text: z.string() }) })
						.authorize({ subscribe: true, publish: true }),
				},
			},
			{
				app: { url: "https://app.example.com" },
				realtime: {
					retentionDays: 0,
					observer: { record: (event) => observations.push(event) },
				},
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app);
		const parameterSecret = "private-parameter-7cb0f3";
		const socketSecret = "private-socket-7cb0f3";
		const payloadSecret = "private-payload-7cb0f3";

		const auth = await handler(
			channelRequest(
				"channels/auth",
				{
					socket_id: socketSecret,
					channel_name: "private-wire-name-7cb0f3",
					channel: "room",
					params: { id: parameterSecret },
				},
				{ origin: "https://app.example.com", cookie: true },
			),
		);
		expect(auth.status).toBe(403);
		const publish = await handler(
			channelRequest(
				"channels/publish",
				{
					channel: "room",
					params: { id: parameterSecret },
					event: "message",
					data: { text: 42, secret: payloadSecret },
				},
				{ origin: "https://app.example.com", cookie: true },
			),
		);
		expect(publish.status).toBe(422);

		const serialized = JSON.stringify(observations);
		expect(observations.length).toBeGreaterThanOrEqual(2);
		for (const secret of [parameterSecret, socketSecret, payloadSecret]) {
			expect(serialized).not.toContain(secret);
		}
		expect(
			observations.every(
				(event) =>
					event.type !== "channel.security" ||
					[
						"allowed",
						"access_denied",
						"origin_denied",
						"name_invalid",
						"rate_limited",
						"payload_invalid",
						"presence_invalid",
						"transport_unavailable",
						"request_invalid",
						"revoked",
						"unknown",
					].includes(event.reason),
			),
		).toBe(true);
	});

	test("the SSE subscribe path hands channel rules the app service surface", async () => {
		/* `ChannelOperationContext` is an `AppContext`, so a rule may read
		   `collections`. The route paths fold that surface in via `executeRoute`;
		   the SSE path used to pass the lean `RequestContext` straight through, so
		   `context.collections` was undefined and every such rule threw — reported
		   as a plain denial. Teeth: drop the fold in
		   `createChannelServiceContext` and BOTH the allowed subscription and the
		   delivered event below disappear. */
		const memberships = collection("memberships")
			.fields(({ f }) => ({
				userId: f.text().required(),
				workspaceId: f.text().required(),
			}))
			.access({ read: false, create: false, update: false, delete: false });
		const setup = await buildMockApp(
			{
				collections: { memberships },
				channels: {
					workspace: channel("workspace-[workspaceId]")
						.events({ message: z.object({ text: z.string() }) })
						.authorize({
							subscribe: async ({ collections, session, params }: any) => {
								const count = await collections.memberships.count(
									{
										where: {
											userId: session?.user?.id,
											workspaceId: params.workspaceId,
										},
									},
									{ accessMode: "system" },
								);
								return count === 1;
							},
							publish: false,
						}),
				},
			},
			{
				app: { url: "https://app.example.com" },
				realtime: { retentionDays: 0, rowLiveQueries: false },
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		await setup.app.collections.memberships.create({
			userId: "user-1",
			workspaceId: "one",
		});

		const handler = createFetchHandler(setup.app, {
			getSession: async () => ({
				user: { id: "user-1" },
				session: { id: "session-1" },
			}),
		});
		const response = await handler(
			channelRequest("realtime", {
				channels: [
					{
						id: "workspace-one",
						channel: "workspace",
						params: { workspaceId: "one" },
					},
					{
						id: "workspace-two",
						channel: "workspace",
						params: { workspaceId: "two" },
					},
				],
			}),
		);
		expect(response.status).toBe(200);
		const reader = response.body!.getReader();
		const state = { buffer: "" };
		try {
			await readSseEventWithin(reader, state, "session");

			// The rule RAN and said no for the workspace with no membership row.
			// Without the service surface this would read "rule failed" instead.
			expect(await readSseEventWithin(reader, state, "error")).toEqual({
				channelSubscriptionId: "workspace-two",
				message: "Channel subscription is denied",
			});
			expect(setup.app.mocks.logger.hasErrors()).toBe(false);

			await setup.app.realtime!.appendChannelEvent({
				channel: "private-workspace-one",
				event: "message",
				schemaIdentity: "workspace:message",
				data: { text: "delivered-to-a-member" },
			});
			expect(
				await readSseEventWithin(reader, state, "channel_event"),
			).toMatchObject({
				channel: "private-workspace-one",
				data: { text: "delivered-to-a-member" },
			});
		} finally {
			await reader.cancel().catch(() => {});
		}
	});

	test("a channel rule that throws is reported as a fault, never as a denial", async () => {
		const setup = await buildMockApp(
			{
				channels: {
					open: channel("open-[id]")
						.events({ message: z.object({ text: z.string() }) })
						.authorize({ subscribe: true, publish: false }),
					broken: channel("broken-[id]")
						.events({ message: z.object({ text: z.string() }) })
						.authorize({
							subscribe: ({ missing }: any) => missing.somethingUndeclared,
							publish: false,
						}),
					closed: channel("closed-[id]")
						.events({ message: z.object({ text: z.string() }) })
						.authorize({ subscribe: false, publish: false }),
				},
			},
			{
				app: { url: "https://app.example.com" },
				realtime: { retentionDays: 0, rowLiveQueries: false },
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, {
			getSession: async () => ({
				user: { id: "user-1" },
				session: { id: "session-1" },
			}),
		});
		const response = await handler(
			channelRequest("realtime", {
				channels: [
					{ id: "open-one", channel: "open", params: { id: "one" } },
					{ id: "broken-one", channel: "broken", params: { id: "one" } },
					{ id: "closed-one", channel: "closed", params: { id: "one" } },
				],
			}),
		);
		expect(response.status).toBe(200);
		const reader = response.body!.getReader();
		const state = { buffer: "" };
		try {
			await readSseEventWithin(reader, state, "session");
			const first = await readSseEventWithin(reader, state, "error");
			const second = await readSseEventWithin(reader, state, "error");
			const byId = new Map(
				[first, second].map((event) => [
					event.channelSubscriptionId as string,
					event.message as string,
				]),
			);

			// The whole point: these two are no longer the same sentence.
			expect(byId.get("closed-one")).toBe("Channel subscription is denied");
			expect(byId.get("broken-one")).toBe(
				'Channel "broken" subscribe rule failed',
			);
			expect(byId.get("broken-one")).not.toBe(byId.get("closed-one"));
			// ...and the rule's own failure text stays server-side.
			expect(byId.get("broken-one")).not.toContain("somethingUndeclared");

			const logged = setup.app.mocks.logger.getLogsContaining(
				'channel "broken" subscribe rule threw',
			);
			expect(logged).toHaveLength(1);
			expect(logged[0]!.level).toBe("error");
			// The fault stays observable without leaking its message or stack.
			expect(logged[0]!.args[0]).toMatchObject({
				err: { name: "TypeError", message: "[Redacted]" },
				requestId: expect.any(String),
				traceId: expect.any(String),
			});
			expect(JSON.stringify(logged[0]!.args)).not.toContain(
				"somethingUndeclared",
			);
		} finally {
			await reader.cancel().catch(() => {});
		}
	});
});
