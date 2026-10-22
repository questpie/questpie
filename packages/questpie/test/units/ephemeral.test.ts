import { afterEach, describe, expect, test } from "bun:test";

import { z } from "zod";

import {
	pageAwareness,
	announceCursor,
} from "../../examples/ephemeral-awareness.js";
import { resolveChannelAuthoritySubject } from "../../src/server/channels/authority.js";
import { channel } from "../../src/server/channels/channel-builder.js";
import { InProcessEphemeralBroker } from "../../src/server/channels/ephemeral-broker.js";
import {
	decodeEphemeralPacket,
	encodeEphemeralPackets,
} from "../../src/server/channels/ephemeral-wire.js";
import {
	EphemeralChannels,
	EPHEMERAL_MAX_PACKET_BYTES,
} from "../../src/server/channels/ephemeral.js";
import { createChannels } from "../../src/server/channels/service.js";
import {
	RequestScope,
	runWithRequestScope,
	getActiveRequestScope,
} from "../../src/server/config/request-scope.js";
import { RealtimeBindingOutputGate } from "../../src/server/modules/core/integrated/realtime/edge-session.js";
import { encodeSseEvent } from "../../src/server/modules/core/integrated/realtime/sse-client-transport.js";
import type { ClientSink } from "../../src/server/modules/core/integrated/realtime/transport.js";
import { parseCompatibleTypedEventWire } from "../../src/shared/typed-wire.js";

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
	test("authority extraction accepts an unaugmented unknown session and validates its shape", () => {
		for (const session of [
			undefined,
			null,
			42,
			"guest",
			{},
			{ user: "guest" },
			{ user: { id: 42 } },
		]) {
			expect(resolveChannelAuthoritySubject({ session })).toBeNull();
		}
		expect(
			resolveChannelAuthoritySubject({ session: { user: { id: "ada" } } }),
		).toEqual({ kind: "user", id: "ada" });
		expect(
			resolveChannelAuthoritySubject({
				session: { session: { id: "session-one" } },
			}),
		).toEqual({ kind: "session", id: "session-one" });
	});

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
		expect(() => original.ephemeral({ coalesceMs: -1 })).toThrow();
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

	test("zero-delay typing and presence bypass a pending cursor window", async () => {
		expect(
			channel("typing").ephemeral({ coalesceMs: 0 }).ephemeralOptions
				?.coalesceMs,
		).toBe(0);
		const { value, broker } = runtime(undefined, {
			authorizationIntervalMs: 1000,
			heartbeatMs: 10000,
			leaseMs: 30000,
		});
		await value.publish(
			{ channel: "page", event: "cursor", data: 1 },
			{ coalesceMs: 1000 },
			"ada",
		);
		const target = sink();
		const release = await value.subscribe({
			subscriptionId: "s",
			channel: "page",
			sink: target.output,
			presence: {
				channel: "page",
				connectionId: "ada",
				principalId: "ada",
				data: { id: "ada" },
				sink: target.output,
			},
		});
		await until(() =>
			target.frames.some(
				(frame) =>
					frame.type === "channel_presence" && frame.data.members.length === 1,
			),
		);
		expect(
			broker.packets.some((packet) =>
				decodeEphemeralPacket<{ kind: string }>(packet).entries.some(
					(entry) => entry.kind === "member",
				),
			),
		).toBe(true);
		expect(target.events()).toHaveLength(0);
		await value.publish(
			{ channel: "typing", event: "typing", data: true },
			{ coalesceMs: 0 },
			"ada",
		);
		await until(() =>
			broker.packets.some(
				(packet) => decodeEphemeralPacket(packet).channel === "typing",
			),
		);
		expect(target.events()).toHaveLength(0);
		await release();
		await until(() =>
			broker.packets.some((packet) =>
				decodeEphemeralPacket<{ kind: string }>(packet).entries.some(
					(entry) => entry.kind === "leave",
				),
			),
		);
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
		await broker.publish(
			encodeEphemeralPackets("page", [
				{ kind: "member", id: "remote", principal: "b", data: { id: "b" } },
			]),
		);
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
			broker.packets.flatMap((p) => decodeEphemeralPacket(p).entries),
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
			(p) => decodeEphemeralPacket<{ data: { actorId: string } }>(p).entries,
		);
		expect(entries.map((entry) => entry.data.actorId)).toEqual(["ada", "bob"]);
	});

	test("queued payload is a snapshot and pending signal keys are bounded", async () => {
		const { value, broker } = runtime();
		const data = { x: 1 };
		await value.publish({ channel: "page", event: "cursor", data }, {}, "ada");
		data.x = 99;
		await until(() => broker.packets.length > 0);
		expect(
			decodeEphemeralPacket<any>(broker.packets[0]!).entries[0].data,
		).toEqual({
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
			(p) => decodeEphemeralPacket(p).entries,
		);
		expect(entries).toHaveLength(100);
	});

	test("anonymous publishes do not overwrite a system publisher or one another", async () => {
		const { value, broker } = runtime();
		const definitions = {
			page: channel("public-page")
				.events({ cursor: z.string() })
				.authorize({ subscribe: true, publish: true })
				.ephemeral(),
		};
		const publisher = {
			appendChannelEvent: async () => {
				throw new Error("No ledger");
			},
			publishEphemeralEvent: value.publish.bind(value),
		};
		const system = createChannels(definitions, publisher, {
			accessMode: "system",
		} as any);
		const anonymous = createChannels(definitions, publisher, {
			accessMode: "user",
			session: null,
		} as any);
		await system.page.publish("cursor", "server");
		await anonymous.page.publish("cursor", "guest-one");
		await anonymous.page.publish("cursor", "guest-two");
		await until(() => broker.packets.length > 0);
		const entries = broker.packets.flatMap(
			(packet) => decodeEphemeralPacket<{ data: string }>(packet).entries,
		);
		expect(entries.map((entry) => entry.data).sort()).toEqual([
			"guest-one",
			"guest-two",
			"server",
		]);
	});

	test("staging preserves presence and independent signals after channel_ready", async () => {
		const { value } = runtime(undefined, {
			heartbeatMs: 10000,
			leaseMs: 30000,
		});
		const target = sink();
		const gate = new RealtimeBindingOutputGate(target.output, {
			maximumOrderedEvents: 10,
			maximumBufferedBytes: 10000,
			onError(error) {
				throw error;
			},
		});
		await value.subscribe({
			subscriptionId: "staged",
			channel: "page",
			sink: gate,
			onReady: async () => {
				await gate.writeControl(
					encodeSseEvent("channel_ready", { channel: "page" }),
				);
			},
			presence: {
				channel: "page",
				connectionId: "ada",
				principalId: "ada",
				data: { id: "ada" },
				sink: gate,
			},
		});
		await value.publish(
			{ channel: "page", event: "cursor", data: 1 },
			{ coalesceMs: 0 },
			"ada",
		);
		await wait(30);
		expect(target.frames).toHaveLength(0);
		gate.activate();
		await until(() => target.events().length === 1);
		expect(target.frames[0]!.type).toBe("channel_ready");
		expect(
			target.frames.some(
				(frame) =>
					frame.type === "channel_presence" &&
					frame.data.members[0]?.id === "ada",
			),
		).toBe(true);
	});

	test("a failed best-effort flush leaves healthy subscriptions admitted", async () => {
		class FailingBroker extends RecordingBroker {
			fail = true;
			override async publish(messages: readonly string[]) {
				if (this.fail) {
					this.fail = false;
					throw new Error("publish failed");
				}
				await super.publish(messages);
			}
		}
		const { value, broker } = runtime(new FailingBroker());
		const target = sink();
		await value.subscribe({
			subscriptionId: "s",
			channel: "page",
			sink: target.output,
		});
		await value.publish(
			{ channel: "page", event: "cursor", data: 1 },
			{ coalesceMs: 0 },
			"ada",
		);
		await wait(20);
		expect(target.closed).toHaveLength(0);
		await value.publish(
			{ channel: "page", event: "cursor", data: 2 },
			{ coalesceMs: 0 },
			"ada",
		);
		await until(() => target.events().length === 1);
		expect(target.events()[0]!.data.data).toBe(2);
		expect(broker.packets).toHaveLength(1);
	});

	test("authorization infrastructure errors close the transport without terminal revocation", async () => {
		const { value } = runtime();
		const target = sink();
		let fail = false;
		await value.subscribe({
			subscriptionId: "s",
			channel: "page",
			sink: target.output,
			reauthorize: async () => {
				if (fail) throw new Error("database unavailable");
				return true;
			},
		});
		await wait(10);
		fail = true;
		await until(() => target.closed.length > 0);
		expect(target.closed).toEqual(["transport_error"]);
		expect(
			target.frames.filter((frame) => frame.type === "error"),
		).toHaveLength(0);
	});

	test("graceful shutdown sends leave before stopping the broker", async () => {
		const listeners = new Set<(message: string) => void>();
		class SharedBroker extends InProcessEphemeralBroker {
			private callback?: (message: string) => void;
			override async start(callback: (message: string) => void) {
				this.callback = callback;
				listeners.add(callback);
			}
			override async publish(messages: readonly string[]) {
				for (const message of messages)
					for (const listener of listeners) listener(message);
			}
			override async stop() {
				if (this.callback) listeners.delete(this.callback);
			}
		}
		const a = new EphemeralChannels({ broker: new SharedBroker() });
		const b = new EphemeralChannels({ broker: new SharedBroker() });
		runtimes.push(a, b);
		const first = sink(),
			second = sink();
		for (const [value, target, id] of [
			[a, first, "ada"],
			[b, second, "bob"],
		] as const) {
			await value.subscribe({
				channel: "page",
				subscriptionId: id,
				sink: target.output,
				presence: {
					channel: "page",
					connectionId: id,
					principalId: id,
					data: { id },
					sink: target.output,
				},
			});
		}
		await until(() =>
			second.frames.some((frame) => frame.data.members?.length === 2),
		);
		await a.destroy();
		await until(
			() =>
				second.frames
					.filter((frame) => frame.type === "channel_presence")
					.at(-1)?.data.members.length === 1,
		);
		expect(
			second.frames.filter((frame) => frame.type === "channel_presence").at(-1)!
				.data.members,
		).toEqual([{ id: "bob" }]);
	});

	test("capacity is configurable and rejects pending overflow instead of returning a receipt", async () => {
		const { value } = runtime(undefined, {
			maxTopics: 120,
			maxSubscriptionsPerTopic: 2,
		});
		for (let i = 0; i < 101; i++)
			await value.subscribe({
				subscriptionId: String(i),
				channel: `page-${i}`,
				sink: sink().output,
			});
		await value.subscribe({
			subscriptionId: "second",
			channel: "page-0",
			sink: sink().output,
		});
		await expect(
			value.subscribe({
				subscriptionId: "third",
				channel: "page-0",
				sink: sink().output,
			}),
		).rejects.toThrow("subscriptions");
		const limited = runtime(undefined, { maxTopics: 1 }).value;
		await limited.publish(
			{ channel: "one", event: "cursor", data: 1 },
			{ coalesceMs: 1000 },
			"a",
		);
		await expect(
			limited.publish(
				{ channel: "two", event: "cursor", data: 1 },
				{ coalesceMs: 1000 },
				"a",
			),
		).rejects.toThrow("capacity");
	});

	test("ephemeral rule deadlines remain retryable while durable rule deadlines deny", async () => {
		const definitions = {
			awareness: channel("awareness")
				.authorize({
					subscribe: async () => {
						await wait(30);
						return true;
					},
				})
				.ephemeral(),
			durable: channel("durable").authorize({
				subscribe: async () => {
					await wait(30);
					return true;
				},
			}),
		};
		const channels = createChannels(
			definitions,
			{
				appendChannelEvent: async () => {
					throw new Error("No ledger");
				},
			},
			{ accessMode: "system" } as any,
			{ authorizationTimeoutMs: 5 },
		);
		await expect(
			channels.awareness.authorize("subscribe"),
		).rejects.toMatchObject({ code: "channel_rule_failed" });
		expect(await channels.durable.authorize("subscribe")).toBe(false);
	});

	test("infrastructure callbacks do not retain the initiating request scope", async () => {
		const app = {};
		const observations: boolean[] = [];
		class ScopedBroker extends RecordingBroker {
			override async start(message: (message: string) => void) {
				observations.push(!!getActiveRequestScope(app));
				await super.start(message);
			}
			override async publish(messages: readonly string[]) {
				observations.push(!!getActiveRequestScope(app));
				await super.publish(messages);
			}
		}
		const { value } = runtime(new ScopedBroker());
		const scope = new RequestScope();
		await runWithRequestScope(app, scope, () =>
			value.publish(
				{ channel: "page", event: "cursor", data: 1 },
				{ coalesceMs: 0 },
				"ada",
			),
		);
		await scope.dispose();
		await until(() => observations.length === 2);
		expect(observations).toEqual([false, false]);
	});

	test("packing large batches preserves typed values and UTF-8 limits", () => {
		const entries = Array.from({ length: 10000 }, (_, id) => ({
			id,
			data: "é".repeat(30),
			at: new Date(0),
		}));
		const packets = encodeEphemeralPackets("page", entries);
		expect(
			packets.every(
				(packet) => Buffer.byteLength(packet) <= EPHEMERAL_MAX_PACKET_BYTES,
			),
		).toBe(true);
		expect(
			packets.flatMap((packet) => decodeEphemeralPacket(packet).entries),
		).toEqual(entries);
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
