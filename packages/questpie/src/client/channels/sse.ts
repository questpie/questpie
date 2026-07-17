import type { GetAuthHeaders } from "../auth.js";
import type {
	ChannelClientTransport,
	ChannelConnectionInput,
	ChannelSubscribeOptions,
	ChannelTransportMessage,
} from "./types.js";

type Entry = {
	id: string;
	input: ChannelConnectionInput;
	subscribers: Set<(message: ChannelTransportMessage) => void>;
	presenceSubscribers: Set<(members: readonly unknown[]) => void>;
	errorCallbacks: Set<(error: Error) => void>;
	lastEventId?: string;
	presence?: readonly unknown[];
	presenceSignature?: string;
	presenceWaiters: Set<{
		resolve: (members: readonly unknown[]) => void;
		reject: (error: Error) => void;
	}>;
};

type SseEvent = { type: string; data: string };

type ControlSession = {
	sessionId: string;
	token: string;
	control: {
		protocol: "questpie-realtime-topology";
		versions: number[];
	};
};

function channelId(input: ChannelConnectionInput): string {
	return `channel:${input.resolvedName}`;
}

/** Multiplexed ordered-channel SSE client with durable last-event resume. */
export class SseChannelTransport implements ChannelClientTransport {
	private readonly entries = new Map<string, Entry>();
	private abortController: AbortController | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private connecting = false;
	private destroyed = false;
	private reconnectPending = false;
	private retryAttempt = 0;
	private controlSession: ControlSession | null = null;
	private controlOperation: Promise<void> = Promise.resolve();
	private desiredRevision = 0;
	private desiredFlushPromise: Promise<void> | null = null;
	private desiredTopologyGeneration = 0;
	private desiredFlushedGeneration = 0;

	constructor(
		private readonly options: {
			baseUrl: string;
			fetcher: typeof fetch;
			getAuthHeaders?: GetAuthHeaders;
			withCredentials: boolean;
		},
	) {}

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
			this.removeEntry(input.resolvedName);
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
			this.removeEntry(input.resolvedName);
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
		const noop = () => {};
		const stop = this.subscribe(input, noop, options);
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

	private applyTopology(): void {
		if (this.destroyed) return;
		if (this.controlSession) {
			void this.sendDesiredTopology().catch((error) =>
				this.handleControlError(error),
			);
			return;
		}
		if (this.connecting) {
			this.reconnectPending = true;
			this.abortController?.abort();
			return;
		}
		this.scheduleConnect(0);
	}

	private ensureEntry(input: ChannelConnectionInput): Entry {
		let entry = this.entries.get(input.resolvedName);
		if (entry) return entry;
		const id = channelId(input);
		entry = {
			id,
			input,
			subscribers: new Set(),
			presenceSubscribers: new Set(),
			errorCallbacks: new Set(),
			presenceWaiters: new Set(),
		};
		this.entries.set(input.resolvedName, entry);
		this.applyTopology();
		return entry;
	}

	private removeEntry(name: string): void {
		this.entries.delete(name);
		if (this.entries.size === 0) {
			this.abortController?.abort();
			return;
		}
		this.applyTopology();
	}

	private scheduleConnect(delayMs: number): void {
		if (this.destroyed || this.entries.size === 0) return;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = setTimeout(() => void this.connect(), delayMs);
	}

	private async connect(): Promise<void> {
		if (this.destroyed || this.connecting || this.entries.size === 0) return;
		this.reconnectTimer = null;
		this.connecting = true;
		this.controlSession = null;
		this.desiredRevision = 0;
		this.desiredTopologyGeneration = 0;
		this.desiredFlushedGeneration = 0;
		this.abortController = new AbortController();
		try {
			const authHeaders = await this.options.getAuthHeaders?.();
			const response = await this.options.fetcher(
				`${this.options.baseUrl}/realtime`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json", ...authHeaders },
					body: JSON.stringify({
						channels: [...this.entries.values()].map((entry) => ({
							id: entry.id,
							channel: entry.input.registryKey,
							params: entry.input.params,
							...(entry.lastEventId ? { lastEventId: entry.lastEventId } : {}),
						})),
					}),
					credentials: this.options.withCredentials ? "include" : "omit",
					signal: this.abortController.signal,
				},
			);
			if (!response.ok || !response.body) {
				throw new Error(`Channel SSE connection failed: ${response.status}`);
			}
			await this.readStream(response.body);
			throw new Error("Channel SSE stream closed");
		} catch (error) {
			if (this.destroyed || this.entries.size === 0) return;
			if ((error as Error).name !== "AbortError") {
				const normalized =
					error instanceof Error ? error : new Error(String(error));
				if (![...this.entries.values()].some((entry) => entry.lastEventId)) {
					this.notifyAll(normalized);
				}
				const delay = Math.min(1000 * 2 ** this.retryAttempt++, 30_000);
				this.scheduleConnect(delay * (0.5 + Math.random()));
			}
		} finally {
			this.connecting = false;
			this.controlSession = null;
			if (this.reconnectPending) {
				this.reconnectPending = false;
				this.scheduleConnect(0);
			}
		}
	}

	private sendDesiredTopology(): Promise<void> {
		this.desiredTopologyGeneration += 1;
		if (this.desiredFlushPromise) return this.desiredFlushPromise;
		this.desiredFlushPromise = (async () => {
			await Promise.resolve();
			while (this.desiredFlushedGeneration < this.desiredTopologyGeneration) {
				const generation = this.desiredTopologyGeneration;
				const session = this.controlSession;
				if (!session) return;
				const topology = {
					protocol: "questpie-realtime-topology",
					version: 1,
					revision: ++this.desiredRevision,
					topics: [],
					channels: [...this.entries.values()].map((entry) => ({
						id: entry.id,
						channel: entry.input.registryKey,
						params: entry.input.params,
						...(entry.lastEventId ? { lastEventId: entry.lastEventId } : {}),
					})),
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
								credentials: this.options.withCredentials ? "include" : "omit",
							},
						);
						if (!response.ok) {
							throw new Error(`Channel SSE control failed: ${response.status}`);
						}
					});
				this.controlOperation = operation;
				await operation;
				if (this.controlSession !== session) return;
				this.desiredFlushedGeneration = generation;
			}
		})().finally(() => {
			this.desiredFlushPromise = null;
		});
		return this.desiredFlushPromise;
	}

	private handleControlError(error: unknown): void {
		this.notifyAll(error instanceof Error ? error : new Error(String(error)));
		this.reconnectPending = true;
		this.abortController?.abort();
	}

	private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const blocks = buffer.split("\n\n");
				buffer = blocks.pop() ?? "";
				for (const block of blocks) {
					const event = this.parseEvent(block);
					if (event) this.handleEvent(event);
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	private parseEvent(block: string): SseEvent | null {
		let type = "";
		let data = "";
		for (const line of block.split("\n")) {
			if (line.startsWith("event: ")) type = line.slice(7);
			else if (line.startsWith("data: ")) data = line.slice(6);
			else if (line.startsWith(":")) return { type: "ping", data: "" };
		}
		return type && data ? { type, data } : null;
	}

	private handleEvent(event: SseEvent): void {
		if (event.type === "session") {
			try {
				const session = JSON.parse(event.data) as {
					sessionId?: unknown;
					token?: unknown;
					control?: ControlSession["control"];
				};
				if (
					typeof session.sessionId === "string" &&
					typeof session.token === "string" &&
					session.control?.protocol === "questpie-realtime-topology" &&
					session.control.versions.includes(1)
				) {
					this.controlSession = {
						sessionId: session.sessionId,
						token: session.token,
						control: session.control,
					};
				} else {
					this.handleControlError(
						new Error("Realtime server does not support desired topology v1"),
					);
				}
			} catch {}
			return;
		}
		if (event.type === "ping") {
			this.retryAttempt = 0;
			return;
		}
		try {
			const frame = JSON.parse(event.data) as Record<string, unknown>;
			if (event.type === "channel_event") {
				const entry = this.entryForFrame(frame);
				if (!entry || typeof frame.event !== "string") return;
				if (typeof frame.eventId === "string")
					entry.lastEventId = frame.eventId;
				this.retryAttempt = 0;
				for (const callback of entry.subscribers) {
					callback({
						event: frame.event,
						eventId: String(frame.eventId ?? ""),
						data: frame.data,
					});
				}
			} else if (event.type === "channel_presence") {
				const entry = this.entryForFrame(frame);
				if (!entry || !Array.isArray(frame.members)) return;
				this.setPresence(entry, frame.members);
			} else if (event.type === "channel_gap") {
				const entry = this.entryForFrame(frame);
				if (entry)
					this.notifyEntry(entry, new Error("Channel event replay gap"));
			} else if (event.type === "error") {
				const id = frame.channelSubscriptionId;
				const entry = [...this.entries.values()].find((item) => item.id === id);
				if (entry) {
					this.notifyEntry(
						entry,
						new Error(String(frame.message ?? "Channel error")),
					);
				}
			}
		} catch {}
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

	private entryForFrame(frame: Record<string, unknown>): Entry | undefined {
		return typeof frame.channel === "string"
			? this.entries.get(frame.channel)
			: undefined;
	}

	private notifyEntry(entry: Entry, error: Error): void {
		for (const callback of entry.errorCallbacks) callback(error);
		const waiters = [...entry.presenceWaiters];
		entry.presenceWaiters.clear();
		for (const waiter of waiters) waiter.reject(error);
	}

	private notifyAll(error: Error): void {
		for (const entry of this.entries.values()) this.notifyEntry(entry, error);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.abortController?.abort();
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.notifyAll(new Error("Channel transport destroyed"));
		this.entries.clear();
		this.controlSession = null;
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
