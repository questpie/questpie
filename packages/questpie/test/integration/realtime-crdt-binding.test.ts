import { afterEach, describe, expect, it } from "bun:test";

import { realtimeSubscribe } from "../../src/server/adapters/routes/realtime.js";
import { CrdtRealtimeBindingRejectedError } from "../../src/server/modules/core/integrated/crdt/realtime-binding.js";
import {
	PusherClientTransport,
	type PusherProvider,
} from "../../src/server/modules/core/integrated/realtime/pusher-transport.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

describe("realtime CRDT edge bindings", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>> | undefined;

	afterEach(async () => {
		await setup?.cleanup();
		setup = undefined;
	});

	it("holds an explicit control-only SSE edge and routes only its opaque topology id", async () => {
		setup = await buildMockApp(
			{},
			{ realtime: { retentionDays: 0 }, secret: "s".repeat(32) },
		);
		await runTestDbMigrations(setup.app);
		let dirty: (() => void | Promise<void>) | undefined;
		let releases = 0;
		setup.app.crdtOperations = {
			...setup.app.crdtOperations,
			assertRealtimeBinding: async (input: { bindingId: string }) => {
				if (input.bindingId !== "00000000-0000-4000-8000-000000000001") {
					throw new CrdtRealtimeBindingRejectedError();
				}
			},
			subscribeRealtimeBinding: async (input: {
				bindingId: string;
				onDirty(): void | Promise<void>;
			}) => {
				if (input.bindingId !== "00000000-0000-4000-8000-000000000001") {
					throw new CrdtRealtimeBindingRejectedError();
				}
				dirty = input.onDirty;
				return async () => {
					releases++;
				};
			},
		};
		const controller = new AbortController();
		const opened = await realtimeSubscribe(
			setup.app,
			new Request("http://localhost/realtime", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					topics: [],
					channels: [],
					crdtHold: true,
				}),
				signal: controller.signal,
			}),
			{},
			undefined,
		);
		expect(opened.status).toBe(200);
		const reader = sseReader(opened.body!);
		const session = await reader.read("session");

		const provisional = await realtimeSubscribe(
			setup.app,
			topologyRequest(session, 1),
			{},
			undefined,
		);
		expect(provisional.status).toBe(202);
		const applied = await realtimeSubscribe(
			setup.app,
			topologyRequest(session, 2, "00000000-0000-4000-8000-000000000001"),
			{},
			undefined,
		);
		expect(applied.status).toBe(202);
		await waitFor(() => dirty !== undefined);

		await dirty!();
		expect(await reader.read("crdt_dirty")).toEqual({
			topologyEntryId: "document-one",
		});

		const forged = await realtimeSubscribe(
			setup.app,
			topologyRequest(session, 3, "00000000-0000-4000-8000-000000000002"),
			{},
			undefined,
		);
		expect(forged.status).toBe(400);
		expect(await forged.json()).toMatchObject({
			error: {
				code: "REALTIME_TOPOLOGY_ENTRIES_REJECTED",
				entries: [
					{
						id: "document-one",
						kind: "crdt",
						code: "REALTIME_SUBSCRIPTION_REJECTED",
					},
				],
			},
		});
		await dirty!();
		expect(await reader.read("crdt_dirty")).toEqual({
			topologyEntryId: "document-one",
		});

		controller.abort();
		await waitFor(() => releases === 1);
		await reader.close();
	});

	it("retains the latest opaque CRDT dirty hint while an SSE edge is backpressured", async () => {
		setup = await buildMockApp(
			{},
			{
				realtime: {
					retentionDays: 0,
					admission: { maxBufferedSnapshotBytes: 512 },
				},
				secret: "s".repeat(32),
			},
		);
		await runTestDbMigrations(setup.app);
		const dirty = new Map<string, () => void | Promise<void>>();
		setup.app.crdtOperations = {
			...setup.app.crdtOperations,
			assertRealtimeBinding: async () => {},
			subscribeRealtimeBinding: async (input: {
				bindingId: string;
				onDirty(): void | Promise<void>;
			}) => {
				dirty.set(input.bindingId, input.onDirty);
				return async () => {
					dirty.delete(input.bindingId);
				};
			},
		};
		const controller = new AbortController();
		const opened = await realtimeSubscribe(
			setup.app,
			new Request("http://localhost/realtime", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					topics: [],
					channels: [],
					crdtHold: true,
				}),
				signal: controller.signal,
			}),
			{},
			undefined,
		);
		const reader = sseReader(opened.body!);
		const session = await reader.read("session");
		const firstBinding = "00000000-0000-4000-8000-000000000001";
		const secondBinding = "00000000-0000-4000-8000-000000000002";
		const applied = await realtimeSubscribe(
			setup.app,
			topologyRequestWithBindings(session, 1, [
				{ id: "document-one", bindingId: firstBinding },
				{ id: "document-two", bindingId: secondBinding },
			]),
			{},
			undefined,
		);
		expect(applied.status).toBe(202);
		await waitFor(() => dirty.size === 2);

		for (let index = 0; index < 32; index++) {
			await dirty.get(firstBinding)!();
		}
		await dirty.get(secondBinding)!();

		const deliveredSecond = Promise.race([
			(async () => {
				for (let index = 0; index < 64; index++) {
					const hint = await reader.read("crdt_dirty");
					if (hint.topologyEntryId === "document-two") return hint;
				}
				throw new Error("Latest CRDT dirty hint was not delivered");
			})(),
			new Promise<never>((_, reject) => {
				setTimeout(
					() => reject(new Error("Latest CRDT dirty hint was dropped")),
					500,
				);
			}),
		]);
		await expect(deliveredSecond).resolves.toEqual({
			topologyEntryId: "document-two",
		});

		controller.abort();
		await reader.close();
	});

	it("reuses a shared-provider edge and emits only a targeted opaque CRDT invalidation", async () => {
		const events: Array<{ channel: string; event: string; data: unknown }> = [];
		const provider: PusherProvider = {
			trigger: async (channel, event, data) => {
				events.push({ channel, event, data });
			},
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
		const transport = new PusherClientTransport({
			provider,
			key: "public-key",
			identityKey: "test-secret",
		});
		setup = await buildMockApp(
			{},
			{
				realtime: {
					clientTransport: transport,
					retentionDays: 0,
				},
				secret: "s".repeat(32),
			},
		);
		await runTestDbMigrations(setup.app);
		let dirty: (() => void | Promise<void>) | undefined;
		let releases = 0;
		setup.app.crdtOperations = {
			...setup.app.crdtOperations,
			assertRealtimeBinding: async (input: { bindingId: string }) => {
				if (input.bindingId !== "00000000-0000-4000-8000-000000000001") {
					throw new CrdtRealtimeBindingRejectedError();
				}
			},
			subscribeRealtimeBinding: async (input: {
				bindingId: string;
				onDirty(): void | Promise<void>;
			}) => {
				if (input.bindingId !== "00000000-0000-4000-8000-000000000001") {
					throw new CrdtRealtimeBindingRejectedError();
				}
				dirty = input.onDirty;
				return async () => {
					releases++;
				};
			},
		};
		const opened = await realtimeSubscribe(
			setup.app,
			new Request("http://localhost/realtime", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					transport: "shared-provider",
					topics: [],
					channels: [],
					crdtHold: true,
				}),
			}),
			{},
			undefined,
		);
		expect(opened.status).toBe(200);
		const session = (await opened.json()) as {
			sessionId: string;
			token: string;
			channel: string;
		};

		const provisional = await realtimeSubscribe(
			setup.app,
			topologyRequest(session, 1),
			{},
			undefined,
		);
		expect(provisional.status).toBe(202);
		await expect(
			transport.generateAuth({
				socketId: "123.456",
				channel: session.channel,
				principal: null,
			}),
		).resolves.toBeDefined();

		const applied = await realtimeSubscribe(
			setup.app,
			topologyRequest(session, 2, "00000000-0000-4000-8000-000000000001"),
			{},
			undefined,
		);
		expect(applied.status).toBe(202);
		await waitFor(() => dirty !== undefined);

		await dirty!();
		await waitFor(
			() =>
				events.filter((entry) => entry.event === "questpie:invalidate")
					.length === 1,
		);
		expect(events).toEqual([
			{
				channel: session.channel,
				event: "questpie:invalidate",
				data: {
					sessionId: session.sessionId,
					targets: [{ kind: "crdt", id: "document-one" }],
				},
			},
		]);

		const forged = await realtimeSubscribe(
			setup.app,
			topologyRequest(session, 3, "00000000-0000-4000-8000-000000000002"),
			{},
			undefined,
		);
		expect(forged.status).toBe(400);
		expect(await forged.json()).toMatchObject({
			error: {
				code: "REALTIME_TOPOLOGY_ENTRIES_REJECTED",
				entries: [
					{
						id: "document-one",
						kind: "crdt",
						code: "REALTIME_SUBSCRIPTION_REJECTED",
					},
				],
			},
		});
		await dirty!();
		await waitFor(
			() =>
				events.filter((entry) => entry.event === "questpie:invalidate")
					.length === 2,
		);

		const removed = await realtimeSubscribe(
			setup.app,
			topologyRequest(session, 4),
			{},
			undefined,
		);
		expect(removed.status).toBe(202);
		await waitFor(() => releases === 1);
		await expect(
			transport.generateAuth({
				socketId: "123.456",
				channel: session.channel,
				principal: null,
			}),
		).rejects.toThrow("Realtime session is not authorized");
	});

	/**
	 * A CRDT hold is ADDITIVE, not exclusive.
	 *
	 * One SSE connection multiplexes every resource a page holds, and the client's
	 * own `openTopology()` sets `crdtHold: true` whenever a CRDT resource exists
	 * WHILE still sending the topics and channels array. The bootstrap guard used
	 * to reject exactly that payload with `realtime.topicsRequired`, so a screen
	 * that edited a collaborative document while subscribed to anything could not
	 * open its document at all.
	 *
	 * Reported from an app whose Knowledge editor holds a document and a channel
	 * on the same connection.
	 */
	it("bootstraps a CRDT hold that arrives alongside a live-query topic", async () => {
		setup = await buildMockApp(
			{},
			{ realtime: { retentionDays: 0 }, secret: "s".repeat(32) },
		);
		await runTestDbMigrations(setup.app);
		const controller = new AbortController();
		const opened = await realtimeSubscribe(
			setup.app,
			new Request("http://localhost/realtime", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					topics: [
						{
							id: "posts-topic",
							resourceType: "collection",
							resource: "posts",
							operation: "find",
						},
					],
					channels: [],
					crdtHold: true,
				}),
				signal: controller.signal,
			}),
			{},
			undefined,
		);

		// The bug returned 400 `realtime.topicsRequired` here.
		expect(opened.status).toBe(200);
		const reader = sseReader(opened.body!);
		await reader.read("session");
		await reader.close();
		controller.abort();
	});

	/** The one request with nothing to do is still refused. */
	it("still refuses a bootstrap that asks for no topic, no channel and no hold", async () => {
		setup = await buildMockApp(
			{},
			{ realtime: { retentionDays: 0 }, secret: "s".repeat(32) },
		);
		await runTestDbMigrations(setup.app);
		const refused = await realtimeSubscribe(
			setup.app,
			new Request("http://localhost/realtime", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ topics: [], channels: [] }),
			}),
			{},
			undefined,
		);
		expect(refused.status).toBe(400);
	});
});

function topologyRequest(
	session: { sessionId: string; token: string },
	revision: number,
	bindingId?: string,
): Request {
	return topologyRequestWithBindings(
		session,
		revision,
		bindingId ? [{ id: "document-one", bindingId }] : [],
	);
}

function topologyRequestWithBindings(
	session: { sessionId: string; token: string },
	revision: number,
	bindings: ReadonlyArray<{ id: string; bindingId: string }>,
): Request {
	return new Request("http://localhost/realtime", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			sessionId: session.sessionId,
			token: session.token,
			topology: {
				protocol: "questpie-realtime-topology",
				version: 2,
				revision,
				subscriptions: bindings.map(({ id, bindingId }) => ({
					kind: "crdt",
					id,
					bindingId,
				})),
			},
		}),
	});
}

function sseReader(body: ReadableStream<Uint8Array>) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	return {
		async read(expected: string): Promise<any> {
			while (true) {
				const separator = buffer.indexOf("\n\n");
				if (separator >= 0) {
					const block = buffer.slice(0, separator);
					buffer = buffer.slice(separator + 2);
					let event = "";
					let data = "";
					for (const line of block.split("\n")) {
						if (line.startsWith("event: ")) event = line.slice(7);
						if (line.startsWith("data: ")) data += line.slice(6);
					}
					if (event === expected) return JSON.parse(data);
					continue;
				}
				const chunk = await reader.read();
				if (chunk.done) throw new Error(`SSE closed before ${expected}`);
				buffer += decoder.decode(chunk.value, { stream: true });
			}
		},
		async close() {
			await reader.cancel();
		},
	};
}

async function waitFor(assertion: () => boolean, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for realtime CRDT binding");
}
