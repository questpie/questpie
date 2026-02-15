/**
 * Realtime Multiplexer
 *
 * Manages a single SSE connection for multiple topic subscriptions.
 * Solves the HTTP/1.1 connection limit problem (6 connections per domain).
 */

// ============================================================================
// Types
// ============================================================================

export type TopicConfig = {
	/** Resource type */
	resourceType: "collection" | "global";
	/** Resource name (collection or global name) */
	resource: string;
	/** Optional WHERE filters */
	where?: Record<string, unknown>;
	/** Optional relations to include */
	with?: Record<string, unknown>;
	/** Pagination limit */
	limit?: number;
	/** Pagination offset */
	offset?: number;
	/** Order by configuration */
	orderBy?: Record<string, "asc" | "desc">;
};

export type TopicInput = TopicConfig & {
	/** Optional custom topic ID. If not provided, one will be generated. */
	id?: string;
};

type Subscriber = (data: unknown) => void;

type SSEEvent = {
	type: string;
	data: string;
};

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

// ============================================================================
// Multiplexer
// ============================================================================

export class RealtimeMultiplexer {
	private abortController: AbortController | null = null;
	private subscribers = new Map<string, Set<Subscriber>>();
	private topics = new Map<string, TopicConfig>();
	private customIds = new Map<string, string>();
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectAttempts = 0;
	private connecting = false;
	private destroyed = false;
	private reconnectPending = false;

	constructor(
		private baseUrl: string,
		private withCredentials = true,
		private debounceMs = 50,
	) {}

	/**
	 * Subscribe to a topic. Returns unsubscribe function.
	 */
	subscribe(
		topic: TopicConfig,
		callback: Subscriber,
		signal?: AbortSignal,
		customId?: string,
	): () => void {
		const topicHash = this.hashTopic(topic);
		const topicId = customId ?? topicHash;

		if (customId) {
			this.customIds.set(topicHash, customId);
		}

		if (!this.subscribers.has(topicId)) {
			this.subscribers.set(topicId, new Set());
			this.topics.set(topicId, topic);
			this.scheduleReconnect();
		}

		this.subscribers.get(topicId)!.add(callback);

		const unsubscribe = () => {
			const subs = this.subscribers.get(topicId);
			if (!subs) return;

			subs.delete(callback);

			if (subs.size === 0) {
				this.subscribers.delete(topicId);
				this.topics.delete(topicId);
				this.customIds.delete(topicHash);
				this.scheduleReconnect();
			}
		};

		signal?.addEventListener("abort", unsubscribe);
		return unsubscribe;
	}

	/**
	 * Generate a deterministic hash for a topic config using stable stringify.
	 */
	private hashTopic(topic: TopicConfig): string {
		const normalized = stableStringify(topic);
		if (typeof btoa === "function") {
			return btoa(normalized).replace(/[+/=]/g, "").slice(0, 24);
		}
		return Buffer.from(normalized).toString("base64url").slice(0, 24);
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

	/**
	 * Connect to the realtime endpoint.
	 */
	private async connect(): Promise<void> {
		if (this.connecting || this.destroyed) {
			return;
		}

		this.abortController?.abort();

		if (this.topics.size === 0) {
			this.abortController = null;
			return;
		}

		this.connecting = true;
		this.abortController = new AbortController();

		const getTopicsPayload = () =>
			Array.from(this.topics.entries()).map(([id, config]) => ({
				id,
				...config,
			}));

		try {
			const response = await fetch(`${this.baseUrl}/realtime`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ topics: getTopicsPayload() }),
				credentials: this.withCredentials ? "include" : "omit",
				signal: this.abortController.signal,
			});

			if (!response.ok) {
				throw new Error(`Realtime connection failed: ${response.status}`);
			}

			if (!response.body) {
				throw new Error("Realtime response has no body");
			}

			this.reconnectAttempts = 0;

			await this.readStream(response.body);
		} catch (error) {
			if (this.destroyed) return;

			const isAbort = (error as Error).name === "AbortError";

			if (isAbort) {
				// Let finally block handle reconnectPending cleanly
				return;
			}

			const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
			this.reconnectAttempts++;
			this.reconnectTimer = setTimeout(() => this.connect(), delay);
		} finally {
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

		if (!this.destroyed && this.topics.size > 0) {
			this.reconnectPending = false;
			this.scheduleReconnect();
		}
	}

	/**
	 * Handle a parsed SSE event.
	 */
	private handleEvent(event: SSEEvent): void {
		if (event.type === "snapshot") {
			try {
				const { topicId, data } = JSON.parse(event.data) as {
					topicId: string;
					data: unknown;
				};
				const subs = this.subscribers.get(topicId);
				if (subs) {
					for (const callback of subs) {
						callback(data);
					}
				}
			} catch {
				// Ignore parse errors
			}
		} else if (event.type === "error") {
			try {
				const { topicId, message } = JSON.parse(event.data) as {
					topicId: string;
					message: string;
				};
				console.warn(`Realtime error for topic ${topicId}: ${message}`);
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

			for (const line of lines) {
				if (line.startsWith("event: ")) {
					type = line.slice(7);
				} else if (line.startsWith("data: ")) {
					data = line.slice(6);
				}
			}

			if (type && data) {
				events.push({ type, data });
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
		this.subscribers.clear();
		this.topics.clear();
		this.customIds.clear();
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
