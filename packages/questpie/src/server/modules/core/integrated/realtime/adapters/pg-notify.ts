import type { Client, ClientConfig, Notification } from "pg";

import type { EphemeralBroker } from "#questpie/server/channels/ephemeral-broker.js";

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
	/**
	 * Bound on connecting a client the broker creates and on its round trips
	 * (LISTEN, UNLISTEN, health check, publish, close). Caller-supplied clients
	 * are never timed out. `connection.connectionTimeoutMillis` still overrides
	 * the connect part.
	 */
	connectionTimeoutMs?: number;
	/** How often a LISTEN connection the broker created proves it still works. */
	healthCheckIntervalMs?: number;
};

type PgNotifyDriverOptions = PgNotifyChangeBrokerOptions & {
	onError?: (error: unknown) => void;
};
type PgNotifyDriverState = "connected" | "disconnected";

type ChangeBrokerStartInput = Parameters<ChangeBroker["start"]>[0];

const PG_NOTIFY_MAX_PAYLOAD_BYTES = 8_000;
const PG_NOTIFY_MAX_PENDING_PUBLISHES = 256;
const PG_NOTIFY_KEEPALIVE_INITIAL_DELAY_MS = 10_000;

const ignoreError = () => {};

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	label: string,
	options: { unref?: boolean } = {},
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`pg-notify ${label} timed out`)),
					timeoutMs,
				);
				if (options.unref) timer.unref?.();
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

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
	private healthCheckTimer: ReturnType<typeof setTimeout> | null = null;
	// Bumped per established LISTEN session, so a health check that started
	// before a stop()/start() can never tear down the session after it.
	private listenerGeneration = 0;
	private readonly connectionTimeoutMs: number;
	private readonly healthCheckIntervalMs: number;
	private stopping = false;
	private listenerErrorHandler?: (error: Error) => void;
	private listenerEndHandler?: () => void;
	private publisherErrorHandler?: (error: Error) => void;
	private publisherEndHandler?: () => void;
	private listenerConnectOperation: Promise<void> | null = null;
	private publishChain: Promise<void> = Promise.resolve();
	private pendingPublishes = 0;
	private drainingPublishes = false;
	private readonly publishQueue: Array<{
		payloads: readonly string[];
		resolve: () => void;
		reject: (error: unknown) => void;
	}> = [];

	constructor(options: PgNotifyDriverOptions = {}) {
		this.channel = options.channel ?? "questpie_realtime";
		this.onError =
			options.onError ??
			((error) => console.error("[questpie] pg-notify error:", error));
		this.errorLogIntervalMs = options.errorLogIntervalMs ?? 30_000;
		this.reconnectInitialDelayMs = options.reconnectInitialDelayMs ?? 100;
		this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
		this.connectionTimeoutMs = options.connectionTimeoutMs ?? 10_000;
		this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 30_000;
		for (const [name, value] of [
			["connectionTimeoutMs", this.connectionTimeoutMs],
			["healthCheckIntervalMs", this.healthCheckIntervalMs],
		] as const) {
			if (!Number.isFinite(value) || value <= 0) {
				throw new Error(`pg-notify ${name} must be a positive number`);
			}
		}

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
		try {
			await this.ensureListenerConnected(client);
			this.assertRunning();
			await this.listenerRoundTrip(client, `LISTEN ${this.channel}`);
		} catch (error) {
			// A node-postgres Client whose connect() failed can never connect again,
			// and a session that refused LISTEN (a standby after failover) stays
			// unsubscribed; the next attempt needs a new session.
			this.discardOwnedListenerClient(client);
			throw error;
		}
		if (this.stopping) {
			try {
				await this.listenerRoundTrip(client, `UNLISTEN ${this.channel}`);
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
		this.listenerGeneration += 1;
		if (this.ownsListenerClient) this.scheduleHealthCheck(client);
		this.emitState("connected");
	}

	async startPublisher(): Promise<void> {
		const client = await this.ensurePublisherClient();
		try {
			await this.ensurePublisherConnected(client);
		} catch (error) {
			this.discardOwnedPublisherClient(client);
			throw error;
		}
	}

	async stop(): Promise<void> {
		this.stopping = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.clearHealthCheck();
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
		// node-postgres emits 'error' if the socket drops before end() completes;
		// an owned client keeps a handler until it is closed.
		if (listenerClient && this.ownsListenerClient) {
			listenerClient.on("error", ignoreError);
		}
		if (listenerClient) this.detachListenerLifecycle(listenerClient);

		if (listenerClient && wasStarted) {
			try {
				await this.listenerRoundTrip(
					listenerClient,
					`UNLISTEN ${this.channel}`,
				);
			} catch {
				// Ignore UNLISTEN failures during shutdown.
			}
		}

		if (listenerClient && this.ownsListenerClient) {
			try {
				await this.closeClient(listenerClient);
			} finally {
				listenerClient.off("error", ignoreError);
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
				await this.closeClient(publisherClient);
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

	protected publishPayload(value: unknown): Promise<void> {
		return this.publishSerializedPayloads([JSON.stringify(value)]);
	}

	protected async publishSerializedPayloads(
		payloads: readonly string[],
	): Promise<void> {
		for (const payload of payloads) {
			const payloadBytes = new TextEncoder().encode(payload).byteLength;
			if (payloadBytes >= PG_NOTIFY_MAX_PAYLOAD_BYTES) {
				const error = new Error(
					`${this.constructor.name} payload must be smaller than ${PG_NOTIFY_MAX_PAYLOAD_BYTES} bytes (received ${payloadBytes}).`,
				);
				this.reportError("payload", error);
				throw error;
			}
		}

		if (this.stopping) throw new Error("pg-notify driver is stopping");
		if (this.pendingPublishes >= PG_NOTIFY_MAX_PENDING_PUBLISHES) {
			const error = new Error(
				`pg-notify publish queue is full (${PG_NOTIFY_MAX_PENDING_PUBLISHES})`,
			);
			this.reportError("publish_queue", error);
			throw error;
		}
		if (payloads.length === 0) return;
		this.pendingPublishes += 1;
		const settled = new Promise<void>((resolve, reject) => {
			this.publishQueue.push({ payloads: [...payloads], resolve, reject });
		});
		if (!this.drainingPublishes) {
			this.drainingPublishes = true;
			// Collect this turn's requests, then drain whatever accumulated during
			// the last round trip. No timer or extra latency window is needed.
			this.publishChain = Promise.resolve().then(() => this.drainPublishes());
		}
		return settled;
	}

	private async drainPublishes(): Promise<void> {
		try {
			while (this.publishQueue.length) {
				const batch = this.publishQueue.splice(0);
				try {
					if (this.stopping) throw new Error("pg-notify driver is stopping");
					await this.sendPayloads(batch.flatMap((request) => request.payloads));
					for (const request of batch) request.resolve();
				} catch (error) {
					try {
						this.reportError("notify", error);
					} catch {
						// An error observer must not strand callers or the remaining queue.
					}
					for (const request of batch) request.reject(error);
				} finally {
					this.pendingPublishes -= batch.length;
				}
			}
		} finally {
			this.drainingPublishes = false;
		}
	}

	private async sendPayloads(payloads: readonly string[]): Promise<void> {
		const client = await this.ensurePublisherClient();
		try {
			await this.ensurePublisherConnected(client);
		} catch (error) {
			// A failed client cannot connect again; the next publish creates one.
			this.discardOwnedPublisherClient(client);
			throw error;
		}
		if (this.stopping) throw new Error("pg-notify driver is stopping");
		try {
			// Every request keeps its payload and completion semantics. Sharing an
			// autocommit amortizes round trips and the global NOTIFY commit lock for
			// Channels, query invalidations, topology and CRDT as well as ephemeral.
			await this.roundTrip(
				client,
				this.ownsPublisherClient,
				payloads.length === 1
					? "select pg_notify($1, $2)"
					: "select pg_notify($1, message) from unnest($2::text[]) as message",
				[this.channel, payloads.length === 1 ? payloads[0] : payloads],
			);
		} catch (error) {
			// A failed or unanswered batch gets a fresh session next time.
			this.discardOwnedPublisherClient(client);
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
		this.clearHealthCheck();
		if (this.notificationHandler) {
			client.off("notification", this.notificationHandler);
			this.notificationHandler = undefined;
		}
		if (this.ownsListenerClient) {
			// A fatal node-postgres disconnect may emit more than one lifecycle
			// event before the old client fully closes. Keep its handlers attached
			// so those follow-up errors cannot become unhandled process errors; the
			// identity guard makes them no-ops after the replacement client is set.
			this.discardOwnedListenerClient(client);
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
		if (this.ownsPublisherClient) {
			// Like the listener: node-postgres emits a second error when the socket
			// closes after a fatal server message, so the handlers stay attached
			// and the identity guard turns that one into a no-op.
			this.discardOwnedPublisherClient(client);
		} else {
			this.detachPublisherLifecycle(client);
		}
		this.reportError("publisher", error);
	}

	private discardOwnedListenerClient(client: Client): void {
		if (!this.ownsListenerClient || client !== this.listenerClient) return;
		this.listenerClient = null;
		this.listenerConnected = false;
		void this.closeClient(client, { background: true });
	}

	private discardOwnedPublisherClient(client: Client): void {
		if (!this.ownsPublisherClient || client !== this.publisherClient) return;
		this.publisherClient = null;
		this.publisherConnected = false;
		void this.closeClient(client, { background: true });
	}

	/** Owned clients are bounded; a caller-supplied client keeps its own policy. */
	private async roundTrip(
		client: Client,
		owned: boolean,
		sql: string,
		values?: unknown[],
	): Promise<void> {
		const query = client.query(sql, values);
		if (owned) await withTimeout(query, this.connectionTimeoutMs, sql);
		else await query;
	}

	private listenerRoundTrip(client: Client, sql: string): Promise<void> {
		return this.roundTrip(client, this.ownsListenerClient, sql);
	}

	/** End an owned client; a peer that never acknowledges gets its socket destroyed. */
	private async closeClient(
		client: Client,
		options: { background?: boolean } = {},
	): Promise<void> {
		try {
			await withTimeout(client.end(), this.connectionTimeoutMs, "close", {
				unref: options.background,
			});
		} catch {
			client.connection.stream.destroy();
		}
	}

	// A connection that silently stops delivering (a dead peer or a proxy that
	// stopped forwarding) never emits 'error' or 'end'; only a round trip
	// reveals it.
	private scheduleHealthCheck(client: Client): void {
		this.clearHealthCheck();
		const generation = this.listenerGeneration;
		this.healthCheckTimer = setTimeout(() => {
			this.healthCheckTimer = null;
			void this.checkListenerHealth(client, generation);
		}, this.healthCheckIntervalMs);
		this.healthCheckTimer.unref?.();
	}

	private clearHealthCheck(): void {
		if (!this.healthCheckTimer) return;
		clearTimeout(this.healthCheckTimer);
		this.healthCheckTimer = null;
	}

	private isCurrentListener(client: Client, generation: number): boolean {
		return (
			!this.stopping &&
			this.started &&
			client === this.listenerClient &&
			generation === this.listenerGeneration
		);
	}

	private async checkListenerHealth(
		client: Client,
		generation: number,
	): Promise<void> {
		if (!this.isCurrentListener(client, generation)) return;
		try {
			await this.listenerRoundTrip(client, "select 1");
		} catch (error) {
			if (this.isCurrentListener(client, generation)) {
				this.handleListenerDisconnect(client, error);
			}
			return;
		}
		if (this.isCurrentListener(client, generation)) {
			this.scheduleHealthCheck(client);
		}
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
		// Without these an unreachable or silent server leaves connect() and the
		// socket pending forever.
		const defaults: ClientConfig = {
			keepAlive: true,
			keepAliveInitialDelayMillis: PG_NOTIFY_KEEPALIVE_INITIAL_DELAY_MS,
			connectionTimeoutMillis: this.connectionTimeoutMs,
		};

		if (this.clientConfig) {
			return new PgClient({ ...defaults, ...this.clientConfig });
		}

		if (this.connectionString) {
			return new PgClient({
				...defaults,
				connectionString: this.connectionString,
			});
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
		await this.connect(client, this.ownsListenerClient, () => {
			this.listenerConnected = true;
		});
	}

	private async ensurePublisherConnected(client: Client): Promise<void> {
		if (this.publisherConnected) return;
		this.attachPublisherLifecycle(client);
		await this.connect(client, this.ownsPublisherClient, () => {
			this.publisherConnected = true;
		});
	}

	private async connect(
		client: Client,
		owned: boolean,
		markConnected: () => void,
	): Promise<void> {
		try {
			await client.connect();
			markConnected();
			return;
		} catch (error) {
			const message = String((error as { message?: string })?.message || "");
			// Only a caller-supplied client may arrive already connected; an owned
			// client reports this after a failed connect and is not usable.
			if (!owned && message.includes("already been connected")) {
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

export type PgNotifyEphemeralBrokerOptions = {
	/** Direct/session-pooled URL. Never pass an application transaction client. */
	connectionString: string;
	/** Isolate applications sharing a database. Default questpie_ephemeral_v1. */
	channel?: string;
};

class EphemeralNotifyDriver extends PgNotifyDriver {
	send(messages: readonly string[]): Promise<void> {
		return this.publishSerializedPayloads(messages);
	}
}

/** One LISTEN connection per app process, plus one autocommit publisher.
 * Reuses the existing driver's bounded queue, timeouts and reconnect handling.
 */
export class PgNotifyEphemeralBroker implements EphemeralBroker {
	private readonly driver: EphemeralNotifyDriver;
	private unsubscribe?: () => void;
	private unsubscribeState?: () => void;

	constructor(options: PgNotifyEphemeralBrokerOptions) {
		this.driver = new EphemeralNotifyDriver({
			connectionString: options.connectionString,
			channel: options.channel ?? "questpie_ephemeral_v1",
		});
	}

	async start(
		onMessage: (message: string) => void,
		onDisconnect: (error: unknown) => void,
	): Promise<void> {
		if (this.unsubscribe) return;
		this.unsubscribe = this.driver.subscribe((value) =>
			onMessage(JSON.stringify(value)),
		);
		this.unsubscribeState = this.driver.onStateChange((state) => {
			if (state === "disconnected")
				onDisconnect(new Error("Ephemeral LISTEN connection lost"));
		});
		try {
			await this.driver.start();
		} catch (error) {
			await this.stop();
			throw error;
		}
	}

	publish(messages: readonly string[]): Promise<void> {
		return this.driver.send(messages);
	}

	async stop(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribeState?.();
		this.unsubscribe = undefined;
		this.unsubscribeState = undefined;
		await this.driver.stop();
	}
}

export const pgNotifyEphemeralBroker = (
	options: PgNotifyEphemeralBrokerOptions,
) => new PgNotifyEphemeralBroker(options);
