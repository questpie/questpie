import { deserializeCompatibleTypedEventWire } from "#questpie/shared/typed-wire.js";

import type { GetAuthHeaders } from "../auth.js";
import {
	type ManagedPusherSubscription,
	PusherConnectionManager,
	type PusherModule,
	type PusherRealtimeConfig,
} from "../realtime/pusher-connection.js";
import {
	BoundedChannelQueue,
	channelGapError,
	channelSlowConsumerError,
	OrderedChannelCursor,
} from "./ordered-events.js";
import type {
	ChannelClientTransport,
	ChannelConnectionInput,
	ChannelSubscribeOptions,
	ChannelTransportMessage,
} from "./types.js";

type ProviderChannel = {
	bind(event: string, callback: (data: unknown) => void): ProviderChannel;
	unbind(): ProviderChannel;
	members?: {
		each(callback: (member: { info?: unknown }) => void): void;
	};
};

type Entry = {
	input: ChannelConnectionInput;
	channel: ProviderChannel | null;
	subscription: ManagedPusherSubscription | null;
	subscribers: Set<(message: ChannelTransportMessage) => void>;
	presenceSubscribers: Set<(members: readonly unknown[]) => void>;
	errorCallbacks: Set<(error: Error) => void>;
	cursor: OrderedChannelCursor;
	replaying: boolean;
	replayGeneration: number;
	pendingLive: BoundedChannelQueue<ChannelTransportMessage>;
	presence?: readonly unknown[];
	presenceSignature?: string;
	presenceWaiters: Set<{
		resolve: (members: readonly unknown[]) => void;
		reject: (error: Error) => void;
	}>;
};

type AuthResponse = {
	auth: string;
	channel_data?: string;
	shared_secret?: string;
};

function normalizedError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function collectMembers(value: unknown, channel: ProviderChannel): unknown[] {
	const members: unknown[] = [];
	const source =
		value && typeof value === "object" && "each" in value
			? (value as ProviderChannel["members"])
			: channel.members;
	source?.each((member) =>
		members.push(deserializeCompatibleTypedEventWire(member.info ?? member)),
	);
	return members;
}

/** Native ordered framework-channel subscriptions over managed Pusher/Soketi. */
export class PusherChannelTransport implements ChannelClientTransport {
	private readonly entries = new Map<string, Entry>();
	private readonly connection: PusherConnectionManager;
	private destroyed = false;

	constructor(
		private readonly options: {
			baseUrl: string;
			fetcher: typeof fetch;
			getAuthHeaders?: GetAuthHeaders;
			config: PusherRealtimeConfig;
			loadPusher?: () => Promise<PusherModule>;
			connection?: PusherConnectionManager;
		},
	) {
		this.connection =
			options.connection ??
			new PusherConnectionManager({ loadPusher: options.loadPusher });
	}

	subscribe(
		input: ChannelConnectionInput,
		callback: (message: ChannelTransportMessage) => void,
		options: ChannelSubscribeOptions = {},
	): () => void {
		const entry = this.ensureEntry(input);
		entry.subscribers.add(callback);
		if (options.onError) entry.errorCallbacks.add(options.onError);

		let stopped = false;
		const stop = () => {
			if (stopped) return;
			stopped = true;
			options.signal?.removeEventListener("abort", stop);
			const current = this.entries.get(input.resolvedName);
			if (!current) return;
			current.subscribers.delete(callback);
			if (options.onError) current.errorCallbacks.delete(options.onError);
			if (
				current.subscribers.size > 0 ||
				current.presenceSubscribers.size > 0 ||
				current.presenceWaiters.size > 0
			)
				return;
			this.unmount(input.resolvedName, current);
		};
		options.signal?.addEventListener("abort", stop, { once: true });
		if (options.signal?.aborted) stop();
		return stop;
	}

	subscribePresence(
		input: ChannelConnectionInput,
		callback: (members: readonly unknown[]) => void,
		options: ChannelSubscribeOptions = {},
	): () => void {
		if (input.visibility !== "presence") {
			throw new Error("Channel does not expose presence");
		}
		const entry = this.ensureEntry(input);
		entry.presenceSubscribers.add(callback);
		if (options.onError) entry.errorCallbacks.add(options.onError);
		if (entry.presence) callback(entry.presence);

		let stopped = false;
		const stop = () => {
			if (stopped) return;
			stopped = true;
			options.signal?.removeEventListener("abort", stop);
			const current = this.entries.get(input.resolvedName);
			if (!current) return;
			current.presenceSubscribers.delete(callback);
			if (options.onError) current.errorCallbacks.delete(options.onError);
			if (
				current.subscribers.size > 0 ||
				current.presenceSubscribers.size > 0 ||
				current.presenceWaiters.size > 0
			)
				return;
			this.unmount(input.resolvedName, current);
		};
		options.signal?.addEventListener("abort", stop, { once: true });
		if (options.signal?.aborted) stop();
		return stop;
	}

	async presence(
		input: ChannelConnectionInput,
		options: ChannelSubscribeOptions = {},
	): Promise<readonly unknown[]> {
		if (options.signal?.aborted) {
			throw new Error("Channel presence aborted");
		}
		if (input.visibility !== "presence") {
			throw new Error("Channel does not expose presence");
		}
		const stop = this.subscribe(input, () => {}, options);
		const entry = this.entries.get(input.resolvedName)!;
		if (entry.presence) {
			stop();
			return entry.presence;
		}
		return new Promise<readonly unknown[]>((resolve, reject) => {
			const abort = () => waiter.reject(new Error("Channel presence aborted"));
			const waiter = {
				resolve: (members: readonly unknown[]) => {
					options.signal?.removeEventListener("abort", abort);
					stop();
					resolve(members);
				},
				reject: (error: Error) => {
					options.signal?.removeEventListener("abort", abort);
					stop();
					reject(error);
				},
			};
			entry.presenceWaiters.add(waiter);
			options.signal?.addEventListener("abort", abort, { once: true });
		});
	}

	private ensureEntry(input: ChannelConnectionInput): Entry {
		let entry = this.entries.get(input.resolvedName);
		if (entry) return entry;
		entry = {
			input,
			channel: null,
			subscription: null,
			subscribers: new Set(),
			presenceSubscribers: new Set(),
			errorCallbacks: new Set(),
			cursor: new OrderedChannelCursor(),
			replaying: true,
			replayGeneration: 0,
			pendingLive: new BoundedChannelQueue(),
			presenceWaiters: new Set(),
		};
		this.entries.set(input.resolvedName, entry);
		void this.mount(entry);
		return entry;
	}

	private async authorize(
		socketId: string,
		channelName: string,
	): Promise<AuthResponse> {
		const entry = this.entries.get(channelName);
		if (!entry) throw new Error("Unknown framework channel authorization");
		const authHeaders = await this.options.getAuthHeaders?.();
		const response = await this.options.fetcher(
			`${this.options.baseUrl}/channels/auth`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...authHeaders },
				body: JSON.stringify({
					socketId,
					channelName,
					channel: entry.input.registryKey,
					params: entry.input.params,
				}),
				credentials: "include",
			},
		);
		if (!response.ok)
			throw new Error(`Channel auth failed: ${response.status}`);
		const auth = (await response.json()) as Partial<AuthResponse>;
		if (typeof auth.auth !== "string") {
			throw new Error("Invalid channel auth response");
		}
		return {
			auth: auth.auth,
			...(typeof auth.channel_data === "string"
				? { channel_data: auth.channel_data }
				: {}),
			...(typeof auth.shared_secret === "string"
				? { shared_secret: auth.shared_secret }
				: {}),
		};
	}

	private async authenticateUser(
		socketId: string,
	): Promise<{ auth: string; user_data: string }> {
		const authHeaders = await this.options.getAuthHeaders?.();
		const path = this.options.config.authEndpoint ?? "realtime/auth";
		const authEndpoint = /^https?:\/\//.test(path)
			? path
			: `${this.options.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
		const response = await this.options.fetcher(authEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				...authHeaders,
			},
			body: new URLSearchParams({ socket_id: socketId }),
			credentials: "include",
		});
		if (!response.ok) {
			throw new Error(`Realtime user auth failed: ${response.status}`);
		}
		const auth = (await response.json()) as {
			auth?: unknown;
			user_data?: unknown;
		};
		if (typeof auth.auth !== "string" || typeof auth.user_data !== "string") {
			throw new Error("Invalid realtime user auth response");
		}
		return { auth: auth.auth, user_data: auth.user_data };
	}

	private async mount(entry: Entry): Promise<void> {
		try {
			const subscription = await this.connection.subscribe({
				config: this.options.config,
				channelName: entry.input.resolvedName,
				lane: "channel",
				authorize: (socketId, channelName) =>
					this.authorize(socketId, channelName),
				...(this.options.config.userAuthentication === true
					? {
							authenticateUser: (socketId: string) =>
								this.authenticateUser(socketId),
						}
					: {}),
			});
			if (
				this.destroyed ||
				this.entries.get(entry.input.resolvedName) !== entry
			) {
				subscription.release();
				return;
			}
			const channel = subscription.channel as ProviderChannel;
			entry.subscription = subscription;
			entry.channel = channel;
			channel.bind("questpie:channel", (payload) =>
				this.handleMessage(entry, payload),
			);
			channel.bind("pusher:subscription_error", (error) =>
				this.notify(entry, normalizedError(error)),
			);
			channel.bind("pusher:subscription_succeeded", (members) => {
				try {
					if (entry.input.visibility === "presence") {
						this.setPresence(entry, collectMembers(members, channel));
					}
					void this.recover(entry);
				} catch (error) {
					this.failEntry(entry, normalizedError(error));
				}
			});
			const refreshPresence = () => {
				try {
					if (entry.input.visibility === "presence") {
						this.setPresence(entry, collectMembers(undefined, channel));
					}
				} catch (error) {
					this.failEntry(entry, normalizedError(error));
				}
			};
			channel.bind("pusher:member_added", refreshPresence);
			channel.bind("pusher:member_removed", refreshPresence);
		} catch (error) {
			this.failEntry(entry, normalizedError(error));
		}
	}

	private handleMessage(entry: Entry, payload: unknown): void {
		try {
			const envelope = deserializeCompatibleTypedEventWire<{
				eventId?: unknown;
				event?: unknown;
				data?: unknown;
			}>(payload);
			if (!envelope || typeof envelope !== "object") {
				throw new Error("Invalid channel provider payload");
			}
			if (
				typeof envelope.eventId !== "string" ||
				typeof envelope.event !== "string"
			) {
				throw new Error("Invalid channel provider payload");
			}
			const message = {
				event: envelope.event,
				eventId: envelope.eventId,
				data: envelope.data,
			};
			if (entry.replaying) {
				if (!entry.pendingLive.push(message)) {
					this.failEntry(entry, channelSlowConsumerError());
				}
				return;
			}
			this.deliver(entry, message);
		} catch (error) {
			this.failEntry(entry, normalizedError(error));
		}
	}

	private async recover(entry: Entry): Promise<void> {
		if (this.entries.get(entry.input.resolvedName) !== entry) return;
		const generation = ++entry.replayGeneration;
		entry.replaying = true;
		try {
			while (entry.cursor.eventId) {
				const authHeaders = await this.options.getAuthHeaders?.();
				const response = await this.options.fetcher(
					`${this.options.baseUrl}/channels/replay`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json", ...authHeaders },
						body: JSON.stringify({
							channel: entry.input.registryKey,
							params: entry.input.params,
							afterEventId: entry.cursor.eventId,
						}),
						credentials: "include",
					},
				);
				if (!response.ok) {
					throw new Error(`Channel replay failed: ${response.status}`);
				}
				const page = (await response.json()) as {
					status?: unknown;
					events?: unknown;
					hasMore?: unknown;
				};
				if (page.status === "gap") throw channelGapError();
				if (page.status !== "events" || !Array.isArray(page.events)) {
					throw new Error("Invalid channel replay response");
				}
				if (!this.isReplayCurrent(entry, generation)) return;
				const previousEventId = entry.cursor.eventId;
				for (const replayed of page.events) {
					if (!this.isReplayCurrent(entry, generation)) return;
					this.deliver(entry, this.parseReplayMessage(replayed));
					if (!this.isReplayCurrent(entry, generation)) return;
				}
				if (page.hasMore !== true) break;
				if (entry.cursor.eventId === previousEventId) {
					throw new Error("Channel replay cursor did not advance");
				}
			}
			if (
				generation !== entry.replayGeneration ||
				this.entries.get(entry.input.resolvedName) !== entry
			) {
				return;
			}
			entry.replaying = false;
			while (entry.pendingLive.length > 0) {
				if (!this.isReplayCurrent(entry, generation)) return;
				this.deliver(entry, entry.pendingLive.shift()!);
				if (!this.isReplayCurrent(entry, generation)) return;
			}
		} catch (error) {
			if (generation !== entry.replayGeneration) return;
			this.failEntry(entry, normalizedError(error));
		}
	}

	private isReplayCurrent(entry: Entry, generation: number): boolean {
		return (
			!this.destroyed &&
			entry.replayGeneration === generation &&
			this.entries.get(entry.input.resolvedName) === entry
		);
	}

	private parseReplayMessage(value: unknown): ChannelTransportMessage {
		const message = deserializeCompatibleTypedEventWire<{
			eventId?: unknown;
			event?: unknown;
			data?: unknown;
		}>(value);
		if (!message || typeof message !== "object") {
			throw new Error("Invalid channel replay response");
		}
		if (
			typeof message.eventId !== "string" ||
			typeof message.event !== "string"
		) {
			throw new Error("Invalid channel replay response");
		}
		return {
			eventId: message.eventId,
			event: message.event,
			data: message.data,
		};
	}

	private deliver(entry: Entry, message: ChannelTransportMessage): void {
		const decision = entry.cursor.accept(message);
		if (decision.status === "duplicate") return;
		if (decision.status === "gap") {
			this.failEntry(entry, channelGapError());
			return;
		}
		for (const callback of entry.subscribers) callback(message);
	}

	private failEntry(entry: Entry, error: Error): void {
		if (this.entries.get(entry.input.resolvedName) !== entry) return;
		this.notify(entry, error);
		this.unmount(entry.input.resolvedName, entry);
	}

	private setPresence(entry: Entry, members: readonly unknown[]): void {
		const signature = JSON.stringify(members);
		if (entry.presenceSignature === signature) return;
		entry.presence = members;
		entry.presenceSignature = signature;
		for (const callback of entry.presenceSubscribers) callback(members);
		const waiters = [...entry.presenceWaiters];
		entry.presenceWaiters.clear();
		for (const waiter of waiters) waiter.resolve(members);
	}

	private notify(entry: Entry, error: Error): void {
		for (const callback of entry.errorCallbacks) callback(error);
		const waiters = [...entry.presenceWaiters];
		entry.presenceWaiters.clear();
		for (const waiter of waiters) waiter.reject(error);
	}

	private unmount(name: string, entry: Entry): void {
		entry.replayGeneration += 1;
		entry.replaying = false;
		entry.pendingLive.clear();
		entry.subscription?.release();
		entry.subscription = null;
		entry.channel = null;
		entry.subscribers.clear();
		entry.presenceSubscribers.clear();
		entry.errorCallbacks.clear();
		entry.presenceWaiters.clear();
		if (this.entries.get(name) === entry) this.entries.delete(name);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		for (const entry of this.entries.values()) {
			this.notify(entry, new Error("Channel transport destroyed"));
			this.unmount(entry.input.resolvedName, entry);
		}
	}

	get channelCount(): number {
		return this.entries.size;
	}

	get subscriberCount(): number {
		let count = 0;
		for (const entry of this.entries.values()) {
			count += entry.subscribers.size + entry.presenceSubscribers.size;
		}
		return count;
	}
}
