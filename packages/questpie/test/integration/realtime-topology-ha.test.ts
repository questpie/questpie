import { expect, test } from "bun:test";

import {
	collection,
	createAdapterRoutes,
	type ChangeBroker,
	type ChangeWake,
} from "../../src/exports/index.js";
import { channel } from "../../src/server/channels/channel-builder.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
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
				listener = undefined;
			},
		};
	}
}

function createSseReader(stream: ReadableStream<Uint8Array>) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	const readEvent = async (): Promise<{
		event: string;
		data: Record<string, unknown>;
	}> => {
		while (true) {
			const separator = buffer.indexOf("\n\n");
			if (separator >= 0) {
				const block = buffer.slice(0, separator);
				buffer = buffer.slice(separator + 2);
				let event = "message";
				let data = "";
				for (const line of block.split("\n")) {
					if (line.startsWith("event:")) event = line.slice(6).trim();
					if (line.startsWith("data:")) data += line.slice(5).trim();
				}
				if (!data) continue;
				return {
					event,
					data: JSON.parse(data) as Record<string, unknown>,
				};
			}

			const { done, value } = await reader.read();
			if (done) throw new Error("Realtime stream closed before expected event");
			buffer += decoder.decode(value, { stream: true });
		}
	};

	const read = async (eventType: string, topicId?: string) => {
		while (true) {
			const event = await readEvent();
			if (event.event === "error" && eventType !== "error") {
				throw new Error(`Realtime stream error: ${JSON.stringify(event.data)}`);
			}
			if (event.event !== eventType) continue;
			if (topicId && event.data.topicId !== topicId) continue;
			return event.data;
		}
	};

	return { read, close: () => reader.cancel() };
}

async function waitFor(assertion: () => boolean, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for cross-instance topology application");
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`Timed out waiting for ${label}`)),
					2_000,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function desiredRequest(
	session: { sessionId: unknown; token: unknown },
	revision: number,
	topics: Array<{ id: string; topic: Record<string, unknown> }>,
) {
	return new Request("http://localhost/realtime", {
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
					...topic,
				})),
			},
		}),
	});
}

test("applies topic additions and removals through a different app instance", async () => {
	const database = await createTestDb();
	const bus = new SharedChangeBus();
	const items = () =>
		collection("items")
			.fields(({ f }) => ({ name: f.text().required() }))
			.access({ read: true });
	const controlOnly = () =>
		collection("controlOnly")
			.fields(({ f }) => ({ name: f.text().required() }))
			.access({ read: true });
	const first = await buildMockApp(
		{
			name: "topology-first",
			collections: { items: items() },
			channels: { room: channel("room-[id]").authorize({ subscribe: true }) },
		},
		{
			app: { url: "http://topology-first.localhost" },
			db: { pglite: database },
			realtime: { changeBroker: bus.createBroker() },
		},
	);
	const second = await buildMockApp(
		{
			name: "topology-second",
			collections: { items: items(), controlOnly: controlOnly() },
			channels: { room: channel("room-[id]").authorize({ subscribe: true }) },
		},
		{
			app: { url: "http://topology-second.localhost" },
			db: { pglite: database },
			realtime: { changeBroker: bus.createBroker() },
		},
	);
	let reader: ReturnType<typeof createSseReader> | undefined;

	try {
		await runTestDbMigrations(first.app);
		const firstRoutes = createAdapterRoutes(first.app, { accessMode: "user" });
		const secondRoutes = createAdapterRoutes(second.app, {
			accessMode: "user",
		});
		const initial = await firstRoutes.realtime.subscribe(
			new Request("http://localhost/realtime", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					topics: [
						{
							id: "items-base",
							resourceType: "collection",
							resource: "items",
							where: { name: "base" },
						},
					],
				}),
			}),
			{},
			undefined,
		);
		expect(initial.status).toBe(200);
		reader = createSseReader(initial.body!);
		const session = await withTimeout(
			reader.read("session"),
			"session metadata",
		);
		await withTimeout(
			reader.read("snapshot", "items-base"),
			"initial base snapshot",
		);
		expect(first.app.realtime.listeners.size).toBe(1);

		const add = await secondRoutes.realtime.subscribe(
			desiredRequest(session, 1, [
				{
					id: "items-base",
					topic: {
						resourceType: "collection",
						resource: "items",
						where: { name: "base" },
					},
				},
				{
					id: "items-added",
					topic: {
						resourceType: "collection",
						resource: "items",
						where: { name: "added" },
					},
				},
			]),
			{},
			undefined,
		);
		if (add.status !== 202) {
			throw new Error(
				`Cross-instance add was rejected (${add.status}): ${await add.text()}`,
			);
		}
		const duplicate = await secondRoutes.realtime.subscribe(
			desiredRequest(session, 1, [
				{
					id: "items-base",
					topic: {
						resourceType: "collection",
						resource: "items",
						where: { name: "base" },
					},
				},
				{
					id: "items-added",
					topic: {
						resourceType: "collection",
						resource: "items",
						where: { name: "added" },
					},
				},
			]),
			{},
			undefined,
		);
		expect(duplicate.status).toBe(200);
		await withTimeout(
			reader.read("snapshot", "items-added"),
			"cross-instance added snapshot",
		);
		await waitFor(() => first.app.realtime.listeners.size === 2);

		const remove = await secondRoutes.realtime.subscribe(
			desiredRequest(session, 2, [
				{
					id: "items-base",
					topic: {
						resourceType: "collection",
						resource: "items",
						where: { name: "base" },
					},
				},
			]),
			{},
			undefined,
		);
		if (!remove.ok) {
			throw new Error(
				`Cross-instance remove was rejected (${remove.status}): ${await remove.text()}`,
			);
		}
		await waitFor(() => first.app.realtime.listeners.size === 1);

		const swap = await secondRoutes.realtime.subscribe(
			desiredRequest(session, 3, [
				{
					id: "items-replacement",
					topic: {
						resourceType: "collection",
						resource: "items",
						where: { name: "replacement" },
					},
				},
			]),
			{},
			undefined,
		);
		expect(swap.status).toBe(202);
		await withTimeout(
			reader.read("snapshot", "items-replacement"),
			"cross-instance replacement snapshot",
		);
		await waitFor(() => first.app.realtime.listeners.size === 1);

		const addChannel = await secondRoutes.realtime.subscribe(
			new Request("http://localhost/realtime", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sessionId: session.sessionId,
					token: session.token,
					topology: {
						protocol: "questpie-realtime-topology",
						version: 2,
						revision: 4,
						subscriptions: [
							{
								kind: "query",
								id: "items-replacement",
								topic: {
									resourceType: "collection",
									resource: "items",
									where: { name: "replacement" },
								},
							},
							{
								kind: "channel",
								id: "room-one",
								channel: "room",
								params: { id: "one" },
							},
						],
					},
				}),
			}),
			{},
			undefined,
		);
		expect(addChannel.status).toBe(202);
		await waitFor(
			() =>
				(first.app.realtime as any).channelEventLedger.localSubscriptions
					.size === 1,
		);
		const localChannel = [
			...(
				first.app.realtime as any
			).channelEventLedger.localSubscriptions.values(),
		][0].channel as string;
		await first.app.realtime.appendChannelEvent({
			channel: localChannel,
			event: "message",
			schemaIdentity: "ha-test",
			data: { text: "cross-instance" },
		});
		expect(
			await withTimeout(reader.read("channel_event"), "typed channel event"),
		).toMatchObject({ data: { text: "cross-instance" } });

		const removeChannel = await secondRoutes.realtime.subscribe(
			desiredRequest(session, 5, [
				{
					id: "items-replacement",
					topic: {
						resourceType: "collection",
						resource: "items",
						where: { name: "replacement" },
					},
				},
			]),
			{},
			undefined,
		);
		expect(removeChannel.status).toBe(202);
		await waitFor(
			() =>
				(first.app.realtime as any).channelEventLedger.localSubscriptions
					.size === 0,
		);

		const ownerApplyFailure = await secondRoutes.realtime.subscribe(
			desiredRequest(session, 6, [
				{
					id: "items-replacement",
					topic: {
						resourceType: "collection",
						resource: "items",
						where: { name: "replacement" },
					},
				},
				{
					id: "control-only",
					topic: {
						resourceType: "collection",
						resource: "controlOnly",
					},
				},
			]),
			{},
			undefined,
		);
		expect(ownerApplyFailure.status).toBe(202);
		expect(
			await withTimeout(
				reader.read("error"),
				"cross-instance owner admission rejection",
			),
		).toMatchObject({
			topologyEntryId: "control-only",
			kind: "query",
			code: "REALTIME_SUBSCRIPTION_REJECTED",
		});
		await waitFor(() => first.app.realtime.listeners.size === 1);
		await waitFor(
			() =>
				(first.app.realtime.getMetrics().counters[
					"topology.lifecycle|outcome=rejected|phase=apply"
				] ?? 0) === 1,
		);
		expect(session.sessionId).toBeTruthy();
	} finally {
		await reader?.close().catch(() => {});
		await Promise.all([first.cleanup(), second.cleanup()]);
		await database.close();
	}
}, 20_000);
