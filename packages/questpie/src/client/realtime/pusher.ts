import type { GetAuthHeaders } from "../auth.js";
import { realtimeTopicId, type TopicConfig } from "./multiplexer.js";
import type { RealtimeStreamEvent } from "./stream.js";
import type {
	RealtimeClientTransport,
	RealtimeErrorCallback,
	RealtimeSubscriber,
} from "./transport.js";

export type PusherRealtimeConfig = {
	provider: "pusher";
	key: string;
	cluster?: string;
	wsHost?: string;
	wsPort?: number;
	wssPort?: number;
	forceTLS?: boolean;
	authEndpoint?: string;
};

export type PusherModule = typeof import("pusher-js");

type TopicEntry = {
	topic: TopicConfig;
	subscribers: Set<RealtimeSubscriber>;
	errorCallbacks: Set<RealtimeErrorCallback>;
	registered: boolean;
	lastSnapshot?: RealtimeStreamEvent;
	seq: number;
};

type SessionResponse = {
	transport: "shared-provider";
	sessionId: string;
	token: string;
	channel: string;
	control: {
		protocol: "questpie-realtime-topology";
		versions: number[];
	};
	errors?: Array<{ id: string; message: string }>;
};

function errorFrom(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

function endpoint(baseUrl: string, path: string): string {
	if (/^https?:\/\//.test(path)) return path;
	return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function topicPayload(topicId: string, topic: TopicConfig) {
	return {
		...topic,
		...(topic.resourceType === "collection" && topic.operation === "get"
			? { recordId: topic.id }
			: {}),
		id: topicId,
	};
}

/** Lazy managed-Pusher driver. Provider frames are private refetch hints only. */
export class PusherRealtimeTransport implements RealtimeClientTransport {
	private readonly topics = new Map<string, TopicEntry>();
	private session: SessionResponse | null = null;
	private pusher: InstanceType<PusherModule["default"]> | null = null;
	private channel: ReturnType<
		InstanceType<PusherModule["default"]>["subscribe"]
	> | null = null;
	private sessionPromise: Promise<void> | null = null;
	private controlOperation: Promise<void> = Promise.resolve();
	private desiredRevision = 0;
	private desiredFlushPromise: Promise<void> | null = null;
	private desiredTopologyGeneration = 0;
	private desiredFlushedGeneration = 0;
	private refreshPromise: Promise<void> | null = null;
	private refreshPending = false;
	private destroyed = false;

	constructor(
		private readonly options: {
			baseUrl: string;
			fetcher: typeof fetch;
			getAuthHeaders?: GetAuthHeaders;
			config: PusherRealtimeConfig;
			refetchTopic: (topic: TopicConfig) => Promise<unknown>;
			loadPusher?: () => Promise<PusherModule>;
		},
	) {}

	subscribe(
		topic: TopicConfig,
		callback: RealtimeSubscriber,
		signal?: AbortSignal,
		customId?: string,
		onError?: RealtimeErrorCallback,
	): () => void {
		const topicId = customId ?? realtimeTopicId(topic);
		let entry = this.topics.get(topicId);
		if (!entry) {
			entry = {
				topic,
				subscribers: new Set(),
				errorCallbacks: new Set(),
				registered: false,
				seq: 0,
			};
			this.topics.set(topicId, entry);
		} else if (entry.lastSnapshot !== undefined) {
			const replay = entry.lastSnapshot;
			queueMicrotask(() => callback(replay));
		}
		entry.subscribers.add(callback);
		if (onError) entry.errorCallbacks.add(onError);
		if (!entry.registered && entry.subscribers.size === 1) {
			void this.mountTopic(topicId, entry);
		}

		let stopped = false;
		const stop = () => {
			if (stopped) return;
			stopped = true;
			signal?.removeEventListener("abort", stop);
			const current = this.topics.get(topicId);
			if (!current) return;
			current.subscribers.delete(callback);
			if (onError) current.errorCallbacks.delete(onError);
			if (current.subscribers.size > 0) return;
			this.topics.delete(topicId);
			if (this.session) {
				const closeAfterFlush = this.topics.size === 0;
				void this.sendDesiredTopology().finally(() => {
					if (closeAfterFlush && this.topics.size === 0) this.disconnect();
				});
			} else if (this.topics.size === 0 && !this.sessionPromise) {
				this.disconnect();
			}
		};
		signal?.addEventListener("abort", stop, { once: true });
		return stop;
	}

	private async mountTopic(topicId: string, entry: TopicEntry): Promise<void> {
		try {
			await this.ensureSession();
			if (this.destroyed || this.topics.get(topicId) !== entry) return;
			if (!entry.registered) {
				await this.sendDesiredTopology();
				if (this.destroyed || this.topics.get(topicId) !== entry) return;
				entry.registered = true;
			}
			await this.refetchEntry(topicId, entry);
		} catch (error) {
			this.notifyError(entry, errorFrom(error));
		}
	}

	private async ensureSession(): Promise<void> {
		if (this.session || this.destroyed) return;
		if (this.sessionPromise) return this.sessionPromise;
		this.sessionPromise = this.openSession().finally(() => {
			this.sessionPromise = null;
		});
		return this.sessionPromise;
	}

	private async openSession(): Promise<void> {
		const initial = [...this.topics.entries()];
		if (initial.length === 0 || this.destroyed) return;
		const authHeaders = await this.options.getAuthHeaders?.();
		const response = await this.options.fetcher(
			`${this.options.baseUrl}/realtime`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...authHeaders },
				body: JSON.stringify({
					transport: "shared-provider",
					topics: initial.map(([topicId, entry]) =>
						topicPayload(topicId, entry.topic),
					),
				}),
				credentials: "include",
			},
		);
		if (!response.ok) {
			throw new Error(`Realtime session failed: ${response.status}`);
		}
		const session = (await response.json()) as SessionResponse;
		if (
			session.transport !== "shared-provider" ||
			!session.sessionId ||
			!session.token ||
			!session.channel ||
			session.control?.protocol !== "questpie-realtime-topology" ||
			!session.control.versions.includes(1)
		) {
			throw new Error("Invalid shared-provider realtime session");
		}
		this.session = session;
		if (this.destroyed) {
			await this.sendDesiredTopology().catch(() => {});
			this.disconnect();
			return;
		}
		for (const [topicId, entry] of initial) {
			if (this.topics.get(topicId) === entry) entry.registered = true;
		}
		for (const error of session.errors ?? []) {
			const entry = this.topics.get(error.id);
			if (entry) this.notifyError(entry, new Error(error.message));
		}

		const module = await (this.options.loadPusher?.() ?? import("pusher-js"));
		if (this.destroyed) return;
		const config = this.options.config;
		const authEndpoint = endpoint(
			this.options.baseUrl,
			config.authEndpoint ?? "realtime/auth",
		);
		this.pusher = new module.default(config.key, {
			cluster: config.cluster ?? "mt1",
			...(config.wsHost ? { wsHost: config.wsHost } : {}),
			...(config.wsPort ? { wsPort: config.wsPort } : {}),
			...(config.wssPort ? { wssPort: config.wssPort } : {}),
			forceTLS: config.forceTLS ?? true,
			channelAuthorization: {
				customHandler: (input, callback) => {
					void this.authorize(authEndpoint, input.socketId, input.channelName)
						.then((auth) => callback(null, auth))
						.catch((error) => callback(errorFrom(error), null));
				},
			},
		});
		this.channel = this.pusher.subscribe(session.channel);
		this.channel.bind("questpie:invalidate", () => this.scheduleRefresh());
		this.channel.bind("pusher:subscription_succeeded", () =>
			this.scheduleRefresh(),
		);
		this.channel.bind("pusher:subscription_error", (error: unknown) => {
			this.notifyAll(errorFrom(error));
		});

		const added = [...this.topics.entries()]
			.filter(([, entry]) => !entry.registered)
			.map(([topicId]) => topicId);
		const removed = initial.some(
			([topicId, entry]) => this.topics.get(topicId) !== entry,
		);
		if (removed || added.length) await this.sendDesiredTopology();
		if (this.topics.size === 0) {
			this.disconnect();
			return;
		}
		for (const topicId of added) {
			const entry = this.topics.get(topicId);
			if (entry) entry.registered = true;
		}
	}

	private async authorize(
		authEndpoint: string,
		socketId: string,
		channelName: string,
	): Promise<{
		auth: string;
		channel_data?: string;
		shared_secret?: string;
	}> {
		const authHeaders = await this.options.getAuthHeaders?.();
		const response = await this.options.fetcher(authEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				...authHeaders,
			},
			body: new URLSearchParams({
				socket_id: socketId,
				channel_name: channelName,
			}),
			credentials: "include",
		});
		if (!response.ok)
			throw new Error(`Realtime auth failed: ${response.status}`);
		const auth = (await response.json()) as {
			auth?: unknown;
			channel_data?: unknown;
			shared_secret?: unknown;
		};
		if (typeof auth.auth !== "string") {
			throw new Error("Invalid realtime auth response");
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

	private sendDesiredTopology(): Promise<void> {
		this.desiredTopologyGeneration += 1;
		if (this.desiredFlushPromise) return this.desiredFlushPromise;
		this.desiredFlushPromise = (async () => {
			await Promise.resolve();
			while (this.desiredFlushedGeneration < this.desiredTopologyGeneration) {
				const generation = this.desiredTopologyGeneration;
				const session = this.session;
				if (!session) return;
				const topology = {
					protocol: "questpie-realtime-topology",
					version: 1,
					revision: ++this.desiredRevision,
					topics: [...this.topics.entries()].map(([id, entry]) => ({
						id,
						topic: entry.topic,
					})),
					channels: [],
				};
				const operation = this.controlOperation
					.catch(() => {})
					.then(async () => {
						const authHeaders = await this.options.getAuthHeaders?.();
						const response = await this.options.fetcher(
							`${this.options.baseUrl}/realtime`,
							{
								method: "POST",
								headers: {
									"Content-Type": "application/json",
									...authHeaders,
								},
								body: JSON.stringify({
									sessionId: session.sessionId,
									token: session.token,
									topology,
								}),
								credentials: "include",
							},
						);
						if (!response.ok) {
							throw new Error(`Realtime control failed: ${response.status}`);
						}
					});
				this.controlOperation = operation;
				await operation;
				if (this.session !== session) return;
				this.desiredFlushedGeneration = generation;
			}
		})().finally(() => {
			this.desiredFlushPromise = null;
		});
		return this.desiredFlushPromise;
	}

	private scheduleRefresh(): void {
		if (this.refreshPromise) {
			this.refreshPending = true;
			return;
		}
		this.refreshPromise = (async () => {
			do {
				this.refreshPending = false;
				await Promise.all(
					[...this.topics.entries()].map(([topicId, entry]) =>
						this.refetchEntry(topicId, entry),
					),
				);
			} while (this.refreshPending && !this.destroyed);
		})().finally(() => {
			this.refreshPromise = null;
		});
	}

	private async refetchEntry(
		topicId: string,
		entry: TopicEntry,
	): Promise<void> {
		try {
			const snapshot = await this.options.refetchTopic(entry.topic);
			if (this.destroyed) return;
			entry.lastSnapshot = {
				type: "snapshot",
				topicId,
				seq: ++entry.seq,
				data: snapshot,
			};
			for (const subscriber of entry.subscribers) {
				subscriber(entry.lastSnapshot);
			}
		} catch (error) {
			this.notifyError(entry, errorFrom(error));
		}
	}

	private notifyError(entry: TopicEntry, error: Error): void {
		for (const callback of entry.errorCallbacks) callback(error);
	}

	private notifyAll(error: Error): void {
		for (const entry of this.topics.values()) this.notifyError(entry, error);
	}

	private disconnect(): void {
		if (this.channel && this.session) {
			this.channel.unbind();
			this.pusher?.unsubscribe(this.session.channel);
		}
		this.pusher?.disconnect();
		this.pusher = null;
		this.channel = null;
		this.session = null;
		this.desiredRevision = 0;
		this.desiredTopologyGeneration = 0;
		this.desiredFlushedGeneration = 0;
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.topics.clear();
		if (this.session) {
			void this.sendDesiredTopology()
				.catch(() => {})
				.finally(() => this.disconnect());
		} else {
			this.disconnect();
		}
	}

	get topicCount(): number {
		return this.topics.size;
	}

	get subscriberCount(): number {
		let count = 0;
		for (const entry of this.topics.values()) count += entry.subscribers.size;
		return count;
	}
}
