import type { GetAuthHeaders } from "../auth.js";
import { RealtimeCrdtBindingRejectedError } from "./crdt-error.js";
import { realtimeTopicId, type TopicConfig } from "./multiplexer.js";
import {
	type ManagedPusherSubscription,
	PusherConnectionManager,
	type PusherModule,
	type PusherRealtimeConfig,
} from "./pusher-connection.js";
import {
	type CrdtRealtimeEdgeCapability,
	type CrdtRealtimeRegistrationInput,
} from "./session.js";
import type { RealtimeStreamEvent } from "./stream.js";
import type {
	RealtimeClientTransport,
	RealtimeErrorCallback,
	RealtimeSubscriber,
} from "./transport.js";

export type {
	PusherModule,
	PusherRealtimeConfig,
} from "./pusher-connection.js";

type TopicEntry = {
	topic: TopicConfig;
	subscribers: Set<RealtimeSubscriber>;
	errorCallbacks: Set<RealtimeErrorCallback>;
	registered: boolean;
	lastSnapshot?: RealtimeStreamEvent;
	seq: number;
};

type CrdtEntry = {
	bindingId: string;
	onDirty(): void;
	onError(error: Error): void;
	dirtyScheduled: boolean;
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

type PusherInvalidationTarget = Readonly<{
	kind: "query" | "crdt";
	id: string;
}>;

const MAX_PUSHER_INVALIDATION_TARGETS = 128;

function errorFrom(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

class DispatchedPusherControlError extends Error {
	constructor(
		status: number,
		readonly rejections: readonly RealtimeCrdtBindingRejectedError[],
	) {
		super(`Realtime control failed: ${status}`);
		this.name = "DispatchedPusherControlError";
	}

	forEntry(id: string): RealtimeCrdtBindingRejectedError | undefined {
		return this.rejections.find((error) => error.topologyEntryId === id);
	}
}

class PusherControlSessionUnavailableError extends Error {
	constructor(message = "Realtime control session is unavailable") {
		super(message);
		this.name = "PusherControlSessionUnavailableError";
	}
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
	private readonly crdt = new Map<string, CrdtEntry>();
	private session: SessionResponse | null = null;
	private sessionCrdtHold = false;
	private readonly connection: PusherConnectionManager;
	private subscription: ManagedPusherSubscription | null = null;
	private sessionPromise: Promise<void> | null = null;
	private controlOperation: Promise<void> = Promise.resolve();
	private desiredRevision = 0;
	private desiredFlushPromise: Promise<void> | null = null;
	private desiredTopologyGeneration = 0;
	private desiredFlushedGeneration = 0;
	private refreshPromise: Promise<void> | null = null;
	private refreshAllPending = false;
	private readonly refreshTargetIds = new Set<string>();
	private edgeProbeTimer: ReturnType<typeof setTimeout> | null = null;
	private edgeRecoveryPromise: Promise<void> | null = null;
	private destroyed = false;
	private holdCount = 0;

	constructor(
		private readonly options: {
			baseUrl: string;
			fetcher: typeof fetch;
			getAuthHeaders?: GetAuthHeaders;
			config: PusherRealtimeConfig;
			refetchTopic: (topic: TopicConfig) => Promise<unknown>;
			loadPusher?: () => Promise<PusherModule>;
			connection?: PusherConnectionManager;
			edgeProbeIntervalMs?: number;
		},
	) {
		this.connection =
			options.connection ??
			new PusherConnectionManager({ loadPusher: options.loadPusher });
	}

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
				const closeAfterFlush = !this.hasDemand();
				void this.sendDesiredTopology().finally(() => {
					if (closeAfterFlush && !this.hasDemand()) this.disconnect();
				});
			} else if (!this.hasDemand() && !this.sessionPromise) {
				this.disconnect();
			}
		};
		signal?.addEventListener("abort", stop, { once: true });
		return stop;
	}

	async acquire(signal?: AbortSignal): Promise<CrdtRealtimeEdgeCapability> {
		if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
		this.holdCount += 1;
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			this.holdCount -= 1;
			this.closeIfIdle();
		};
		try {
			await this.ensureCrdtSession();
			if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
			const session = this.session;
			if (!session) throw new Error("Realtime edge session is unavailable");
			return {
				sessionId: session.sessionId,
				token: session.token,
				register: async (input) => {
					if (released) {
						throw new Error("Realtime edge capability was released");
					}
					if (this.session !== session) {
						const error = new RealtimeCrdtBindingRejectedError(
							input.id,
							"Realtime edge capability is stale",
						);
						input.onError(error);
						throw error;
					}
					return this.registerCrdt(input);
				},
				release,
			};
		} catch (error) {
			release();
			throw error;
		}
	}

	private async ensureCrdtSession(): Promise<void> {
		while (!this.destroyed) {
			await this.ensureSession();
			if (!this.session || this.sessionCrdtHold) return;
			this.disconnect();
		}
	}

	private async registerCrdt(
		input: CrdtRealtimeRegistrationInput,
	): Promise<() => void> {
		if (this.crdt.has(input.id)) {
			throw new Error(`Realtime topology id already registered: ${input.id}`);
		}
		const entry: CrdtEntry = {
			bindingId: input.bindingId,
			onDirty: input.onDirty,
			onError: input.onError,
			dirtyScheduled: false,
		};
		this.crdt.set(input.id, entry);
		try {
			await this.sendDesiredTopology();
		} catch (error) {
			this.crdt.delete(input.id);
			if (error instanceof DispatchedPusherControlError) {
				const rejection = error.forEntry(input.id);
				if (rejection) throw rejection;
			}
			input.onError(errorFrom(error));
			throw error;
		}
		let released = false;
		return () => {
			if (released || this.crdt.get(input.id) !== entry) return;
			released = true;
			this.crdt.delete(input.id);
			const closeAfterFlush = !this.hasDemand();
			void this.sendDesiredTopology()
				.catch((error) => input.onError(errorFrom(error)))
				.finally(() => {
					if (closeAfterFlush && !this.hasDemand()) this.disconnect();
				});
		};
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
		if (!this.hasDemand() || this.destroyed) return;
		const crdtHold = this.holdCount > 0 || this.crdt.size > 0;
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
					...(crdtHold ? { crdtHold: true } : {}),
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
			!session.control.versions.includes(2)
		) {
			throw new Error("Invalid shared-provider realtime session");
		}
		this.session = session;
		this.sessionCrdtHold = crdtHold;
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

		if (this.destroyed) return;
		const config = this.options.config;
		const authEndpoint = endpoint(
			this.options.baseUrl,
			config.authEndpoint ?? "realtime/auth",
		);
		const subscription = await this.connection.subscribe({
			config,
			channelName: session.channel,
			lane: "edge",
			authorize: (socketId, channelName) =>
				this.authorize(authEndpoint, socketId, channelName),
			...(config.userAuthentication === true
				? {
						authenticateUser: (socketId: string) =>
							this.authenticateUser(authEndpoint, socketId),
					}
				: {}),
		});
		if (this.destroyed || this.session !== session) {
			subscription.release();
			return;
		}
		this.subscription = subscription;
		subscription.channel.bind("questpie:invalidate", (value: unknown) => {
			this.handleInvalidation(session, value);
		});
		subscription.channel.bind("pusher:subscription_succeeded", () => {
			this.scheduleRefresh();
			this.scheduleCrdtDirty();
		});
		subscription.channel.bind("pusher:subscription_error", (error: unknown) => {
			this.notifyAll(errorFrom(error));
		});

		const added = [...this.topics.entries()]
			.filter(([, entry]) => !entry.registered)
			.map(([topicId]) => topicId);
		const removed = initial.some(
			([topicId, entry]) => this.topics.get(topicId) !== entry,
		);
		if (removed || added.length) await this.sendDesiredTopology();
		if (!this.hasDemand()) {
			this.disconnect();
			return;
		}
		for (const topicId of added) {
			const entry = this.topics.get(topicId);
			if (entry) entry.registered = true;
		}
		this.scheduleEdgeProbe();
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

	private async authenticateUser(
		authEndpoint: string,
		socketId: string,
	): Promise<{ auth: string; user_data: string }> {
		const authHeaders = await this.options.getAuthHeaders?.();
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
					version: 2,
					revision: ++this.desiredRevision,
					subscriptions: [
						...[...this.topics.entries()].map(([id, entry]) => ({
							kind: "query",
							id,
							topic: entry.topic,
						})),
						...[...this.crdt.entries()].map(([id, entry]) => ({
							kind: "crdt",
							id,
							bindingId: entry.bindingId,
						})),
					],
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
							const payload = (await response.json().catch(() => null)) as {
								error?: {
									code?: unknown;
									message?: unknown;
									entries?: unknown;
								};
							} | null;
							if (
								response.status === 404 &&
								payload?.error?.code === "REALTIME_CONTROL_UNAVAILABLE"
							) {
								throw new PusherControlSessionUnavailableError(
									typeof payload.error.message === "string"
										? payload.error.message
										: undefined,
								);
							}
							const rejections: RealtimeCrdtBindingRejectedError[] = [];
							for (const entry of Array.isArray(payload?.error?.entries)
								? payload.error.entries
								: []) {
								if (!entry || typeof entry !== "object") continue;
								const value = entry as Record<string, unknown>;
								if (value.kind !== "crdt" || typeof value.id !== "string") {
									continue;
								}
								const target = this.crdt.get(value.id);
								if (!target) continue;
								const rejection = new RealtimeCrdtBindingRejectedError(
									value.id,
									typeof value.message === "string"
										? value.message
										: "CRDT realtime binding unavailable",
								);
								rejections.push(rejection);
								target.onError(rejection);
							}
							if (rejections.length > 0) {
								throw new DispatchedPusherControlError(
									response.status,
									rejections,
								);
							}
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

	private scheduleEdgeProbe(): void {
		if (
			this.edgeProbeTimer ||
			this.destroyed ||
			!this.session ||
			!this.hasDemand()
		) {
			return;
		}
		const intervalMs = this.options.edgeProbeIntervalMs ?? 15_000;
		if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
		this.edgeProbeTimer = setTimeout(() => {
			this.edgeProbeTimer = null;
			void this.probeEdgeSession();
		}, intervalMs);
		(
			this.edgeProbeTimer as ReturnType<typeof setTimeout> & {
				unref?: () => void;
			}
		).unref?.();
	}

	private async probeEdgeSession(): Promise<void> {
		try {
			await this.sendDesiredTopology();
		} catch (error) {
			if (error instanceof PusherControlSessionUnavailableError) {
				await this.recoverStaleSession(error);
			} else if (!(error instanceof DispatchedPusherControlError)) {
				this.notifyAll(errorFrom(error));
			}
		} finally {
			this.scheduleEdgeProbe();
		}
	}

	private recoverStaleSession(error: Error): Promise<void> {
		if (this.edgeRecoveryPromise) return this.edgeRecoveryPromise;
		const operation = (async () => {
			const staleCrdt = [...this.crdt.values()];
			this.crdt.clear();
			for (const entry of this.topics.values()) entry.registered = false;
			this.disconnect();
			for (const entry of staleCrdt) entry.onError(error);
			await Promise.resolve();
			if (this.destroyed || !this.hasDemand()) return;
			try {
				await this.ensureSession();
				this.scheduleRefresh();
			} catch (reopenError) {
				this.notifyAll(errorFrom(reopenError));
			}
		})();
		const tracked = operation.finally(() => {
			if (this.edgeRecoveryPromise === tracked) {
				this.edgeRecoveryPromise = null;
			}
		});
		this.edgeRecoveryPromise = tracked;
		return tracked;
	}

	private handleInvalidation(session: SessionResponse, value: unknown): void {
		if (
			this.session !== session ||
			!value ||
			typeof value !== "object" ||
			Array.isArray(value)
		) {
			return;
		}
		const payload = value as Record<string, unknown>;
		if (payload.sessionId !== session.sessionId) return;
		if (payload.targets === undefined) {
			this.scheduleRefresh();
			this.scheduleCrdtDirty();
			return;
		}
		if (
			!Array.isArray(payload.targets) ||
			payload.targets.length > MAX_PUSHER_INVALIDATION_TARGETS
		) {
			return;
		}
		const targets: PusherInvalidationTarget[] = [];
		for (const target of payload.targets) {
			if (
				!target ||
				typeof target !== "object" ||
				Array.isArray(target) ||
				((target as Record<string, unknown>).kind !== "query" &&
					(target as Record<string, unknown>).kind !== "crdt") ||
				typeof (target as Record<string, unknown>).id !== "string" ||
				((target as Record<string, unknown>).id as string).length === 0 ||
				((target as Record<string, unknown>).id as string).length > 512
			) {
				return;
			}
			targets.push(target as PusherInvalidationTarget);
		}
		this.scheduleRefresh(
			targets
				.filter((target) => target.kind === "query")
				.map((target) => target.id),
		);
		this.scheduleCrdtDirty(
			targets
				.filter((target) => target.kind === "crdt")
				.map((target) => target.id),
		);
	}

	private scheduleRefresh(targetIds?: readonly string[]): void {
		if (targetIds === undefined) {
			this.refreshAllPending = true;
			this.refreshTargetIds.clear();
		} else if (!this.refreshAllPending) {
			for (const id of targetIds) {
				if (this.topics.has(id)) this.refreshTargetIds.add(id);
			}
		}
		if (this.refreshPromise) return;
		this.refreshPromise = (async () => {
			while (
				!this.destroyed &&
				(this.refreshAllPending || this.refreshTargetIds.size > 0)
			) {
				const ids = this.refreshAllPending
					? [...this.topics.keys()]
					: [...this.refreshTargetIds];
				this.refreshAllPending = false;
				this.refreshTargetIds.clear();
				await Promise.all(
					ids.map((topicId) => {
						const entry = this.topics.get(topicId);
						return entry
							? this.refetchEntry(topicId, entry)
							: Promise.resolve();
					}),
				);
			}
		})().finally(() => {
			this.refreshPromise = null;
		});
	}

	private scheduleCrdtDirty(targetIds?: readonly string[]): void {
		const entries =
			targetIds === undefined
				? [...this.crdt.entries()]
				: targetIds.flatMap((id) => {
						const entry = this.crdt.get(id);
						return entry ? ([[id, entry]] as const) : [];
					});
		for (const [id, entry] of entries) {
			if (entry.dirtyScheduled) continue;
			entry.dirtyScheduled = true;
			queueMicrotask(() => {
				entry.dirtyScheduled = false;
				if (this.crdt.get(id) === entry) entry.onDirty();
			});
		}
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
		for (const entry of this.crdt.values()) entry.onError(error);
	}

	private hasDemand(): boolean {
		return this.topics.size > 0 || this.crdt.size > 0 || this.holdCount > 0;
	}

	private closeIfIdle(): void {
		if (this.hasDemand()) return;
		if (this.session) {
			void this.sendDesiredTopology()
				.catch(() => {})
				.finally(() => {
					if (!this.hasDemand()) this.disconnect();
				});
		} else if (!this.sessionPromise) {
			this.disconnect();
		}
	}

	private disconnect(): void {
		if (this.edgeProbeTimer) clearTimeout(this.edgeProbeTimer);
		this.edgeProbeTimer = null;
		this.subscription?.release();
		this.subscription = null;
		this.session = null;
		this.sessionCrdtHold = false;
		this.controlOperation = Promise.resolve();
		this.desiredRevision = 0;
		this.desiredTopologyGeneration = 0;
		this.desiredFlushedGeneration = 0;
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.topics.clear();
		this.crdt.clear();
		this.holdCount = 0;
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
