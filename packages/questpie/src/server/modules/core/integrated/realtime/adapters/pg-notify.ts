import type { Client, ClientConfig, Notification } from "pg";

import type { RealtimeAdapter, RealtimeAdapterState } from "../adapter.js";
import type { RealtimeChangeEvent, RealtimeNotice } from "../types.js";

export type PgNotifyAdapterOptions = {
	channel?: string;
	/** Dedicated LISTEN connection. */
	client?: Client;
	/** Separate connection used for pg_notify calls. */
	publisherClient?: Client;
	connection?: ClientConfig;
	connectionString?: string;
	onError?: (error: unknown) => void;
	errorLogIntervalMs?: number;
	reconnectInitialDelayMs?: number;
	reconnectMaxDelayMs?: number;
};

const PG_NOTIFY_MAX_PAYLOAD_BYTES = 8_000;

export class PgNotifyAdapter implements RealtimeAdapter {
	private listenerClient: Client | null = null;
	private publisherClient: Client | null = null;
	private clientConfig?: ClientConfig;
	private connectionString?: string;
	private channel: string;
	private listeners = new Set<(notice: RealtimeNotice) => void>();
	private started = false;
	private listenerConnected = false;
	private publisherConnected = false;
	private ownsListenerClient = true;
	private ownsPublisherClient = true;
	private notificationHandler?: (msg: Notification) => void;
	private readonly onError: (error: unknown) => void;
	private readonly errorLogIntervalMs: number;
	private readonly lastErrorLogAt = new Map<string, number>();
	private readonly stateHandlers = new Set<
		(state: RealtimeAdapterState) => void
	>();
	private readonly reconnectInitialDelayMs: number;
	private readonly reconnectMaxDelayMs: number;
	private reconnectAttempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private stopping = false;
	private listenerErrorHandler?: (error: Error) => void;
	private listenerEndHandler?: () => void;
	private publisherErrorHandler?: (error: Error) => void;
	private publisherEndHandler?: () => void;

	constructor(options: PgNotifyAdapterOptions = {}) {
		this.channel = options.channel ?? "questpie_realtime";
		this.onError =
			options.onError ??
			((error) => console.error("[questpie] pg-notify error:", error));
		this.errorLogIntervalMs = options.errorLogIntervalMs ?? 30_000;
		this.reconnectInitialDelayMs = options.reconnectInitialDelayMs ?? 100;
		this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;

		if (!/^[a-zA-Z0-9_]+$/.test(this.channel)) {
			throw new Error(`Invalid pg notify channel name: "${this.channel}"`);
		}

		if (options.client) {
			this.listenerClient = options.client;
			this.ownsListenerClient = false;
		}

		if (options.publisherClient) {
			this.publisherClient = options.publisherClient;
			this.ownsPublisherClient = false;
		} else if (options.client) {
			// Backward compatibility for callers that only provide one client.
			this.publisherClient = options.client;
			this.ownsPublisherClient = false;
		}

		if (options.connection) {
			this.clientConfig = options.connection;
			return;
		}

		if (options.connectionString) {
			this.connectionString = options.connectionString;
			return;
		}
	}

	async start(): Promise<void> {
		if (this.started) return;
		this.stopping = false;
		await this.connectListener();
	}

	private async connectListener(): Promise<void> {
		const client = await this.ensureListenerClient();
		this.attachListenerLifecycle(client);
		await this.ensureListenerConnected(client);
		await client.query(`LISTEN ${this.channel}`);
		this.notificationHandler = (msg) => {
			if (!msg.payload) return;
			let notice: RealtimeNotice | null = null;
			try {
				notice = JSON.parse(msg.payload) as RealtimeNotice;
			} catch {
				return;
			}
			for (const listener of this.listeners) {
				listener(notice);
			}
		};
		client.on("notification", this.notificationHandler);
		this.started = true;
		this.reconnectAttempt = 0;
		this.emitState("connected");
	}

	async startPublisher(): Promise<void> {
		const client = await this.ensurePublisherClient();
		await this.ensurePublisherConnected(client);
	}

	async stop(): Promise<void> {
		this.stopping = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		const wasStarted = this.started;
		this.started = false;
		const listenerClient = this.listenerClient;
		const publisherClient = this.publisherClient;

		if (listenerClient && this.notificationHandler) {
			listenerClient.off("notification", this.notificationHandler);
			this.notificationHandler = undefined;
		}
		if (listenerClient) this.detachListenerLifecycle(listenerClient);

		if (listenerClient && wasStarted) {
			try {
				await listenerClient.query(`UNLISTEN ${this.channel}`);
			} catch {
				// Ignore UNLISTEN failures during shutdown.
			}
		}

		if (listenerClient && this.ownsListenerClient) {
			try {
				await listenerClient.end();
			} finally {
				this.listenerConnected = false;
				this.listenerClient = null;
			}
		}

		if (
			publisherClient &&
			publisherClient !== listenerClient &&
			this.ownsPublisherClient
		) {
			try {
				await publisherClient.end();
			} finally {
				this.publisherConnected = false;
				this.publisherClient = null;
			}
		}
		if (publisherClient) this.detachPublisherLifecycle(publisherClient);
	}

	subscribe(handler: (notice: RealtimeNotice) => void): () => void {
		this.listeners.add(handler);
		return () => {
			this.listeners.delete(handler);
		};
	}

	onStateChange(handler: (state: RealtimeAdapterState) => void): () => void {
		this.stateHandlers.add(handler);
		return () => this.stateHandlers.delete(handler);
	}

	async notify(event: RealtimeChangeEvent): Promise<void> {
		const payload = JSON.stringify({
			seq: event.seq,
			resourceType: event.resourceType,
			resource: event.resource,
			operation: event.operation,
		});
		const payloadBytes = new TextEncoder().encode(payload).byteLength;
		if (payloadBytes >= PG_NOTIFY_MAX_PAYLOAD_BYTES) {
			const error = new Error(
				`PgNotifyAdapter payload must be smaller than ${PG_NOTIFY_MAX_PAYLOAD_BYTES} bytes (received ${payloadBytes}).`,
			);
			this.reportError("payload", error);
			throw error;
		}
		const client = await this.ensurePublisherClient();
		await this.ensurePublisherConnected(client);
		try {
			await client.query("select pg_notify($1, $2)", [this.channel, payload]);
		} catch (error) {
			this.reportError("notify", error);
			throw error;
		}
	}

	private reportError(kind: string, error: unknown): void {
		const now = Date.now();
		const lastLoggedAt = this.lastErrorLogAt.get(kind);
		if (
			lastLoggedAt !== undefined &&
			now - lastLoggedAt < this.errorLogIntervalMs
		) {
			return;
		}
		this.lastErrorLogAt.set(kind, now);
		this.onError(error);
	}

	private emitState(state: RealtimeAdapterState): void {
		for (const handler of this.stateHandlers) handler(state);
	}

	private attachListenerLifecycle(client: Client): void {
		this.detachListenerLifecycle(client);
		this.listenerErrorHandler = (error) => {
			this.handleListenerDisconnect(client, error);
		};
		this.listenerEndHandler = () => {
			this.handleListenerDisconnect(client);
		};
		client.on("error", this.listenerErrorHandler);
		client.on("end", this.listenerEndHandler);
	}

	private attachPublisherLifecycle(client: Client): void {
		this.detachPublisherLifecycle(client);
		this.publisherErrorHandler = (error) => {
			this.handlePublisherDisconnect(client, error);
		};
		this.publisherEndHandler = () => {
			this.handlePublisherDisconnect(
				client,
				new Error("pg-notify publisher connection ended"),
			);
		};
		client.on("error", this.publisherErrorHandler);
		client.on("end", this.publisherEndHandler);
	}

	private detachListenerLifecycle(client: Client): void {
		if (this.listenerErrorHandler) {
			client.off("error", this.listenerErrorHandler);
			this.listenerErrorHandler = undefined;
		}
		if (this.listenerEndHandler) {
			client.off("end", this.listenerEndHandler);
			this.listenerEndHandler = undefined;
		}
	}

	private detachPublisherLifecycle(client: Client): void {
		if (this.publisherErrorHandler) {
			client.off("error", this.publisherErrorHandler);
			this.publisherErrorHandler = undefined;
		}
		if (this.publisherEndHandler) {
			client.off("end", this.publisherEndHandler);
			this.publisherEndHandler = undefined;
		}
	}

	private handleListenerDisconnect(client: Client, error?: unknown): void {
		if (
			this.stopping ||
			client !== this.listenerClient ||
			(!this.started && !this.listenerConnected)
		) {
			return;
		}

		this.started = false;
		this.listenerConnected = false;
		if (this.notificationHandler) {
			client.off("notification", this.notificationHandler);
			this.notificationHandler = undefined;
		}
		this.detachListenerLifecycle(client);
		if (this.ownsListenerClient) this.listenerClient = null;
		if (error) this.reportError("listener", error);
		this.emitState("disconnected");
		this.scheduleReconnect();
	}

	private handlePublisherDisconnect(client: Client, error: unknown): void {
		if (
			this.stopping ||
			client !== this.publisherClient ||
			!this.publisherConnected
		) {
			return;
		}

		this.publisherConnected = false;
		this.detachPublisherLifecycle(client);
		if (this.ownsPublisherClient) this.publisherClient = null;
		this.reportError("publisher", error);
	}

	private scheduleReconnect(): void {
		if (this.stopping || this.reconnectTimer) return;
		const delay = Math.min(
			this.reconnectInitialDelayMs * 2 ** this.reconnectAttempt,
			this.reconnectMaxDelayMs,
		);
		this.reconnectAttempt += 1;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			void this.reconnect();
		}, delay);
	}

	private async reconnect(): Promise<void> {
		if (this.stopping) return;
		try {
			await this.connectListener();
		} catch (error) {
			this.reportError("reconnect", error);
			this.scheduleReconnect();
		}
	}

	private async createClient(): Promise<Client> {
		const { Client: PgClient } = await import("pg");

		if (this.clientConfig) {
			return new PgClient(this.clientConfig);
		}

		if (this.connectionString) {
			return new PgClient({ connectionString: this.connectionString });
		}

		throw new Error(
			"PgNotifyAdapter requires a pg Client or connection config",
		);
	}

	private async ensureListenerClient(): Promise<Client> {
		this.listenerClient ??= await this.createClient();
		return this.listenerClient;
	}

	private async ensurePublisherClient(): Promise<Client> {
		this.publisherClient ??= await this.createClient();
		return this.publisherClient;
	}

	private async ensureListenerConnected(client: Client): Promise<void> {
		if (this.listenerConnected) return;
		await this.connect(client, () => {
			this.listenerConnected = true;
		});
	}

	private async ensurePublisherConnected(client: Client): Promise<void> {
		if (this.publisherConnected) return;
		this.attachPublisherLifecycle(client);
		await this.connect(client, () => {
			this.publisherConnected = true;
		});
	}

	private async connect(
		client: Client,
		markConnected: () => void,
	): Promise<void> {
		try {
			await client.connect();
			markConnected();
			return;
		} catch (error) {
			const message = String((error as { message?: string })?.message || "");
			if (message.includes("already been connected")) {
				markConnected();
				return;
			}
			throw error;
		}
	}
}

export const pgNotifyAdapter = (options: PgNotifyAdapterOptions = {}) =>
	new PgNotifyAdapter(options);
