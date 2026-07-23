import type { Client, ClientConfig, Notification } from "pg";

import type {
	ChangeBroker,
	ChangeBrokerState,
	ChangeWake,
} from "../transport.js";
import { normalizeChangeWake } from "../transport.js";

export type PgNotifyChangeBrokerOptions = {
	channel?: string;
	/** Dedicated LISTEN connection. */
	client?: Client;
	/** Separate connection used for pg_notify calls. */
	publisherClient?: Client;
	connection?: ClientConfig;
	connectionString?: string;
	errorLogIntervalMs?: number;
	reconnectInitialDelayMs?: number;
	reconnectMaxDelayMs?: number;
};

type PgNotifyDriverOptions = PgNotifyChangeBrokerOptions & {
	onError?: (error: unknown) => void;
};
type PgNotifyDriverState = "connected" | "disconnected";

type ChangeBrokerStartInput = Parameters<ChangeBroker["start"]>[0];

const PG_NOTIFY_MAX_PAYLOAD_BYTES = 8_000;
const PG_NOTIFY_MAX_PENDING_PUBLISHES = 256;

class PgNotifyDriver {
	private listenerClient: Client | null = null;
	private publisherClient: Client | null = null;
	private clientConfig?: ClientConfig;
	private connectionString?: string;
	private channel: string;
	private listeners = new Set<(payload: unknown) => void>();
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
		(state: PgNotifyDriverState) => void
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
	private listenerConnectOperation: Promise<void> | null = null;
	private publishChain: Promise<void> = Promise.resolve();
	private pendingPublishes = 0;

	constructor(options: PgNotifyDriverOptions = {}) {
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
		await this.runListenerConnect();
	}

	private async connectListener(): Promise<void> {
		const client = await this.ensureListenerClient();
		this.assertRunning();
		this.attachListenerLifecycle(client);
		await this.ensureListenerConnected(client);
		this.assertRunning();
		await client.query(`LISTEN ${this.channel}`);
		if (this.stopping) {
			try {
				await client.query(`UNLISTEN ${this.channel}`);
			} catch {
				// The central stop path still closes owned clients.
			}
			this.assertRunning();
		}
		this.notificationHandler = (msg) => {
			if (!msg.payload) return;
			let notice: unknown;
			try {
				notice = JSON.parse(msg.payload);
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
		await this.listenerConnectOperation?.catch(() => {});
		// Let the currently executing publish finish and cancel queued publishes
		// before capturing/closing clients. No queued task may create a new client
		// after shutdown has started.
		await this.publishChain;
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

	subscribe(handler: (payload: unknown) => void): () => void {
		this.listeners.add(handler);
		return () => {
			this.listeners.delete(handler);
		};
	}

	onStateChange(handler: (state: PgNotifyDriverState) => void): () => void {
		this.stateHandlers.add(handler);
		return () => this.stateHandlers.delete(handler);
	}

	protected async publishPayload(value: unknown): Promise<void> {
		const payload = JSON.stringify(value);
		const payloadBytes = new TextEncoder().encode(payload).byteLength;
		if (payloadBytes >= PG_NOTIFY_MAX_PAYLOAD_BYTES) {
			const error = new Error(
				`${this.constructor.name} payload must be smaller than ${PG_NOTIFY_MAX_PAYLOAD_BYTES} bytes (received ${payloadBytes}).`,
			);
			this.reportError("payload", error);
			throw error;
		}
		if (this.stopping) throw new Error("pg-notify driver is stopping");
		if (this.pendingPublishes >= PG_NOTIFY_MAX_PENDING_PUBLISHES) {
			const error = new Error(
				`pg-notify publish queue is full (${PG_NOTIFY_MAX_PENDING_PUBLISHES})`,
			);
			this.reportError("publish_queue", error);
			throw error;
		}
		this.pendingPublishes += 1;
		// Serialize NOTIFY queries on the dedicated publisher connection. The
		// bounded queue protects memory during a burst; durable outbox polling
		// remains the recovery path if admission rejects a notice.
		const run = async () => {
			if (this.stopping) throw new Error("pg-notify driver is stopping");
			const client = await this.ensurePublisherClient();
			await this.ensurePublisherConnected(client);
			if (this.stopping) throw new Error("pg-notify driver is stopping");
			await client.query("select pg_notify($1, $2)", [this.channel, payload]);
		};
		const settled = this.publishChain.then(run, run);
		this.publishChain = settled.catch(() => {});
		try {
			await settled;
		} catch (error) {
			this.reportError("notify", error);
			throw error;
		} finally {
			this.pendingPublishes -= 1;
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

	private emitState(state: PgNotifyDriverState): void {
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
		if (this.ownsListenerClient) {
			// A fatal node-postgres disconnect may emit more than one lifecycle
			// event before the old client fully closes. Keep its handlers attached
			// so those follow-up errors cannot become unhandled process errors; the
			// identity guard makes them no-ops after the replacement client is set.
			this.listenerClient = null;
			void client.end().catch(() => {});
		} else {
			this.detachListenerLifecycle(client);
		}
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
			await this.runListenerConnect();
		} catch (error) {
			if (this.stopping) return;
			this.reportError("reconnect", error);
			this.scheduleReconnect();
		}
	}

	private runListenerConnect(): Promise<void> {
		if (this.listenerConnectOperation) return this.listenerConnectOperation;
		let operation: Promise<void>;
		operation = this.connectListener().finally(() => {
			if (this.listenerConnectOperation === operation) {
				this.listenerConnectOperation = null;
			}
		});
		this.listenerConnectOperation = operation;
		return operation;
	}

	private assertRunning(): void {
		if (this.stopping) throw new Error("pg-notify driver is stopping");
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
			"PgNotifyChangeBroker requires a pg Client or connection config",
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

/** Postgres LISTEN/NOTIFY implementation of the Realtime v2 notice-only seam. */
export class PgNotifyChangeBroker
	extends PgNotifyDriver
	implements ChangeBroker
{
	private brokerActive = false;
	private brokerOnStateChange?: (state: ChangeBrokerState) => void;
	private unsubscribeWake?: () => void;
	private unsubscribeState?: () => void;
	private readonly setDriverErrorHandler: (
		handler: (error: unknown) => void,
	) => void;

	constructor(options: PgNotifyChangeBrokerOptions = {}) {
		let driverErrorHandler = (_error: unknown) => {};
		super({
			...options,
			channel: options.channel ?? "questpie_realtime_v2",
			onError: (error) => driverErrorHandler(error),
		});
		this.setDriverErrorHandler = (handler) => {
			driverErrorHandler = handler;
		};
	}

	override async start(input?: ChangeBrokerStartInput): Promise<void> {
		if (this.brokerActive) return;
		if (!input) {
			throw new Error("PgNotifyChangeBroker.start requires broker callbacks");
		}

		this.brokerActive = true;
		this.brokerOnStateChange = input.onStateChange;
		this.setDriverErrorHandler(input.onError);
		this.unsubscribeWake = super.subscribe((notice) => {
			const wake = normalizeChangeWake(notice);
			if (wake) input.onWake(wake);
			else input.onError(new Error("Invalid pg-notify ChangeWake payload"));
		});
		this.unsubscribeState = super.onStateChange((state) => {
			input.onStateChange?.(
				state === "connected" ? "connected" : "unavailable",
			);
		});
		input.onStateChange?.("connecting");

		try {
			await super.start();
		} catch (error) {
			input.onError(error);
			input.onStateChange?.("failed");
			this.resetBrokerCallbacks();
			await super.stop();
			throw error;
		}
	}

	async publish(wake: ChangeWake): Promise<void> {
		if (!this.brokerActive) {
			throw new Error("PgNotifyChangeBroker is not started");
		}
		const normalized = normalizeChangeWake(wake);
		if (!normalized) throw new Error("Invalid ChangeWake payload");
		await this.publishPayload(normalized);
	}

	override async stop(): Promise<void> {
		const onStateChange = this.brokerOnStateChange;
		await super.stop();
		this.resetBrokerCallbacks();
		if (onStateChange) onStateChange("disconnected");
	}

	private resetBrokerCallbacks(): void {
		this.unsubscribeWake?.();
		this.unsubscribeState?.();
		this.unsubscribeWake = undefined;
		this.unsubscribeState = undefined;
		this.brokerOnStateChange = undefined;
		this.brokerActive = false;
		this.setDriverErrorHandler(() => {});
	}
}

export const pgNotifyChangeBroker = (
	options: PgNotifyChangeBrokerOptions = {},
) => new PgNotifyChangeBroker(options);
