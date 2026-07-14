import type { GetAuthHeaders } from "../auth.js";
import type { PusherModule, PusherRealtimeConfig } from "../realtime/pusher.js";
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
	subscribers: Set<(message: ChannelTransportMessage) => void>;
	errorCallbacks: Set<(error: Error) => void>;
	presence?: readonly unknown[];
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
	source?.each((member) => members.push(member.info ?? member));
	return members;
}

/** Native ordered framework-channel subscriptions over managed Pusher/Soketi. */
export class PusherChannelTransport implements ChannelClientTransport {
	private readonly entries = new Map<string, Entry>();
	private pusher: InstanceType<PusherModule["default"]> | null = null;
	private pusherPromise: Promise<InstanceType<PusherModule["default"]>> | null =
		null;
	private destroyed = false;

	constructor(
		private readonly options: {
			baseUrl: string;
			fetcher: typeof fetch;
			getAuthHeaders?: GetAuthHeaders;
			config: PusherRealtimeConfig;
			loadPusher?: () => Promise<PusherModule>;
		},
	) {}

	subscribe(
		input: ChannelConnectionInput,
		callback: (message: ChannelTransportMessage) => void,
		options: ChannelSubscribeOptions = {},
	): () => void {
		let entry = this.entries.get(input.resolvedName);
		if (!entry) {
			entry = {
				input,
				channel: null,
				subscribers: new Set(),
				errorCallbacks: new Set(),
				presenceWaiters: new Set(),
			};
			this.entries.set(input.resolvedName, entry);
			void this.mount(entry);
		}
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
			if (current.subscribers.size > 0 || current.presenceWaiters.size > 0)
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

	private async getPusher(): Promise<InstanceType<PusherModule["default"]>> {
		if (this.pusher) return this.pusher;
		if (!this.pusherPromise) {
			this.pusherPromise = (async () => {
				const module = await (this.options.loadPusher?.() ??
					import("pusher-js"));
				if (this.destroyed) throw new Error("Channel transport is destroyed");
				const config = this.options.config;
				const pusher = new module.default(config.key, {
					cluster: config.cluster ?? "mt1",
					...(config.wsHost ? { wsHost: config.wsHost } : {}),
					...(config.wsPort ? { wsPort: config.wsPort } : {}),
					...(config.wssPort ? { wssPort: config.wssPort } : {}),
					forceTLS: config.forceTLS ?? true,
					channelAuthorization: {
						customHandler: (request, callback) => {
							void this.authorize(request.socketId, request.channelName)
								.then((auth) => callback(null, auth))
								.catch((error) => callback(normalizedError(error), null));
						},
					},
				});
				this.pusher = pusher;
				return pusher;
			})().catch((error) => {
				this.pusherPromise = null;
				throw error;
			});
		}
		return this.pusherPromise;
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

	private async mount(entry: Entry): Promise<void> {
		try {
			const pusher = await this.getPusher();
			if (
				this.destroyed ||
				this.entries.get(entry.input.resolvedName) !== entry
			) {
				if (this.entries.size === 0) {
					pusher.disconnect();
					this.pusher = null;
					this.pusherPromise = null;
				}
				return;
			}
			const channel = pusher.subscribe(
				entry.input.resolvedName,
			) as ProviderChannel;
			entry.channel = channel;
			channel.bind("questpie:channel", (payload) =>
				this.handleMessage(entry, payload),
			);
			channel.bind("pusher:subscription_error", (error) =>
				this.notify(entry, normalizedError(error)),
			);
			channel.bind("pusher:subscription_succeeded", (members) => {
				if (entry.input.visibility !== "presence") return;
				this.setPresence(entry, collectMembers(members, channel));
			});
			const refreshPresence = () => {
				if (entry.input.visibility === "presence") {
					this.setPresence(entry, collectMembers(undefined, channel));
				}
			};
			channel.bind("pusher:member_added", refreshPresence);
			channel.bind("pusher:member_removed", refreshPresence);
		} catch (error) {
			this.notify(entry, normalizedError(error));
		}
	}

	private handleMessage(entry: Entry, payload: unknown): void {
		try {
			if (!payload || typeof payload !== "object") {
				throw new Error("Invalid channel provider payload");
			}
			const envelope = payload as { eventId?: unknown; data?: unknown };
			const decoded =
				typeof envelope.data === "string"
					? (JSON.parse(envelope.data) as { event?: unknown; data?: unknown })
					: (envelope.data as { event?: unknown; data?: unknown });
			if (
				typeof envelope.eventId !== "string" ||
				!decoded ||
				typeof decoded.event !== "string"
			) {
				throw new Error("Invalid channel provider payload");
			}
			for (const callback of entry.subscribers) {
				callback({
					event: decoded.event,
					eventId: envelope.eventId,
					data: decoded.data,
				});
			}
		} catch (error) {
			this.notify(entry, normalizedError(error));
		}
	}

	private setPresence(entry: Entry, members: readonly unknown[]): void {
		entry.presence = members;
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
		entry.channel?.unbind();
		this.pusher?.unsubscribe(name);
		this.entries.delete(name);
		if (this.entries.size === 0) {
			this.pusher?.disconnect();
			this.pusher = null;
			this.pusherPromise = null;
		}
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		for (const entry of this.entries.values()) {
			entry.channel?.unbind();
			this.notify(entry, new Error("Channel transport destroyed"));
		}
		this.entries.clear();
		this.pusher?.disconnect();
		this.pusher = null;
		this.pusherPromise = null;
	}

	get channelCount(): number {
		return this.entries.size;
	}

	get subscriberCount(): number {
		let count = 0;
		for (const entry of this.entries.values()) count += entry.subscribers.size;
		return count;
	}
}
