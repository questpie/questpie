import type { RealtimeAdapter } from "../adapter.js";
import type { RealtimeChangeEvent, RealtimeNotice } from "../types.js";

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
	duplicate?: () => RedisStreamsClient;
	connect?: () => Promise<unknown>;
	close?: () => Promise<void>;
	quit?: () => Promise<void>;
	disconnect?: () => void;
	destroy?: () => void;
	on?: (event: "error", handler: (error: unknown) => void) => unknown;
	off?: (event: "error", handler: (error: unknown) => void) => unknown;
};

export type RedisStreamsAdapterOptions = {
	client: RedisStreamsClient;
	/** Dedicated blocking-read connection. Node-redis clients are duplicated automatically. */
	reader?: RedisStreamsClient;
	stream?: string;
	/** @deprecated Consumer groups are no longer used because they load-balance wakes. */
	group?: string;
	/** @deprecated Each adapter instance now owns an independent XREAD cursor. */
	consumer?: string;
	blockMs?: number;
	batchSize?: number;
	maxLen?: number;
	retryDelayMs?: number;
	onError?: (error: unknown) => void;
};

export class RedisStreamsAdapter implements RealtimeAdapter {
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
	private listeners = new Set<(notice: RealtimeNotice) => void>();
	private running = false;
	private readLoopPromise: Promise<void> | null = null;
	private stopPromise: Promise<void> | null = null;

	constructor(options: RedisStreamsAdapterOptions) {
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
		this.running = true;
		this.readLoopPromise = this.runReadLoop().catch((error) => {
			this.reportError("[Realtime] Redis Streams read loop stopped", error);
		});
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

	subscribe(handler: (notice: RealtimeNotice) => void): () => void {
		this.listeners.add(handler);
		return () => {
			this.listeners.delete(handler);
		};
	}

	async notify(event: RealtimeChangeEvent): Promise<void> {
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

	private async readLoop(): Promise<void> {
		const reader = this.reader;
		if (!reader) throw new Error("Redis Streams reader is not initialized");

		let lastId = "$";
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

	private async runReadLoop(): Promise<void> {
		try {
			await this.readLoop();
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
				console.warn(
					"[Realtime] Redis Streams error callback failed",
					callbackError,
				);
			}
		}
		console.warn(message, error);
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

	private noticeFromFields(fields: any): RealtimeNotice | null {
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

export const redisStreamsAdapter = (options: RedisStreamsAdapterOptions) =>
	new RedisStreamsAdapter(options);
