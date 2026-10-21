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
import { ChannelSecurityError } from "./security.js";

export const EPHEMERAL_MAX_PACKET_BYTES = 7900;
const MAX_TOPICS = 100;
const MAX_KEYS = 100;
const MAX_MEMBERS = 100;

export type EphemeralConfig = {
	broker?: EphemeralBroker;
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
type SubscriptionInput = Omit<LocalChannelSubscriptionInput, "stage"> & {
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
	members: Map<string, { entry: MemberEntry; expires: number }>;
};
type Pending = {
	entries: Map<string, Entry>;
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
	private starting?: Promise<void>;
	private timer?: ReturnType<typeof setInterval>;
	private stopped = false;
	private flushing = false;
	private flushTimer?: ReturnType<typeof setTimeout>;
	private flushDue = Infinity;
	private readonly epoch = Date.now();
	private readonly heartbeatMs: number;
	private readonly leaseMs: number;
	private readonly authorizationIntervalMs: number;

	constructor(
		config: EphemeralConfig = {},
		private readonly onError: (error: unknown) => void = () => {},
	) {
		this.broker = config.broker ?? new InProcessEphemeralBroker();
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
		if (this.stopped) throw new Error("Ephemeral runtime is closed");
		this.starting ??= this.broker
			.start(
				(message) => {
					try {
						this.receive(parseTypedWire<Packet>(message));
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
			});
		await this.starting;
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
		if (
			bytes(stringifyTypedWire({ channel: input.channel, entries: [entry] })) >
			EPHEMERAL_MAX_PACKET_BYTES
		) {
			throw new ChannelSecurityError(
				"channel_payload_too_large",
				"Ephemeral envelope exceeds limit",
			);
		}
		await this.start();
		this.enqueue(input.channel, entry, options.coalesceMs);
		return { eventId };
	}

	private enqueue(channel: string, entry: Entry, coalesceMs = 100): void {
		if (this.stopped) return;
		let pending = this.pending.get(channel);
		if (!pending) {
			if (this.pending.size >= MAX_TOPICS) return;
			pending = {
				entries: new Map(),
				due:
					this.epoch +
					(Math.floor((Date.now() - this.epoch) / coalesceMs) + 1) * coalesceMs,
			};
			this.pending.set(channel, pending);
		}
		const key = entryKey(entry);
		if (pending.entries.size >= MAX_KEYS && !pending.entries.has(key)) {
			// Drop the oldest pending signal under overload, retaining the newest state.
			pending.entries.delete(pending.entries.keys().next().value!);
		}
		pending.entries.set(key, entry);
		this.scheduleFlush(pending.due);
	}

	private scheduleFlush(due?: number): void {
		if (this.flushing || this.stopped || !this.pending.size) return;
		due ??= Math.min(...[...this.pending.values()].map((batch) => batch.due));
		if (this.flushTimer && this.flushDue <= due) return;
		if (this.flushTimer) clearTimeout(this.flushTimer);
		this.flushDue = due;
		this.flushTimer = setTimeout(
			() => {
				this.flushTimer = undefined;
				this.flushDue = Infinity;
				void this.flush();
			},
			Math.max(1, due - Date.now()),
		);
		this.flushTimer.unref?.();
	}

	private async flush(): Promise<void> {
		if (this.flushing || this.stopped) return;
		this.flushing = true;
		// Snapshot once: concurrent ingress stays bounded in the next coalescing window.
		const pending = [...this.pending].filter(
			([, batch]) => batch.due <= Date.now(),
		);
		for (const [channel] of pending) this.pending.delete(channel);
		try {
			const packets: string[] = [];
			for (const [channel, batch] of pending) {
				let entries: Entry[] = [];
				for (const entry of batch.entries.values()) {
					const candidate = [...entries, entry];
					if (
						entries.length &&
						bytes(stringifyTypedWire({ channel, entries: candidate })) >
							EPHEMERAL_MAX_PACKET_BYTES
					) {
						packets.push(stringifyTypedWire({ channel, entries }));
						entries = [];
					}
					entries.push(entry);
				}
				if (entries.length)
					packets.push(stringifyTypedWire({ channel, entries }));
			}
			if (packets.length) await this.broker.publish(packets);
		} catch (error) {
			this.onError(error);
			await this.disconnectAll();
		} finally {
			this.flushing = false;
			this.scheduleFlush();
		}
	}

	async subscribe(input: SubscriptionInput): Promise<() => Promise<void>> {
		if (input.presence && bytes(stringifyTypedWire(input.presence.data)) > 1024)
			throw new Error("Ephemeral presence exceeds 1024 bytes");
		await this.start();
		let topic = this.topics.get(input.channel);
		if (!topic) {
			if (this.topics.size >= MAX_TOPICS)
				throw new Error("Too many ephemeral topics");
			topic = { subscriptions: new Set(), members: new Map() };
			this.topics.set(input.channel, topic);
		}
		if (topic.subscriptions.size >= MAX_MEMBERS)
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
			this.timer ??= setInterval(
				() => this.tick(),
				Math.min(this.authorizationIntervalMs, this.heartbeatMs),
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
				new Promise<false>((resolve) => {
					timeout = setTimeout(() => resolve(false), 5000);
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
		} catch {
			return false;
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	private renew(subscription: Subscription): void {
		const presence = subscription.input.presence;
		if (!presence || Date.now() - subscription.lastHeartbeat < this.heartbeatMs)
			return;
		subscription.lastHeartbeat = Date.now();
		this.enqueue(presence.channel, {
			kind: "member",
			id: presence.connectionId,
			principal: presence.principalId,
			data: presence.data,
		});
	}

	private receive(packet: Packet): void {
		const topic = this.topics.get(packet.channel);
		if (!topic || this.stopped) return;
		for (const entry of packet.entries) {
			if (entry.kind === "event") {
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
				if (entry.kind === "leave") topic.members.delete(entry.id);
				else if (
					topic.members.size < MAX_MEMBERS ||
					topic.members.has(entry.id)
				) {
					topic.members.set(entry.id, {
						entry,
						expires: Date.now() + this.leaseMs,
					});
				}
				for (const sub of topic.subscriptions) sub.presenceDirty = true;
			}
		}
		for (const sub of topic.subscriptions) this.schedule(sub);
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
				await sub.input.sink.write(
					encodeSseEvent("channel_ephemeral", {
						channel: sub.input.channel,
						event: entry.event,
						eventId: entry.eventId,
						data: entry.data,
					}),
					"latest-snapshot",
				);
			}
			if (sub.presenceDirty && sub.input.presence && !sub.closed) {
				sub.presenceDirty = false;
				const members = new Map<string, Record<string, unknown>>();
				for (const { entry } of this.topics
					.get(sub.input.channel)
					?.members.values() ?? [])
					members.set(entry.principal, entry.data);
				const snapshot = [...members]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([, data]) => data);
				const signature = stringifyTypedWire(snapshot);
				if (signature !== sub.lastPresence) {
					const result = await sub.input.sink.write(
						encodeSseEvent("channel_presence", {
							channel: sub.input.channel,
							members: snapshot,
						}),
						"latest-snapshot",
					);
					if (result.status === "accepted") sub.lastPresence = signature;
					else sub.presenceDirty = true;
				}
			}
		} catch (error) {
			this.onError(error);
			await this.revoke(sub);
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
			await sub.input.sink.write(
				encodeSseEvent("error", {
					channel: sub.input.channel,
					message: "Channel access ended",
				}),
				"latest-snapshot",
			);
		} finally {
			if (sub.input.close) await sub.input.close("access_revoked");
			else await sub.input.sink.close("access_revoked");
		}
	}

	private async disconnectAll(): Promise<void> {
		await Promise.all(
			[...this.topics.values()].flatMap((topic) =>
				[...topic.subscriptions].map((sub) =>
					this.revoke(sub).catch(this.onError),
				),
			),
		);
	}

	async destroy(): Promise<void> {
		this.stopped = true;
		if (this.timer) clearInterval(this.timer);
		if (this.flushTimer) clearTimeout(this.flushTimer);
		this.pending.clear();
		await this.disconnectAll();
		if (this.starting) await this.starting.catch(() => {});
		await this.broker.stop();
	}
}
