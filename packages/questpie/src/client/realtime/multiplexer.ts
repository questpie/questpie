/**
 * Realtime Multiplexer
 *
 * Manages a single SSE connection for multiple topic subscriptions.
 * Solves the HTTP/1.1 connection limit problem (6 connections per domain).
 */

import {
	isRealtimeTopicRejectedPayload,
	type RealtimeTopicRejectedPayload,
} from "../../shared/realtime-error.js";
import type { GetAuthHeaders } from "../auth.js";
import type { RealtimeClientTransport } from "./transport.js";

// ============================================================================
// Types
// ============================================================================

type TopicCommon = {
	/** Resource name (collection or global name). */
	resource: string;
	/** Content locale. */
	locale?: string;
};

export type TopicConfig =
	| (TopicCommon & {
			resourceType: "collection";
			/** Omitted by legacy callers and normalized to `find` by the server. */
			operation?: "find";
			where?: Record<string, unknown>;
			with?: Record<string, unknown>;
			limit?: number;
			offset?: number;
			orderBy?: Record<string, "asc" | "desc">;
	  })
	| (TopicCommon & {
			resourceType: "collection";
			operation: "count";
			where?: Record<string, unknown>;
	  })
	| (TopicCommon & {
			resourceType: "collection";
			operation: "get";
			id: string;
			with?: Record<string, unknown>;
	  })
	| (TopicCommon & {
			resourceType: "global";
			/** Omitted by legacy callers and normalized to `get` by the server. */
			operation?: "get";
			where?: Record<string, unknown>;
			with?: Record<string, unknown>;
	  });

export type TopicInput = TopicConfig & {
	/** Optional custom topic ID. If not provided, one will be generated. */
	id?: string;
};

type Subscriber = (data: unknown) => void;
type ErrorCallback = (error: Error) => void;

type SSEEvent = {
	type: string;
	data: string;
};

export class RealtimeTopicRejectedError extends Error {
	readonly code = "REALTIME_TOPIC_REJECTED";
	readonly retryable = false;
	readonly topicId: string;
	readonly resource: string;
	readonly operation: RealtimeTopicRejectedPayload["operation"];
	readonly details: RealtimeTopicRejectedPayload["details"];

	constructor(payload: RealtimeTopicRejectedPayload) {
		super(payload.message);
		this.name = "RealtimeTopicRejectedError";
		this.topicId = payload.topicId;
		this.resource = payload.resource;
		this.operation = payload.operation;
		this.details = payload.details;
	}
}

function toRealtimeError(payload: unknown): Error | null {
	return isRealtimeTopicRejectedPayload(payload)
		? new RealtimeTopicRejectedError(payload)
		: null;
}

type ControlFrame =
	| {
			type: "add_topic";
			topicId: string;
			topic: TopicConfig;
			sinceSeq?: number;
	  }
	| { type: "remove_topic"; topicId: string };

type ControlSession = {
	sessionId: string;
	token: string;
	control?: {
		protocol: "questpie-realtime-topology";
		versions: number[];
	};
};

export type RealtimeMultiplexerRuntime = {
	retryBaseMs?: number;
	maxRetryMs?: number;
	pingWatchdogMs?: number;
	random?: () => number;
};

export function realtimeReconnectDelay(
	retryBaseMs: number,
	attempt: number,
	maxRetryMs: number,
	random: () => number,
): number {
	const baseDelay = Math.min(retryBaseMs * 2 ** attempt, maxRetryMs);
	return Math.round(baseDelay * (0.5 + random()));
}

// ============================================================================
// Helper: Stable stringify for nested objects
// ============================================================================

export function stableStringify(x: unknown): string {
	if (x === null || typeof x !== "object") {
		return JSON.stringify(x);
	}
	if (Array.isArray(x)) {
		return `[${x.map(stableStringify).join(",")}]`;
	}
	const keys = Object.keys(x).sort();
	return `{${keys.map((k) => JSON.stringify(k) + ":" + stableStringify((x as Record<string, unknown>)[k])).join(",")}}`;
}

export function realtimeTopicId(topic: TopicConfig): string {
	const normalized = stableStringify(topic);
	if (typeof Buffer !== "undefined") {
		return Buffer.from(normalized, "utf8").toString("base64url");
	}
	const bytes = new TextEncoder().encode(normalized);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

// ============================================================================
// Multiplexer
// ============================================================================

export class RealtimeMultiplexer implements RealtimeClientTransport {
	private abortController: AbortController | null = null;
	private subscribers = new Map<string, Set<Subscriber>>();
	private errorCallbacks = new Map<string, Set<ErrorCallback>>();
	private topics = new Map<string, TopicConfig>();
	private lastSeq = new Map<string, number>();
	private customIds = new Map<string, string>();
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectAttempts = 0;
	private connecting = false;
	private destroyed = false;
	private reconnectPending = false;
	private watchdogTriggered = false;
	private controlSession: ControlSession | null = null;
	private pendingControlFrames: ControlFrame[] = [];
	private controlOperation: Promise<void> = Promise.resolve();
	private controlFlushScheduled = false;
	private desiredRevision = 0;
	private readonly retryBaseMs: number;
	private readonly maxRetryMs: number;
	private readonly pingWatchdogMs: number;
	private readonly random: () => number;

	constructor(
		private baseUrl: string,
		private withCredentials = true,
		private debounceMs = 50,
		runtime: RealtimeMultiplexerRuntime = {},
		private getAuthHeaders?: GetAuthHeaders,
		private fetcher: typeof fetch = globalThis.fetch,
	) {
		this.retryBaseMs = runtime.retryBaseMs ?? 1000;
		this.maxRetryMs = runtime.maxRetryMs ?? 30_000;
		this.pingWatchdogMs = runtime.pingWatchdogMs ?? 25_000;
		this.random = runtime.random ?? Math.random;
	}

	/**
	 * Subscribe to a topic. Returns unsubscribe function.
	 */
	subscribe(
		topic: TopicConfig,
		callback: Subscriber,
		signal?: AbortSignal,
		customId?: string,
		onError?: ErrorCallback,
	): () => void {
		const topicHash = this.hashTopic(topic);
		const topicId = customId ?? topicHash;

		if (customId) {
			this.customIds.set(topicHash, customId);
		}

		if (!this.subscribers.has(topicId)) {
			this.subscribers.set(topicId, new Set());
			this.topics.set(topicId, topic);
			this.applyTopologyChange({
				type: "add_topic",
				topicId,
				topic,
				...(this.lastSeq.has(topicId)
					? { sinceSeq: this.lastSeq.get(topicId) }
					: {}),
			});
		}

		this.subscribers.get(topicId)!.add(callback);

		if (onError) {
			const callbacks = this.errorCallbacks.get(topicId) ?? new Set();
			callbacks.add(onError);
			this.errorCallbacks.set(topicId, callbacks);
		}

		let unsubscribed = false;
		const unsubscribe = () => {
			if (unsubscribed) return;
			unsubscribed = true;
			signal?.removeEventListener("abort", unsubscribe);
			const subs = this.subscribers.get(topicId);
			if (!subs) return;

			subs.delete(callback);
			if (onError) {
				const callbacks = this.errorCallbacks.get(topicId);
				callbacks?.delete(onError);
				if (callbacks?.size === 0) this.errorCallbacks.delete(topicId);
			}

			if (subs.size === 0) {
				this.subscribers.delete(topicId);
				this.topics.delete(topicId);
				this.customIds.delete(topicHash);
				this.lastSeq.delete(topicId);
				this.applyTopologyChange({ type: "remove_topic", topicId });
			}
		};

		signal?.addEventListener("abort", unsubscribe);
		return unsubscribe;
	}

	/**
	 * Generate a deterministic id for a topic config.
	 *
	 * The id must be a 1:1 function of the *entire* normalized topic so distinct
	 * subscriptions never share an id. The previous implementation truncated the
	 * encoded topic to 24 base64 chars (~18 bytes); since `stableStringify` sorts
	 * keys, that window captured only `{"resource":"` plus the first ~5 chars of
	 * the resource name, dropping `where`/`with`/`limit`/`offset`/`orderBy`/
	 * `locale` entirely. Concurrent realtime queries whose resource names shared
	 * a 5-char prefix (e.g. `events` and `event_members`) — or that differed only
	 * in `where` — collapsed onto one id, dropped the loser's topic from the POST
	 * payload (first-writer-wins), and cross-wired each other's snapshots. We now
	 * encode the full normalized topic (no truncation): collision-free by
	 * construction, and unicode-safe.
	 */
	private hashTopic(topic: TopicConfig): string {
		return realtimeTopicId(topic);
	}

	private applyTopologyChange(frame: ControlFrame): void {
		if (this.destroyed) return;
		if (this.controlSession) {
			this.pendingControlFrames.push(frame);
			if (this.supportsDesiredTopology() && this.topics.size === 0) {
				this.pendingControlFrames = [];
				this.abortController?.abort();
				return;
			}
			this.scheduleControlFlush();
			return;
		}
		if (this.connecting) {
			this.pendingControlFrames.push(frame);
			return;
		}
		this.scheduleReconnect();
	}

	private supportsDesiredTopology(): boolean {
		return Boolean(
			this.controlSession?.control?.protocol === "questpie-realtime-topology" &&
			this.controlSession.control.versions.includes(1),
		);
	}

	private scheduleControlFlush(): void {
		if (this.controlFlushScheduled) return;
		this.controlFlushScheduled = true;
		queueMicrotask(() => {
			this.controlFlushScheduled = false;
			this.flushControlFrames();
		});
	}

	private flushControlFrames(): void {
		if (!this.controlSession || this.pendingControlFrames.length === 0) return;
		const session = this.controlSession;
		const frames = this.pendingControlFrames.splice(0);
		const useDesiredTopology = this.supportsDesiredTopology();
		const revision = useDesiredTopology ? ++this.desiredRevision : 0;
		const topology = useDesiredTopology
			? {
					protocol: "questpie-realtime-topology" as const,
					version: 1 as const,
					revision,
					topics: [...this.topics.entries()].map(([id, topic]) => ({
						id,
						topic,
						...(this.lastSeq.has(id) ? { sinceSeq: this.lastSeq.get(id) } : {}),
					})),
					channels: [],
				}
			: undefined;
		this.controlOperation = this.controlOperation
			.then(async () => {
				const authHeaders = await this.getAuthHeaders?.();
				const response = await this.fetcher(`${this.baseUrl}/realtime`, {
					method: "POST",
					headers: { "Content-Type": "application/json", ...authHeaders },
					body: JSON.stringify({
						sessionId: session.sessionId,
						token: session.token,
						...(topology ? { topology } : { frames }),
					}),
					credentials: this.withCredentials ? "include" : "omit",
				});
				if (!response.ok) {
					const payload = await response.json().catch(() => null);
					throw (
						toRealtimeError((payload as { error?: unknown } | null)?.error) ??
						new Error(`Realtime control failed: ${response.status}`)
					);
				}
			})
			.catch((error) => {
				if (this.destroyed || this.controlSession !== session) return;
				const normalized =
					error instanceof Error ? error : new Error(String(error));
				if (normalized instanceof RealtimeTopicRejectedError) {
					this.rejectTopic(normalized);
					return;
				}
				for (const frame of frames)
					this.notifyTopicError(frame.topicId, normalized);
				this.reconnectPending = true;
				this.abortController?.abort();
			});
	}

	private notifyTopicError(topicId: string, error: Error): void {
		const callbacks =
			topicId === "*"
				? Array.from(this.errorCallbacks.values()).flatMap((set) => [...set])
				: [...(this.errorCallbacks.get(topicId) ?? [])];
		for (const callback of new Set(callbacks)) callback(error);
	}

	private rejectTopic(error: RealtimeTopicRejectedError): void {
		this.notifyTopicError(error.topicId, error);
		this.subscribers.delete(error.topicId);
		this.errorCallbacks.delete(error.topicId);
		this.topics.delete(error.topicId);
		this.lastSeq.delete(error.topicId);
		for (const [topicHash, customId] of this.customIds) {
			if (customId === error.topicId) this.customIds.delete(topicHash);
		}
	}

	/**
	 * Schedule a reconnection with debounce.
	 * If stream is active, abort it immediately to apply new topics.
	 */
	private scheduleReconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
		}

		if (this.connecting) {
			this.reconnectPending = true;
			if (this.abortController && !this.abortController.signal.aborted) {
				this.abortController.abort();
			}
			return;
		}

		this.reconnectTimer = setTimeout(() => this.connect(), this.debounceMs);
	}

	private scheduleRetry(): void {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		const delay = realtimeReconnectDelay(
			this.retryBaseMs,
			this.reconnectAttempts,
			this.maxRetryMs,
			this.random,
		);
		this.reconnectAttempts += 1;
		this.reconnectTimer = setTimeout(() => this.connect(), delay);
	}

	private armWatchdog(): void {
		if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
		this.watchdogTimer = setTimeout(() => {
			this.watchdogTriggered = true;
			this.abortController?.abort();
		}, this.pingWatchdogMs);
	}

	private clearWatchdog(): void {
		if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
		this.watchdogTimer = null;
	}

	/**
	 * Connect to the realtime endpoint.
	 */
	private async connect(): Promise<void> {
		if (this.connecting || this.destroyed) {
			return;
		}
		this.reconnectTimer = null;

		this.abortController?.abort();

		if (this.topics.size === 0) {
			this.abortController = null;
			return;
		}

		this.connecting = true;
		this.abortController = new AbortController();
		this.controlSession = null;
		this.pendingControlFrames = [];
		this.controlOperation = Promise.resolve();
		this.controlFlushScheduled = false;
		this.desiredRevision = 0;
		this.watchdogTriggered = false;

		const getTopicsPayload = () =>
			Array.from(this.topics.entries()).map(([topicId, config]) => ({
				...config,
				...(config.resourceType === "collection" && config.operation === "get"
					? { recordId: config.id }
					: {}),
				id: topicId,
				...(this.lastSeq.has(topicId)
					? { sinceSeq: this.lastSeq.get(topicId) }
					: {}),
			}));

		try {
			const authHeaders = await this.getAuthHeaders?.();
			const response = await this.fetcher(`${this.baseUrl}/realtime`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...authHeaders },
				body: JSON.stringify({ topics: getTopicsPayload() }),
				credentials: this.withCredentials ? "include" : "omit",
				signal: this.abortController.signal,
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as {
					errors?: unknown[];
				} | null;
				const admissionErrors =
					payload?.errors
						?.map(toRealtimeError)
						.filter((error) => error !== null) ?? [];
				if (admissionErrors.length > 0) {
					for (const error of admissionErrors) {
						this.rejectTopic(error as RealtimeTopicRejectedError);
					}
					return;
				}
				throw new Error(`Realtime connection failed: ${response.status}`);
			}

			if (!response.body) {
				throw new Error("Realtime response has no body");
			}

			this.armWatchdog();
			await this.readStream(response.body);
			throw new Error("Realtime stream closed");
		} catch (error) {
			if (this.destroyed) return;
			if (this.topics.size === 0) return;

			const isAbort = (error as Error).name === "AbortError";

			if (isAbort && !this.watchdogTriggered) {
				// Let finally block handle reconnectPending cleanly
				return;
			}

			// Notify subscribers of connection error so they can throw
			// instead of waiting forever (prevents infinite loading)
			const err = error instanceof Error ? error : new Error(String(error));
			if (
				!this.watchdogTriggered &&
				err.message !== "Realtime stream closed" &&
				this.lastSeq.size === 0
			) {
				this.notifyTopicError("*", err);
			}
			this.scheduleRetry();
		} finally {
			this.clearWatchdog();
			this.controlSession = null;
			this.connecting = false;

			if (this.reconnectPending) {
				this.reconnectPending = false;
				this.scheduleReconnect();
			}
		}
	}

	/**
	 * Read and process the SSE stream.
	 */
	private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				this.armWatchdog();

				buffer += decoder.decode(value, { stream: true });
				const { events, remaining } = this.parseSSE(buffer);
				buffer = remaining;

				for (const event of events) {
					this.handleEvent(event);
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	/**
	 * Handle a parsed SSE event.
	 */
	private handleEvent(event: SSEEvent): void {
		if (event.type === "snapshot") {
			try {
				const { topicId, seq, data } = JSON.parse(event.data) as {
					topicId: string;
					seq: number;
					data: unknown;
				};
				if (Number.isSafeInteger(seq) && seq >= 0) {
					this.lastSeq.set(topicId, seq);
				}
				this.reconnectAttempts = 0;
				const subs = this.subscribers.get(topicId);
				if (subs) {
					for (const callback of subs) {
						callback(data);
					}
				}
			} catch {
				// Ignore parse errors
			}
		} else if (event.type === "session") {
			try {
				const session = JSON.parse(event.data) as ControlSession;
				if (session.sessionId && session.token) {
					this.controlSession = session;
					this.scheduleControlFlush();
				}
			} catch {
				// Ignore malformed control metadata.
			}
		} else if (event.type === "ping") {
			this.reconnectAttempts = 0;
		} else if (event.type === "error") {
			try {
				const payload = JSON.parse(event.data) as {
					topicId: string;
					message: string;
				};
				const error = toRealtimeError(payload);
				if (error instanceof RealtimeTopicRejectedError) {
					this.rejectTopic(error);
				} else {
					this.notifyTopicError(payload.topicId, new Error(payload.message));
				}
			} catch {
				// Ignore parse errors
			}
		}
	}

	/**
	 * Parse SSE events from buffer.
	 */
	private parseSSE(buffer: string): { events: SSEEvent[]; remaining: string } {
		const events: SSEEvent[] = [];
		const blocks = buffer.split("\n\n");

		for (let i = 0; i < blocks.length - 1; i++) {
			const block = blocks[i];
			if (!block.trim()) continue;

			const lines = block.split("\n");
			let type = "";
			let data = "";
			let ping = false;

			for (const line of lines) {
				if (line.startsWith("event: ")) {
					type = line.slice(7);
				} else if (line.startsWith("data: ")) {
					data = line.slice(6);
				} else if (line.startsWith(":")) {
					ping = true;
				}
			}

			if (type && data) {
				events.push({ type, data });
			} else if (ping) {
				events.push({ type: "ping", data: "" });
			}
		}

		return { events, remaining: blocks[blocks.length - 1] };
	}

	/**
	 * Destroy the multiplexer and clean up all resources.
	 */
	destroy(): void {
		this.destroyed = true;
		this.abortController?.abort();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
		}
		this.clearWatchdog();
		this.subscribers.clear();
		this.errorCallbacks.clear();
		this.topics.clear();
		this.lastSeq.clear();
		this.customIds.clear();
		this.pendingControlFrames = [];
		this.controlFlushScheduled = false;
		this.controlSession = null;
	}

	get topicCount(): number {
		return this.topics.size;
	}

	get subscriberCount(): number {
		let count = 0;
		for (const subs of this.subscribers.values()) {
			count += subs.size;
		}
		return count;
	}
}
