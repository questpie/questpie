import type { GetAuthHeaders } from "../auth.js";
import { RealtimeMultiplexer, type TopicConfig } from "./multiplexer.js";
import type { PusherConnectionManager } from "./pusher-connection.js";
import {
	PusherRealtimeTransport,
	type PusherRealtimeConfig,
} from "./pusher.js";
import { SseConnectionManager } from "./sse-connection.js";
import type {
	RealtimeClientTransport,
	RealtimeErrorCallback,
	RealtimeSubscriber,
} from "./transport.js";

export { RealtimeCrdtBindingRejectedError } from "./crdt-error.js";

export type CrdtRealtimeRegistrationInput = Readonly<{
	kind: "crdt";
	id: string;
	bindingId: string;
	onDirty(lane?: "visible" | "awareness"): void;
	onError(error: Error): void;
}>;

export type CrdtRealtimeEdgeCapability = Readonly<{
	sessionId: string;
	token: string;
	register(input: CrdtRealtimeRegistrationInput): Promise<() => void>;
	release(): void;
}>;

type RealtimeSessionTransport = RealtimeClientTransport & {
	acquire(signal?: AbortSignal): Promise<CrdtRealtimeEdgeCapability>;
};

export type RealtimeClientSession = RealtimeClientTransport & {
	acquire(signal?: AbortSignal): Promise<CrdtRealtimeEdgeCapability>;
	acquireEdgeCapability(signal?: AbortSignal): Promise<{
		readonly sessionId: string;
		readonly token: string;
		registerCrdt(input: {
			id: string;
			bindingId: string;
			onDirty(lane: "visible" | "awareness"): void;
			onError(error: Error): void;
		}): Promise<() => void>;
		release(): void;
	}>;
};

export function createRealtimeClientSession(options: {
	baseUrl: string;
	withCredentials: boolean;
	debounceMs: number;
	getAuthHeaders?: GetAuthHeaders;
	fetcher?: typeof fetch;
	refetchTopic?: (topic: TopicConfig) => Promise<unknown>;
	pusherConnection?: PusherConnectionManager;
	sseConnection?: SseConnectionManager;
}): RealtimeClientSession {
	const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
	const sseConnection =
		options.sseConnection ??
		new SseConnectionManager({
			baseUrl: options.baseUrl,
			withCredentials: options.withCredentials,
			fetcher,
			getAuthHeaders: options.getAuthHeaders,
			debounceMs: options.debounceMs,
		});
	let transport: RealtimeSessionTransport | null = null;
	let transportPromise: Promise<RealtimeSessionTransport> | null = null;
	let generation = 0;
	const pending = new Set<object>();

	const createSse = (): RealtimeSessionTransport =>
		new RealtimeMultiplexer(
			options.baseUrl,
			options.withCredentials,
			options.debounceMs,
			{},
			options.getAuthHeaders,
			fetcher,
			sseConnection,
		);

	const getOrCreate = async (): Promise<RealtimeSessionTransport> => {
		if (transport) return transport;
		if (!transportPromise) {
			const selectedGeneration = generation;
			transportPromise = (async (): Promise<RealtimeSessionTransport> => {
				try {
					const authHeaders = await options.getAuthHeaders?.();
					const response = await fetcher(`${options.baseUrl}/realtime/config`, {
						headers: authHeaders,
						credentials: options.withCredentials ? "include" : "omit",
					});
					if (
						response.ok &&
						response.headers.get("content-type")?.includes("application/json")
					) {
						const selected = (await response.json()) as
							| { transport: "sse" }
							| {
									transport: "shared-provider";
									config: PusherRealtimeConfig;
							  };
						if (
							selected.transport === "shared-provider" &&
							selected.config?.provider === "pusher" &&
							typeof selected.config.key === "string" &&
							options.refetchTopic
						) {
							return new PusherRealtimeTransport({
								baseUrl: options.baseUrl,
								fetcher,
								getAuthHeaders: options.getAuthHeaders,
								config: selected.config,
								refetchTopic: options.refetchTopic,
								connection: options.pusherConnection,
							});
						}
					}
				} catch {
					// Backward compatibility with servers predating realtime/config.
				}
				return createSse();
			})().then((selected) => {
				if (selectedGeneration !== generation) selected.destroy();
				else transport = selected;
				return selected;
			});
		}
		return transportPromise;
	};

	const session: RealtimeClientSession = {
		subscribe(
			topic: TopicConfig,
			callback: RealtimeSubscriber,
			signal?: AbortSignal,
			customId?: string,
			onError?: RealtimeErrorCallback,
		) {
			const selectedGeneration = generation;
			const marker = {};
			pending.add(marker);
			let stopped = false;
			let stopInner: (() => void) | undefined;
			void getOrCreate()
				.then((selected) => {
					pending.delete(marker);
					if (stopped || selectedGeneration !== generation) return;
					stopInner = selected.subscribe(
						topic,
						callback,
						signal,
						customId,
						onError,
					);
				})
				.catch((error) => {
					pending.delete(marker);
					onError?.(error instanceof Error ? error : new Error(String(error)));
				});
			return () => {
				stopped = true;
				pending.delete(marker);
				stopInner?.();
			};
		},
		async acquire(signal) {
			const selected = await getOrCreate();
			return selected.acquire(signal);
		},
		async acquireEdgeCapability(signal) {
			const capability = await session.acquire(signal);
			return {
				sessionId: capability.sessionId,
				token: capability.token,
				registerCrdt: async (input) =>
					capability.register({
						kind: "crdt",
						id: input.id,
						bindingId: input.bindingId,
						onDirty: (lane) => {
							if (lane) {
								input.onDirty(lane);
								return;
							}
							input.onDirty("visible");
							input.onDirty("awareness");
						},
						onError: input.onError,
					}),
				release: capability.release,
			};
		},
		destroy() {
			generation += 1;
			pending.clear();
			transport?.destroy();
			transport = null;
			transportPromise = null;
		},
		get topicCount() {
			return transport?.topicCount ?? pending.size;
		},
		get subscriberCount() {
			return transport?.subscriberCount ?? pending.size;
		},
	};

	return session;
}
