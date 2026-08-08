import { resolveRuntimeLogger } from "#questpie/server/utils/runtime-logger.js";

import {
	type ChangeBroker,
	type ChangeBrokerState,
	type ChangeWake,
	normalizeChangeWake,
} from "../transport.js";

type RedisStreamsPayload = {
	seq: number;
	resourceType: "collection" | "global";
	resource: string;
	operation: "create" | "update" | "delete" | "bulk_update" | "bulk_delete";
};

export type RedisStreamsClient = {
	xAdd: (
		stream: string,
		id: string,
		fields: Record<string, string>,
		options?: {
			TRIM?: {
				strategy: "MAXLEN";
				strategyModifier: "~";
				threshold: number;
			};
		},
	) => Promise<string>;
	xRead: (
		streams: Array<{ key: string; id: string }>,
		options?: { COUNT?: number; BLOCK?: number },
	) => Promise<unknown>;
	/**
	 * Used to resolve the subscribe position at `start()` time. Optional: a
	 * client without it falls back to `$`, which reopens the delivery gap
	 * described on `resolveStartId`.
	 */
	xInfoStream?: (stream: string) => Promise<unknown>;
	duplicate?: () => RedisStreamsClient;
	connect?: () => Promise<unknown>;
	close?: () => Promise<void>;
	quit?: () => Promise<void>;
	disconnect?: () => void;
	destroy?: () => void;
	on?: (event: "error", handler: (error: unknown) => void) => unknown;
	off?: (event: "error", handler: (error: unknown) => void) => unknown;
};

export type RedisStreamsChangeBrokerOptions = {
	client: RedisStreamsClient;
	/** Dedicated blocking-read connection. Node-redis clients are duplicated automatically. */
	reader?: RedisStreamsClient;
	stream?: string;
	blockMs?: number;
	batchSize?: number;
	maxLen?: number;
	retryDelayMs?: number;
	onError?: (error: unknown) => void;
};

class RedisStreamsDriver {
	private client: RedisStreamsClient;
	private providedReader?: RedisStreamsClient;
	private reader: RedisStreamsClient | null = null;
	private ownsReader = false;
	private readerErrorHandler?: (error: unknown) => void;
	private stream: string;
	private blockMs: number;
	private batchSize: number;
	private maxLen: number;
	private retryDelayMs: number;
	private onError?: (error: unknown) => void;
	private listeners = new Set<(notice: RedisStreamsPayload) => void>();
	private running = false;
	private readLoopPromise: Promise<void> | null = null;
	private stopPromise: Promise<void> | null = null;

	constructor(options: RedisStreamsChangeBrokerOptions) {
		this.client = options.client;
		this.providedReader = options.reader;
		this.stream = options.stream ?? "questpie:realtime";
		this.blockMs = options.blockMs ?? 5000;
		this.batchSize = options.batchSize ?? 100;
		this.maxLen = options.maxLen ?? 10_000;
		this.retryDelayMs = options.retryDelayMs ?? 500;
		this.onError = options.onError;
	}

	async start(): Promise<void> {
		if (this.running) return;
		if (this.stopPromise) await this.stopPromise;
		if (this.running) return;

		await this.ensureReader();
		// Resolve the subscribe position BEFORE returning, so `start()` means
		// "subscribed from here" rather than "reader connected". See
		// resolveStartId for why `$` alone loses messages.
		const startId = await this.resolveStartId();
		this.running = true;
		this.readLoopPromise = this.runReadLoop(startId).catch((error) => {
			this.reportError("[Realtime] Redis Streams read loop stopped", error);
		});
	}

	/**
	 * The concrete stream id the read loop should start after.
	 *
	 * `XREAD` with `$` means "messages that arrive after THIS call is issued" —
	 * and `start()` used to launch the read loop without awaiting it, so
	 * anything published between `start()` resolving and the loop's first
	 * `xRead` reaching the server was silently dropped. The window is small but
	 * real, and it is exactly the shape a caller hits when it starts a broker
	 * and immediately publishes:
	 *
	 *     await broker.start({ onWake });
	 *     await broker.publish(wake);   // could never arrive
	 *
	 * Resolving the id here closes it: whatever is added after this point has
	 * an id greater than the one we captured, so the loop picks it up no matter
	 * how late it starts. `pg-notify` already had this property because its
	 * `start()` awaits `LISTEN`; this brings the two implementations of the
	 * same interface back to the same guarantee.
	 *
	 * Falls back to `$` when the client cannot report stream info, which is no
	 * worse than the previous behaviour.
	 */
	private async resolveStartId(): Promise<string> {
		const reader = this.reader;
		if (!reader?.xInfoStream) return "$";
		try {
			const info = (await reader.xInfoStream(this.stream)) as
				| Record<string, unknown>
				| undefined;
			const lastId = info?.["last-generated-id"] ?? info?.lastGeneratedId;
			return typeof lastId === "string" && lastId.length > 0 ? lastId : "$";
		} catch {
			// A stream that does not exist yet has nothing to miss; start from the
			// beginning so the first publish is still delivered.
			return "0-0";
		}
	}

	async startPublisher(): Promise<void> {}

	async stop(): Promise<void> {
		if (this.stopPromise) return this.stopPromise;
		this.running = false;
		const readLoopPromise = this.readLoopPromise;
		const reader = this.reader;
		const ownsReader = this.ownsReader;
		const forceCloseReader = ownsReader
			? (reader?.destroy ?? reader?.disconnect)
			: undefined;
		this.stopPromise = (async () => {
			try {
				forceCloseReader?.call(reader);
			} catch (error) {
				this.reportError(
					"[Realtime] Redis Streams reader shutdown failed",
					error,
				);
			}
			if (readLoopPromise) await readLoopPromise;
			if (ownsReader && !forceCloseReader) {
				if (reader?.close) await reader.close();
				else await reader?.quit?.();
			}
		})().finally(() => {
			if (this.readerErrorHandler) {
				reader?.off?.("error", this.readerErrorHandler);
				this.readerErrorHandler = undefined;
			}
			if (this.reader === reader) {
				this.reader = null;
				this.ownsReader = false;
			}
			this.stopPromise = null;
		});
		return this.stopPromise;
	}

	subscribe(handler: (notice: RedisStreamsPayload) => void): () => void {
		this.listeners.add(handler);
		return () => {
			this.listeners.delete(handler);
		};
	}

	async publishNotice(event: RedisStreamsPayload): Promise<void> {
		await this.client.xAdd(
			this.stream,
			"*",
			{
				seq: String(event.seq),
				resourceType: event.resourceType,
				resource: event.resource,
				operation: event.operation,
			},
			{
				TRIM: {
					strategy: "MAXLEN",
					strategyModifier: "~",
					threshold: this.maxLen,
				},
			},
		);
	}

	private async readLoop(startId: string): Promise<void> {
		const reader = this.reader;
		if (!reader) throw new Error("Redis Streams reader is not initialized");

		let lastId = startId;
		while (this.running) {
			try {
				const response = await reader.xRead(
					[{ key: this.stream, id: lastId }],
					{ COUNT: this.batchSize, BLOCK: this.blockMs },
				);
				if (!this.running) break;

				const messages = this.normalizeResponse(response);
				for (const message of messages) {
					lastId = message.id;
					const notice = this.noticeFromFields(message.fields);
					if (!notice) continue;

					for (const listener of this.listeners) {
						try {
							listener(notice);
						} catch (error) {
							this.reportError(
								"[Realtime] Redis Streams listener failed",
								error,
							);
						}
					}
				}
			} catch (error) {
				if (!this.running) break;
				this.reportError(
					"[Realtime] Redis Streams read failed; retrying",
					error,
				);
				await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
			}
		}
	}

	private async ensureReader(): Promise<void> {
		if (this.reader) return;
		if (this.providedReader) {
			this.reader = this.providedReader;
			this.attachReaderErrorHandler();
			return;
		}

		if (this.client.duplicate) {
			this.reader = this.client.duplicate();
			this.ownsReader = true;
			this.attachReaderErrorHandler();
			try {
				await this.reader.connect?.();
			} catch (error) {
				if (this.readerErrorHandler) {
					this.reader.off?.("error", this.readerErrorHandler);
					this.readerErrorHandler = undefined;
				}
				this.reader = null;
				this.ownsReader = false;
				throw error;
			}
			return;
		}

		this.reader = this.client;
		this.attachReaderErrorHandler();
	}

	private attachReaderErrorHandler(): void {
		if (!this.reader?.on || this.readerErrorHandler) return;
		this.readerErrorHandler = (error) =>
			this.reportError(
				"[Realtime] Redis Streams reader connection error",
				error,
			);
		this.reader.on("error", this.readerErrorHandler);
	}

	private async runReadLoop(startId: string): Promise<void> {
		try {
			await this.readLoop(startId);
		} finally {
			this.running = false;
			this.readLoopPromise = null;
		}
	}

	private reportError(message: string, error: unknown): void {
		if (this.onError) {
			try {
				this.onError(error);
				return;
			} catch (callbackError) {
				resolveRuntimeLogger()?.warn(
					"[Realtime] Redis Streams error callback failed",
					{ callbackError, sourceError: error },
				);
				return;
			}
		}
		resolveRuntimeLogger()?.warn(message, error);
	}

	private normalizeResponse(response: any): Array<{ id: string; fields: any }> {
		if (!response || !Array.isArray(response)) return [];
		const entries: Array<{ id: string; fields: any }> = [];

		for (const streamEntry of response) {
			let messages: any[] | null = null;

			if (Array.isArray(streamEntry)) {
				messages = streamEntry[1];
			} else if (streamEntry && typeof streamEntry === "object") {
				messages = (streamEntry as any).messages ?? null;
			}

			if (!Array.isArray(messages)) continue;

			for (const message of messages) {
				if (Array.isArray(message)) {
					const id = message[0];
					const fields = message[1];
					entries.push({ id, fields });
					continue;
				}

				if (message && typeof message === "object") {
					const id = (message as any).id;
					const fields = (message as any).message ?? (message as any).fields;
					if (id && fields) {
						entries.push({ id, fields });
					}
				}
			}
		}

		return entries;
	}

	private normalizeFields(fields: any): Record<string, string> {
		if (!fields) return {};
		if (!Array.isArray(fields)) return fields as Record<string, string>;

		const result: Record<string, string> = {};
		for (let i = 0; i < fields.length; i += 2) {
			const key = fields[i];
			const value = fields[i + 1];
			if (key !== undefined) {
				result[String(key)] = value !== undefined ? String(value) : "";
			}
		}
		return result;
	}

	private noticeFromFields(fields: any): RedisStreamsPayload | null {
		const normalized = this.normalizeFields(fields);
		const seq = Number(normalized.seq);
		if (!Number.isFinite(seq)) return null;

		return {
			seq,
			resourceType: (normalized.resourceType || "collection") as any,
			resource: normalized.resource || "",
			operation: (normalized.operation || "update") as any,
		};
	}
}

/** Redis Streams implementation of the Realtime v2 notice-only seam. */
export class RedisStreamsChangeBroker implements ChangeBroker {
	private readonly driver: RedisStreamsDriver;
	private setErrorHandler: (handler: (error: unknown) => void) => void;
	private unsubscribe?: () => void;
	private active = false;

	constructor(options: RedisStreamsChangeBrokerOptions) {
		let errorHandler = (_error: unknown) => {};
		this.driver = new RedisStreamsDriver({
			...options,
			stream: options.stream ?? "questpie:realtime:v2",
			onError: (error) => errorHandler(error),
		});
		this.setErrorHandler = (handler) => {
			errorHandler = handler;
		};
	}

	async start(input: {
		onWake: (wake: ChangeWake) => void;
		onError: (error: unknown) => void;
		onStateChange?: (state: ChangeBrokerState) => void;
	}): Promise<void> {
		if (this.active) return;
		this.active = true;
		this.setErrorHandler(input.onError);
		this.unsubscribe = this.driver.subscribe((notice) => {
			let wake: ChangeWake | null = null;
			try {
				wake = normalizeChangeWake(JSON.parse(notice.resource));
			} catch {
				// Invalid messages are reported through the broker error seam below.
			}
			if (wake) input.onWake(wake);
			else input.onError(new Error("Invalid Redis Streams ChangeWake payload"));
		});
		input.onStateChange?.("connecting");

		try {
			await this.driver.start();
			input.onStateChange?.("connected");
		} catch (error) {
			input.onError(error);
			input.onStateChange?.("failed");
			this.reset();
			throw error;
		}
	}

	async publish(wake: ChangeWake): Promise<void> {
		if (!this.active) {
			throw new Error("RedisStreamsChangeBroker is not started");
		}
		const normalized = normalizeChangeWake(wake);
		if (!normalized) throw new Error("Invalid ChangeWake payload");
		await this.driver.publishNotice({
			seq:
				normalized.kind === "outbox-maybe-advanced"
					? (normalized.highWaterSeq ?? 0)
					: normalized.kind === "topology-maybe-advanced"
						? normalized.desiredRevision
						: 0,
			resourceType: "global",
			resource: JSON.stringify(normalized),
			operation: "update",
		});
	}

	async stop(): Promise<void> {
		if (!this.active) return;
		await this.driver.stop();
		this.reset();
	}

	private reset(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.active = false;
		this.setErrorHandler(() => {});
	}
}

export const redisStreamsChangeBroker = (
	options: RedisStreamsChangeBrokerOptions,
) => new RedisStreamsChangeBroker(options);
