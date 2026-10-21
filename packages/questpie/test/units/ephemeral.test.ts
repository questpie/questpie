import { afterEach, describe, expect, test } from "bun:test";

import { z } from "zod";

import {
	pageAwareness,
	announceCursor,
} from "../../examples/ephemeral-awareness.js";
import { channel } from "../../src/server/channels/channel-builder.js";
import { InProcessEphemeralBroker } from "../../src/server/channels/ephemeral-broker.js";
import {
	EphemeralChannels,
	EPHEMERAL_MAX_PACKET_BYTES,
} from "../../src/server/channels/ephemeral.js";
import { createChannels } from "../../src/server/channels/service.js";
import type { ClientSink } from "../../src/server/modules/core/integrated/realtime/transport.js";
import {
	parseTypedWire,
	parseCompatibleTypedEventWire,
} from "../../src/shared/typed-wire.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
	for (let i = 0; i < 200; i++) {
		if (check()) return;
		await wait(10);
	}
	throw new Error("Timed out");
}
function sink() {
	const frames: { type: string; data: Record<string, any> }[] = [];
	const closed: string[] = [];
	const output: ClientSink = {
		sessionId: crypto.randomUUID(),
		async write(frame) {
			const lines = new TextDecoder().decode(frame).split("\n");
			frames.push({
				type: lines[0]!.slice(7),
				data: parseCompatibleTypedEventWire(lines[1]!.slice(6)),
			});
			return { status: "accepted", bufferedBytes: 0 };
		},
		async close(reason) {
			closed.push(reason);
		},
	};
	return {
		output,
		frames,
		closed,
		events: () => frames.filter((f) => f.type === "channel_ephemeral"),
	};
}
class RecordingBroker extends InProcessEphemeralBroker {
	packets: string[] = [];
	disconnect?: (error: unknown) => void;
	override async start(
		message: (message: string) => void,
		disconnect?: (error: unknown) => void,
	) {
		this.disconnect = disconnect;
		await super.start(message);
	}
	override async publish(messages: readonly string[]) {
		this.packets.push(...messages);
		await super.publish(messages);
	}
}
const runtimes: EphemeralChannels[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.destroy();
});
function runtime(broker = new RecordingBroker(), options = {}) {
	const value = new EphemeralChannels({
		broker,
		authorizationIntervalMs: 20,
		heartbeatMs: 40,
		leaseMs: 120,
		...options,
	});
	runtimes.push(value);
	return { value, broker };
}

describe("ephemeral channels", () => {
	test("immutable opt-in survives all builder methods and validates bounds", () => {
		const original = channel("page-[id]");
		const room = original
			.ephemeral()
			.events({ cursor: z.number() })
			.authorize({ subscribe: true })
			.presence(() => ({ id: "a" }));
		expect(original.ephemeralOptions).toBeUndefined();
		expect(room.ephemeralOptions).toEqual({
			coalesceMs: 100,
			maxPayloadBytes: 1024,
		});
		expect(Object.isFrozen(room.ephemeralOptions)).toBe(true);
		expect(() => original.ephemeral({ coalesceMs: 0 })).toThrow();
		expect(() => original.ephemeral({ maxPayloadBytes: 4097 })).toThrow();
	});

	test("coalesces per publisher AND event, preserving other publishers on the same page", async () => {
		const { value, broker } = runtime();
		const target = sink();
		await value.subscribe({
			subscriptionId: "s",
			channel: "page-one",
			sink: target.output,
		});
		for (let i = 0; i < 20; i++)
			await value.publish(
				{ channel: "page-one", event: "cursor", data: { i } },
				{},
				"ada",
			);
		await value.publish(
			{ channel: "page-one", event: "cursor", data: { i: 42 } },
			{},
			"bob",
		);
		await value.publish(
			{ channel: "page-one", event: "typing", data: true },
			{},
			"ada",
		);
		await until(() => target.events().length === 3);
		expect(broker.packets).toHaveLength(1);
		expect(target.events().map((f) => f.data.data)).toEqual([
			{ i: 19 },
			{ i: 42 },
			true,
		]);
	});

	test("authorizes subscribe and each delivery, including idle revocation and thrown rules", async () => {
		const { value } = runtime();
		let allowed = true;
		const target = sink();
		await value.subscribe({
			subscriptionId: "s",
			channel: "page",
			sink: target.output,
			reauthorize: async () => allowed,
		});
		allowed = false;
		await until(() => target.closed.length === 1);
		await value.publish({ channel: "page", event: "cursor", data: 1 }, {}, "a");
		await wait(120);
		expect(target.events()).toHaveLength(0);
		await expect(
			value.subscribe({
				subscriptionId: "denied",
				channel: "page",
				sink: sink().output,
				reauthorize: async () => false,
			}),
		).rejects.toThrow("denied");
		await expect(
			value.subscribe({
				subscriptionId: "throw",
				channel: "page",
				sink: sink().output,
				reauthorize: async () => {
					throw new Error("oops");
				},
			}),
		).rejects.toThrow("denied");
	});

	test("rechecks access before delivery even when the idle timer is far away", async () => {
		const { value } = runtime(new RecordingBroker(), {
			authorizationIntervalMs: 10_000,
			heartbeatMs: 10_000,
			leaseMs: 30_000,
		});
		const target = sink();
		let allowed = true;
		await value.subscribe({
			subscriptionId: "s",
			channel: "page",
			sink: target.output,
			reauthorize: async () => allowed,
		});
		await wait(10);
		allowed = false;
		await value.publish(
			{ channel: "page", event: "cursor", data: 1 },
			{},
			"ada",
		);
		await until(() => target.closed.length > 0);
		expect(target.events()).toHaveLength(0);
	});

	test("validates the whole ephemeral publish batch before enqueuing any event", async () => {
		const { value, broker } = runtime();
		const definitions = {
			news: channel("news").events({ text: z.string() }).ephemeral(),
		};
		const channels = createChannels(
			definitions,
			{
				appendChannelEvent: async () => {
					throw new Error("No ledger");
				},
				publishEphemeralEvent: value.publish.bind(value),
			},
			{ accessMode: "system" } as any,
		);
		await expect(
			channels.publishBatch([
				{ channel: "news", event: "text", data: "valid" },
				{ channel: "news", event: "text", data: "x".repeat(2000) },
			]),
		).rejects.toMatchObject({ code: "channel_payload_too_large" });
		await wait(120);
		expect(broker.packets).toHaveLength(0);
	});

	test("in-flight authorization cannot deliver after release", async () => {
		const { value } = runtime();
		const target = sink();
		let resolve: ((value: boolean) => void) | undefined;
		let slow = false;
		const release = await value.subscribe({
			subscriptionId: "s",
			channel: "page",
			sink: target.output,
			reauthorize: async () =>
				slow
					? new Promise<boolean>((r) => {
							resolve = r;
						})
					: true,
		});
		await wait(10);
		slow = true;
		await value.publish(
			{ channel: "page", event: "cursor", data: 1 },
			{ coalesceMs: 10 },
			"a",
		);
		await until(() => !!resolve);
		await release();
		resolve!(true);
		await wait(30);
		expect(target.events()).toHaveLength(0);
	});

	test("presence joins, renews, deduplicates principals and leaves in memory", async () => {
		const { value } = runtime();
		const a = sink(),
			b = sink();
		const releaseA = await value.subscribe({
			subscriptionId: "a",
			channel: "page",
			sink: a.output,
			presence: {
				channel: "page",
				connectionId: "a",
				principalId: "ada",
				data: { id: "ada" },
				sink: a.output,
			},
		});
		const releaseB = await value.subscribe({
			subscriptionId: "b",
			channel: "page",
			sink: b.output,
			presence: {
				channel: "page",
				connectionId: "b",
				principalId: "ada",
				data: { id: "ada" },
				sink: b.output,
			},
		});
		await until(() =>
			a.frames.some(
				(f) => f.type === "channel_presence" && f.data.members.length === 1,
			),
		);
		await wait(200);
		expect(
			a.frames.filter((f) => f.type === "channel_presence").at(-1)!.data
				.members,
		).toEqual([{ id: "ada" }]);
		await releaseB();
		await wait(120);
		expect(
			a.frames.filter((f) => f.type === "channel_presence").at(-1)!.data
				.members,
		).toHaveLength(1);
		await releaseA();
	});

	test("remote crash expires after the lease and broker disconnect ends subscriptions", async () => {
		const { value, broker } = runtime();
		const target = sink();
		await value.subscribe({
			subscriptionId: "s",
			channel: "page",
			sink: target.output,
			presence: {
				channel: "page",
				connectionId: "local",
				principalId: "a",
				data: { id: "a" },
				sink: target.output,
			},
		});
		const { stringifyTypedWire } =
			await import("../../src/shared/typed-wire.js");
		await broker.publish([
			stringifyTypedWire({
				channel: "page",
				entries: [
					{ kind: "member", id: "remote", principal: "b", data: { id: "b" } },
				],
			}),
		]);
		await until(() =>
			target.frames.some((f) => f.data.members?.some((m: any) => m.id === "b")),
		);
		await until(() =>
			target.frames
				.filter((f) => f.type === "channel_presence")
				.at(-1)
				?.data.members.every((m: any) => m.id !== "b"),
		);
		broker.disconnect!(new Error("connection lost"));
		await until(() => target.closed.length === 1);
	});

	test("splits UTF-8 packets below Postgres limit and enforces payload size", async () => {
		const { value, broker } = runtime();
		for (let i = 0; i < 10; i++)
			await value.publish(
				{ channel: "page", event: "cursor", data: "é".repeat(400) },
				{},
				String(i),
			);
		await until(() => broker.packets.length >= 2);
		expect(
			broker.packets.every(
				(p) => Buffer.byteLength(p) <= EPHEMERAL_MAX_PACKET_BYTES,
			),
		).toBe(true);
		expect(
			broker.packets.flatMap(
				(p) => parseTypedWire<{ entries: unknown[] }>(p).entries,
			),
		).toHaveLength(10);
		await expect(
			value.publish(
				{ channel: "page", event: "cursor", data: "é".repeat(600) },
				{},
				"a",
			),
		).rejects.toMatchObject({ code: "channel_payload_too_large" });
	});

	test("documented awareness example preserves multiple server-resolved actors", async () => {
		const { value, broker } = runtime();
		const definitions = { page: pageAwareness(true, () => ({ id: "ada" })) };
		const channels = createChannels(
			definitions,
			{
				appendChannelEvent: async () => {
					throw new Error("No ledger");
				},
				publishEphemeralEvent: value.publish.bind(value),
			},
			{ accessMode: "system" } as any,
		);
		await announceCursor(channels, {
			pageId: "one",
			actorId: "ada",
			x: 1,
			y: 2,
		});
		await announceCursor(channels, {
			pageId: "one",
			actorId: "bob",
			x: 3,
			y: 4,
		});
		await until(() => broker.packets.length > 0);
		const entries = broker.packets.flatMap(
			(p) =>
				parseTypedWire<{ entries: { data: { actorId: string } }[] }>(p).entries,
		);
		expect(entries.map((entry) => entry.data.actorId)).toEqual(["ada", "bob"]);
	});

	test("queued payload is a snapshot and pending signal keys are bounded", async () => {
		const { value, broker } = runtime();
		const data = { x: 1 };
		await value.publish({ channel: "page", event: "cursor", data }, {}, "ada");
		data.x = 99;
		await until(() => broker.packets.length > 0);
		expect(parseTypedWire<any>(broker.packets[0]!).entries[0].data).toEqual({
			x: 1,
		});
		broker.packets.length = 0;
		for (let i = 0; i < 110; i++)
			await value.publish(
				{ channel: "page", event: "cursor", data: i },
				{},
				String(i),
			);
		await until(() => broker.packets.length > 0);
		const entries = broker.packets.flatMap(
			(p) => parseTypedWire<{ entries: unknown[] }>(p).entries,
		);
		expect(entries).toHaveLength(100);
	});

	test("typed facade uses no ledger or transaction, schemas and publish rules still apply", async () => {
		const { value } = runtime();
		let appends = 0;
		const publisher = {
			appendChannelEvent: async () => {
				appends++;
				throw new Error("No ledger allowed");
			},
			publishEphemeralEvent: value.publish.bind(value),
		};
		const definitions = {
			page: channel("page-[id]")
				.events({ cursor: z.number() })
				.authorize({ subscribe: true, publish: false })
				.ephemeral(),
		};
		const system = createChannels(definitions, publisher, {
			accessMode: "system",
			db: new Proxy(
				{},
				{
					get() {
						throw new Error("No database access allowed");
					},
				},
			),
		} as any);
		await system
			.page({ id: "one" })
			.publish("cursor", 1, { coalesceKey: "ada" });
		const user = createChannels(definitions, publisher, {
			accessMode: "user",
			session: { user: { id: "ada" } },
		} as any);
		await expect(
			user.page({ id: "one" }).publish("cursor", 2),
		).rejects.toMatchObject({ code: "channel_publish_denied" });
		await expect(
			system.page({ id: "one" }).publish("cursor", "bad" as any),
		).rejects.toMatchObject({ code: "channel_event_invalid" });
		expect(appends).toBe(0);
	});
});
