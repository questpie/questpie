import { runWithoutRequestScope } from "#questpie/server/config/request-scope.js";
import type {
	LocalChannelAuthorization,
	LocalChannelSubscriptionInput,
} from "#questpie/server/modules/core/integrated/realtime/channel-event-ledger.js";
import type { RegisterChannelPresenceInput } from "#questpie/server/modules/core/integrated/realtime/sse-channel-presence.js";
import { encodeSseEvent } from "#questpie/server/modules/core/integrated/realtime/sse-client-transport.js";
import {
	parseTypedWire,
	stringifyTypedWire,
} from "#questpie/shared/typed-wire.js";

import type { EphemeralChannelOptions } from "./channel-builder.js";
import {
	InProcessEphemeralBroker,
	type EphemeralBroker,
} from "./ephemeral-broker.js";
import {
	decodeEphemeralPacket,
	encodeEphemeralPackets,
} from "./ephemeral-wire.js";
import { ChannelSecurityError } from "./security.js";
export { EPHEMERAL_MAX_PACKET_BYTES } from "./ephemeral-wire.js";
const MAX_KEYS = 100;

export type EphemeralConfig = {
	broker?: EphemeralBroker;
	/** Per-process admission bounds. Defaults 4096 topics and 1000 subscriptions/members per topic. */
	maxTopics?: number;
	maxSubscriptionsPerTopic?: number;
	/** Idle access revocation bound. Delivery also checks access before each batch. Default 1000 ms. */
	authorizationIntervalMs?: number;
	/** Presence refresh/expiry. Defaults 10s/30s; lease must exceed heartbeat. */
	heartbeatMs?: number;
	leaseMs?: number;
};

type EventEntry = {
	kind: "event";
	key: string;
	event: string;
	eventId: string;
	data: unknown;
};
type MemberEntry = {
	kind: "member";
	id: string;
	principal: string;
	data: Record<string, unknown>;
};
type Entry =
	| EventEntry
	| MemberEntry
	| { kind: "leave"; id: string }
	| { kind: "sync" };
type Packet = { channel: string; entries: Entry[] };
export class EphemeralSubscriptionUnavailableError extends Error {
	constructor(cause: unknown) {
		super("Ephemeral subscription is unavailable", { cause });
		this.name = "EphemeralSubscriptionUnavailableError";
	}
}

type SubscriptionInput = Omit<LocalChannelSubscriptionInput, "stage"> & {
	channelSubscriptionId?: string;
	presence?: RegisterChannelPresenceInput;
};
type Subscription = {
	input: SubscriptionInput;
	pending: Map<string, EventEntry>;
	presenceDirty: boolean;
	busy: boolean;
	closed: boolean;
	lastPresence?: string;
	lastHeartbeat: number;
};
type Topic = {
	subscriptions: Set<Subscription>;
	members: Map<
		string,
		{ entry: MemberEntry; expires: number; signature: string }
	>;
	presence?: { signature: string; frame: Uint8Array };
};
type Pending = {
	entries: Map<string, Entry>;
	urgent: Map<string, Entry>;
	due: number;
};

function bytes(value: string): number {
	return Buffer.byteLength(value, "utf8");
}
function entryKey(entry: Entry): string {
	return entry.kind === "event"
		? JSON.stringify([entry.key, entry.event])
		: entry.kind === "sync"
			? "sync"
			: `member:${entry.id}`;
}

/** Shared preflight: validate an entire publish batch before enqueuing any item. */
export function serializeEphemeralPayload(
	data: unknown,
	options: EphemeralChannelOptions,
): string {
	const serialized = stringifyTypedWire(data);
	if (bytes(serialized) > (options.maxPayloadBytes ?? 1024))
		throw new ChannelSecurityError(
			"channel_payload_too_large",
			"Ephemeral payload exceeds limit",
		);
	return serialized;
}

/** Lossy bounded lane. No database, durable cursors, retries or transaction handles. */
export class EphemeralChannels {
	private readonly broker: EphemeralBroker;
	private readonly topics = new Map<string, Topic>();
	private readonly pending = new Map<string, Pending>();
	private readonly eventFrames = new WeakMap<EventEntry, Uint8Array>();
	private starting?: Promise<void>;
	private timer?: ReturnType<typeof setInterval>;
	private stopped = false;
	private flushing = false;
	private flushOperation?: Promise<void>;
	private flushTimer?: ReturnType<typeof setTimeout>;
	private flushDue = Infinity;
	private readonly epoch = Date.now();
	private readonly heartbeatMs: number;
	private readonly leaseMs: number;
	private readonly authorizationIntervalMs: number;
	private readonly maxTopics: number;
	private readonly maxSubscriptionsPerTopic: number;
	private closing = false;

	constructor(
		config: EphemeralConfig = {},
		private readonly onError: (error: unknown) => void = () => {},
	) {
		this.broker = config.broker ?? new InProcessEphemeralBroker();
		this.maxTopics = config.maxTopics ?? 4096;
		this.maxSubscriptionsPerTopic = config.maxSubscriptionsPerTopic ?? 1000;
		if (
			![this.maxTopics, this.maxSubscriptionsPerTopic].every(
				(value) => Number.isSafeInteger(value) && value > 0,
			)
		)
			throw new Error("Invalid ephemeral capacity");
		this.heartbeatMs = config.heartbeatMs ?? 10_000;
		this.leaseMs = config.leaseMs ?? 30_000;
		this.authorizationIntervalMs = config.authorizationIntervalMs ?? 1000;
		if (
			!(
				this.heartbeatMs > 0 &&
				this.leaseMs > this.heartbeatMs &&
				this.authorizationIntervalMs > 0
			)
		) {
			throw new Error(
				"Invalid ephemeral heartbeat, lease or authorization interval",
			);
		}
	}

	private async start(): Promise<void> {
		if (this.stopped || this.closing)
			throw new Error("Ephemeral runtime is closed");
		this.starting ??= runWithoutRequestScope(() =>
			this.broker
				.start(
					(message) => {
						try {
							this.receive(decodeEphemeralPacket<Entry>(message));
						} catch (error) {
							this.onError(error);
						}
					},
					(error) => {
						this.onError(error);
						void this.disconnectAll();
					},
				)
				.catch((error) => {
					this.starting = undefined;
					throw error;
				}),
		);
		await this.starting;
		if (this.stopped || this.closing)
			throw new Error("Ephemeral runtime is closed");
	}

	async publish(
		input: { channel: string; event: string; data: unknown },
		options: EphemeralChannelOptions,
		publisher: string,
	): Promise<{ eventId: string }> {
		const eventId = crypto.randomUUID();
		const serializedData = serializeEphemeralPayload(input.data, options);
		const entry: EventEntry = {
			kind: "event",
			key: publisher,
			eventId,
			event: input.event,
			data: parseTypedWire(serializedData),
		};
		// Check the complete envelope too: schema/event metadata also consumes NOTIFY's budget.
		try {
			encodeEphemeralPackets(input.channel, [entry]);
		} catch {
			throw new ChannelSecurityError(
				"channel_payload_too_large",
				"Ephemeral envelope exceeds limit",
			);
		}
		await this.start();
		if (!this.enqueue(input.channel, entry, options.coalesceMs))
			throw new Error("Ephemeral pending topic capacity exceeded");
		return { eventId };
	}

	private enqueue(channel: string, entry: Entry, coalesceMs = 100): boolean {
		if (this.stopped) return false;
		let pending = this.pending.get(channel);
		if (!pending) {
			if (this.pending.size >= this.maxTopics) {
				this.onError(new Error("Ephemeral pending topic capacity exceeded"));
				return false;
			}
			pending = {
				entries: new Map(),
				urgent: new Map(),
				due: Infinity,
			};
			this.pending.set(channel, pending);
		}
		const urgent = entry.kind !== "event";
		const entries = urgent ? pending.urgent : pending.entries;
		if (!urgent && entries.size === 0) {
			pending.due =
				coalesceMs === 0
					? Date.now()
					: this.epoch +
						(Math.floor((Date.now() - this.epoch) / coalesceMs) + 1) *
							coalesceMs;
		}
		const key = entryKey(entry);
		const limit = urgent ? this.maxSubscriptionsPerTopic + 1 : MAX_KEYS;
		if (entries.size >= limit && !entries.has(key)) {
			// Drop the oldest pending signal under overload, retaining the newest state.
			entries.delete(entries.keys().next().value!);
		}
		entries.set(key, entry);
		this.scheduleFlush(urgent ? Date.now() : pending.due);
		return true;
	}

	private scheduleFlush(due?: number): void {
		if (this.flushing || this.stopped || this.closing || !this.pending.size)
			return;
		due ??= Math.min(
			...[...this.pending.values()].map((batch) =>
				batch.urgent.size ? Date.now() : batch.due,
			),
		);
		if (this.flushTimer && this.flushDue <= due) return;
		if (this.flushTimer) clearTimeout(this.flushTimer);
		this.flushDue = due;
		this.flushTimer = runWithoutRequestScope(() =>
			setTimeout(
				() => {
					this.flushTimer = undefined;
					this.flushDue = Infinity;
					this.flushOperation = this.flush();
				},
				Math.max(1, due - Date.now()),
			),
		);
		this.flushTimer.unref?.();
	}

	private async flush(): Promise<void> {
		if (this.flushing || this.stopped) return;
		this.flushing = true;
		// Snapshot once: concurrent ingress stays bounded in the next coalescing window.
		const pending = [...this.pending].filter(
			([, batch]) => batch.urgent.size > 0 || batch.due <= Date.now(),
		);
		try {
			const packets: string[] = [];
			for (const [channel, batch] of pending) {
				const ready = [...batch.urgent.values()];
				batch.urgent.clear();
				if (batch.due <= Date.now()) {
					ready.push(...batch.entries.values());
					batch.entries.clear();
					batch.due = Infinity;
				}
				if (!batch.entries.size) this.pending.delete(channel);
				packets.push(...encodeEphemeralPackets(channel, ready));
			}
			if (packets.length) await this.broker.publish(packets);
		} catch (error) {
			// Best effort: a failed publish loses this batch; healthy subscriptions stay admitted.
			this.onError(error);
		} finally {
			this.flushing = false;
			this.scheduleFlush();
		}
	}

	async subscribe(input: SubscriptionInput): Promise<() => Promise<void>> {
		if (input.presence && bytes(stringifyTypedWire(input.presence.data)) > 1024)
			throw new Error("Ephemeral presence exceeds 1024 bytes");
		try {
			await this.start();
		} catch (error) {
			throw new EphemeralSubscriptionUnavailableError(error);
		}
		let topic = this.topics.get(input.channel);
		if (!topic) {
			if (this.topics.size >= this.maxTopics)
				throw new Error("Too many ephemeral topics");
			topic = { subscriptions: new Set(), members: new Map() };
			this.topics.set(input.channel, topic);
		}
		if (topic.subscriptions.size >= this.maxSubscriptionsPerTopic)
			throw new Error("Too many ephemeral subscriptions");
		const subscription: Subscription = {
			input,
			pending: new Map(),
			presenceDirty: true,
			busy: true,
			closed: false,
			lastHeartbeat: 0,
		};
		topic.subscriptions.add(subscription);
		try {
			if (!(await this.authorize(subscription)))
				throw new Error("Channel subscription is denied");
			await input.onReady?.();
			if (subscription.closed)
				throw new Error("Channel subscription is closed");
			subscription.busy = false;
			this.renew(subscription);
			if (input.presence) this.enqueue(input.channel, { kind: "sync" });
			this.schedule(subscription);
			this.timer ??= runWithoutRequestScope(() =>
				setInterval(
					() => this.tick(),
					Math.min(this.authorizationIntervalMs, this.heartbeatMs),
				),
			);
			this.timer.unref?.();
			return () => this.release(subscription);
		} catch (error) {
			await this.release(subscription);
			throw error;
		}
	}

	private async authorize(subscription: Subscription): Promise<boolean> {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			const result: LocalChannelAuthorization = await Promise.race([
				subscription.input.reauthorize?.() ?? Promise.resolve(true),
				new Promise<never>((_, reject) => {
					timeout = setTimeout(
						() => reject(new Error("Ephemeral authorization timed out")),
						5000,
					);
				}),
			]);
			if (subscription.closed) return false;
			if (
				result === false ||
				(typeof result === "object" && !result.authorized)
			)
				return false;
			if (
				typeof result === "object" &&
				result.presence &&
				subscription.input.presence
			) {
				if (bytes(stringifyTypedWire(result.presence)) > 1024) return false;
				subscription.input.presence.data = result.presence;
			}
			return true;
		} catch (error) {
			throw new EphemeralSubscriptionUnavailableError(error);
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	private renew(subscription: Subscription): void {
		const presence = subscription.input.presence;
		if (!presence || Date.now() - subscription.lastHeartbeat < this.heartbeatMs)
			return;
		subscription.lastHeartbeat = Date.now();
		const entry: MemberEntry = {
			kind: "member",
			id: presence.connectionId,
			principal: presence.principalId,
			data: presence.data,
		};
		// Own membership is known immediately; remote members converge through sync replies.
		this.receive({ channel: presence.channel, entries: [entry] });
		this.enqueue(presence.channel, entry);
	}

	private receive(packet: Packet): void {
		const topic = this.topics.get(packet.channel);
		if (!topic || this.stopped) return;
		let changed = false;
		for (const entry of packet.entries) {
			if (entry.kind === "event") {
				changed = true;
				for (const sub of topic.subscriptions) {
					const key = entryKey(entry);
					if (sub.pending.size < MAX_KEYS || sub.pending.has(key))
						sub.pending.set(key, entry);
				}
			} else if (entry.kind === "sync") {
				for (const sub of topic.subscriptions) {
					sub.lastHeartbeat = 0;
					this.schedule(sub);
				}
			} else {
				if (entry.kind === "member") {
					const signature = stringifyTypedWire([entry.principal, entry.data]);
					const previous = topic.members.get(entry.id);
					if (previous?.signature === signature) {
						previous.expires = Date.now() + this.leaseMs;
						continue;
					}
				}
				changed = true;
				topic.presence = undefined;
				if (entry.kind === "leave") topic.members.delete(entry.id);
				else if (
					topic.members.size < this.maxSubscriptionsPerTopic ||
					topic.members.has(entry.id)
				) {
					topic.members.set(entry.id, {
						entry,
						expires: Date.now() + this.leaseMs,
						signature: stringifyTypedWire([entry.principal, entry.data]),
					});
				}
				for (const sub of topic.subscriptions) sub.presenceDirty = true;
			}
		}
		if (changed) for (const sub of topic.subscriptions) this.schedule(sub);
	}

	private schedule(sub: Subscription): void {
		if (sub.busy || sub.closed) return;
		sub.busy = true;
		queueMicrotask(() => {
			void this.deliver(sub).catch(this.onError);
		});
	}

	private async deliver(sub: Subscription): Promise<void> {
		try {
			if (!(await this.authorize(sub))) {
				await this.revoke(sub);
				return;
			}
			this.renew(sub);
			const events = [...sub.pending.values()];
			sub.pending.clear();
			for (const entry of events) {
				if (sub.closed) return;
				let frame = this.eventFrames.get(entry);
				if (!frame) {
					frame = encodeSseEvent("channel_ephemeral", {
						channel: sub.input.channel,
						event: entry.event,
						eventId: entry.eventId,
						data: entry.data,
					});
					this.eventFrames.set(entry, frame);
				}
				await sub.input.sink.write(frame, "ordered-channel-event");
			}
			if (sub.presenceDirty && sub.input.presence && !sub.closed) {
				sub.presenceDirty = false;
				const topic = this.topics.get(sub.input.channel);
				if (!topic) return;
				if (!topic.presence) {
					const members = new Map<string, Record<string, unknown>>();
					for (const { entry } of topic.members.values())
						members.set(entry.principal, entry.data);
					const snapshot = [...members]
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, data]) => data);
					topic.presence = {
						signature: stringifyTypedWire(snapshot),
						frame: encodeSseEvent("channel_presence", {
							channel: sub.input.channel,
							members: snapshot,
						}),
					};
				}
				const { signature, frame } = topic.presence;
				if (signature !== sub.lastPresence) {
					const result = await sub.input.sink.write(
						frame,
						"ordered-channel-event",
					);
					if (result.status === "accepted") sub.lastPresence = signature;
					else sub.presenceDirty = true;
				}
			}
		} catch (error) {
			this.onError(error);
			await this.release(sub);
			await sub.input.sink.close("transport_error");
		} finally {
			sub.busy = false;
			if (sub.pending.size) this.schedule(sub);
		}
	}

	private tick(): void {
		const now = Date.now();
		for (const topic of this.topics.values()) {
			for (const [id, member] of topic.members) {
				if (member.expires <= now) {
					topic.members.delete(id);
					topic.presence = undefined;
					for (const sub of topic.subscriptions) sub.presenceDirty = true;
				}
			}
			for (const sub of topic.subscriptions) this.schedule(sub);
		}
	}

	private async release(sub: Subscription): Promise<void> {
		if (sub.closed) return;
		sub.closed = true;
		sub.pending.clear();
		const topic = this.topics.get(sub.input.channel);
		topic?.subscriptions.delete(sub);
		if (sub.input.presence)
			this.enqueue(sub.input.channel, {
				kind: "leave",
				id: sub.input.presence.connectionId,
			});
		if (!topic?.subscriptions.size) this.topics.delete(sub.input.channel);
		if (!this.topics.size && this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		await sub.input.onRelease?.();
	}

	private async revoke(sub: Subscription): Promise<void> {
		if (sub.closed) return;
		await this.release(sub);
		try {
			const result = await sub.input.sink.write(
				encodeSseEvent("error", {
					channelSubscriptionId: sub.input.channelSubscriptionId,
					channel: sub.input.channel,
					message: "Channel access ended",
				}),
				"ordered-channel-event",
			);
			if (result.status === "busy")
				await sub.input.sink.close("transport_error");
		} finally {
			if (sub.input.close) await sub.input.close("access_revoked");
			else await sub.input.sink.close("access_revoked");
		}
	}

	private async disconnectAll(): Promise<void> {
		await Promise.all(
			[...this.topics.values()].flatMap((topic) =>
				[...topic.subscriptions].map(async (sub) => {
					// A broker blip ends the physical epoch, not the logical channel.
					// Existing SSE reconnect then re-admits every binding with fresh access.
					try {
						await this.release(sub);
						await sub.input.sink.close("transport_error");
					} catch (error) {
						this.onError(error);
					}
				}),
			),
		);
	}

	async destroy(): Promise<void> {
		this.closing = true;
		if (this.timer) clearInterval(this.timer);
		if (this.flushTimer) clearTimeout(this.flushTimer);
		await this.disconnectAll();
		// A graceful shutdown broadcasts leaves before closing the broker. Crash recovery still uses TTL.
		if (this.starting) await this.starting.catch(() => {});
		await this.flushOperation;
		await this.flush();
		this.stopped = true;
		if (this.flushTimer) clearTimeout(this.flushTimer);
		this.pending.clear();
		await this.broker.stop();
	}
}
