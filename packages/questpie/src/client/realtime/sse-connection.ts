import type { GetAuthHeaders } from "../auth.js";
import { RealtimeCrdtBindingRejectedError } from "./crdt-error.js";
import {
	type CrdtRealtimeEdgeCapability,
	type CrdtRealtimeRegistrationInput,
} from "./session.js";

export type RealtimeSseEvent = {
	type: string;
	data: string;
};

type TopologyResource = {
	kind: "topic" | "channel" | "crdt";
	openPayload(): Record<string, unknown>;
	desiredPayload(): Record<string, unknown>;
	onEvent(event: RealtimeSseEvent): void;
	onError(error: Error): void;
	onEpochEnd?(error: Error): void;
};

type ControlSession = {
	sessionId: string;
	token: string;
};

class DispatchedRealtimeControlError extends Error {
	constructor(readonly reason: Error) {
		super(reason.message);
		this.name = "DispatchedRealtimeControlError";
	}
}

class PermanentInitialSseError extends Error {
	override readonly name = "PermanentInitialSseError";
}

function normalizedError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/**
 * One physical SSE stream and one desired-topology controller per client.
 *
 * Typed realtime facades register only topics or channels; this object owns
 * reconnect, watchdog, and atomic complete-topology submissions.
 */
export class SseConnectionManager {
	private readonly resources = new Map<string, TopologyResource>();
	private abortController: AbortController | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
	private connecting = false;
	private reconnectPending = false;
	private watchdogTriggered = false;
	private retryAttempt = 0;
	private controlSession: ControlSession | null = null;
	private controlOperation: Promise<void> = Promise.resolve();
	private topologyGeneration = 0;
	private flushedGeneration = 0;
	private desiredRevision = 0;
	private flushPromise: Promise<void> | null = null;
	private holdCount = 0;
	private hasEstablishedSession = false;
	private readonly sessionWaiters = new Set<{
		resolve(session: ControlSession): void;
		reject(error: Error): void;
	}>();

	constructor(
		private readonly options: {
			baseUrl: string;
			withCredentials: boolean;
			fetcher: typeof fetch;
			getAuthHeaders?: GetAuthHeaders;
			debounceMs?: number;
			retryBaseMs?: number;
			maxRetryMs?: number;
			pingWatchdogMs?: number;
			random?: () => number;
		},
	) {}

	registerTopic(options: {
		id: string;
		openPayload(): Record<string, unknown>;
		desiredPayload(): Record<string, unknown>;
		onEvent(event: RealtimeSseEvent): void;
		onError(error: Error): void;
	}): () => void {
		return this.register(options.id, { kind: "topic", ...options });
	}

	registerChannel(options: {
		id: string;
		openPayload(): Record<string, unknown>;
		desiredPayload(): Record<string, unknown>;
		onEvent(event: RealtimeSseEvent): void;
		onError(error: Error): void;
		onEpochEnd?(error: Error): void;
	}): () => void {
		return this.register(options.id, { kind: "channel", ...options });
	}

	async acquire(signal?: AbortSignal): Promise<CrdtRealtimeEdgeCapability> {
		if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
		this.holdCount += 1;
		this.applyTopologyChange();
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			this.holdCount -= 1;
			this.applyTopologyChange();
		};
		try {
			const controlSession =
				this.controlSession ?? (await this.waitForSession(signal));
			return {
				sessionId: controlSession.sessionId,
				token: controlSession.token,
				register: async (input) => {
					if (released) {
						throw new Error("Realtime edge capability was released");
					}
					if (this.controlSession !== controlSession) {
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

	private waitForSession(signal?: AbortSignal): Promise<ControlSession> {
		return new Promise((resolve, reject) => {
			const waiter = {
				resolve: (session: ControlSession) => {
					signal?.removeEventListener("abort", onAbort);
					this.sessionWaiters.delete(waiter);
					resolve(session);
				},
				reject: (error: Error) => {
					signal?.removeEventListener("abort", onAbort);
					this.sessionWaiters.delete(waiter);
					reject(error);
				},
			};
			const onAbort = () =>
				waiter.reject(new DOMException("Aborted", "AbortError"));
			signal?.addEventListener("abort", onAbort, { once: true });
			this.sessionWaiters.add(waiter);
		});
	}

	private async registerCrdt(
		input: CrdtRealtimeRegistrationInput,
	): Promise<() => void> {
		const pendingDirtyLanes = new Set<"visible" | "awareness" | undefined>();
		let dirtyScheduled = false;
		const release = this.register(input.id, {
			kind: "crdt",
			openPayload: () => ({}),
			desiredPayload: () => ({
				kind: input.kind,
				id: input.id,
				bindingId: input.bindingId,
			}),
			onEvent: (event) => {
				let lane: "visible" | "awareness" | undefined;
				try {
					const payload = JSON.parse(event.data) as { lane?: unknown };
					if (payload.lane === "visible" || payload.lane === "awareness") {
						lane = payload.lane;
					}
				} catch {
					// Routing already validated the frame; no lane means reconcile both.
				}
				pendingDirtyLanes.add(lane);
				if (dirtyScheduled) return;
				dirtyScheduled = true;
				queueMicrotask(() => {
					dirtyScheduled = false;
					if (!this.resources.has(input.id)) return;
					const lanes = [...pendingDirtyLanes];
					pendingDirtyLanes.clear();
					if (lanes.includes(undefined)) {
						input.onDirty();
						return;
					}
					for (const pendingLane of lanes) input.onDirty(pendingLane);
				});
			},
			onError: input.onError,
		});
		const requestedGeneration = this.topologyGeneration;
		await this.flushDesiredTopology();
		if (
			this.flushedGeneration < requestedGeneration &&
			this.resources.has(input.id) &&
			this.controlSession &&
			!this.abortController?.signal.aborted
		) {
			await this.flushDesiredTopology();
		}
		if (
			this.flushedGeneration < requestedGeneration ||
			!this.resources.has(input.id)
		) {
			release();
			throw new Error("Realtime CRDT topology registration failed");
		}
		return release;
	}

	private register(id: string, resource: TopologyResource): () => void {
		if (this.resources.has(id)) {
			throw new Error(`Realtime topology id already registered: ${id}`);
		}
		this.resources.set(id, resource);
		this.topologyGeneration += 1;
		this.applyTopologyChange();
		let released = false;
		return () => {
			if (released || this.resources.get(id) !== resource) return;
			released = true;
			this.resources.delete(id);
			this.topologyGeneration += 1;
			this.applyTopologyChange();
		};
	}

	private applyTopologyChange(): void {
		if (!this.hasDemand()) {
			this.hasEstablishedSession = false;
			if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
			this.abortController?.abort();
			return;
		}
		if (this.controlSession) {
			void this.flushDesiredTopology();
			return;
		}
		if (this.connecting) {
			// The opening request carries a generation snapshot. Once its session
			// metadata arrives, the complete newer topology is submitted in-place.
			if (this.abortController?.signal.aborted) {
				this.reconnectPending = true;
			}
			return;
		}
		this.scheduleConnect(this.options.debounceMs ?? 50);
	}

	private scheduleConnect(delayMs: number): void {
		if (!this.hasDemand()) return;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = setTimeout(() => void this.connect(), delayMs);
	}

	private async connect(): Promise<void> {
		if (this.connecting || !this.hasDemand()) return;
		this.reconnectTimer = null;
		this.connecting = true;
		this.controlSession = null;
		this.controlOperation = Promise.resolve();
		this.desiredRevision = 0;
		this.flushedGeneration = [...this.resources.values()].some(
			(resource) => resource.kind === "crdt",
		)
			? this.topologyGeneration - 1
			: this.topologyGeneration;
		this.watchdogTriggered = false;
		this.abortController = new AbortController();
		try {
			const authHeaders = await this.options.getAuthHeaders?.();
			const response = await this.options.fetcher(
				`${this.options.baseUrl}/realtime`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json", ...authHeaders },
					body: JSON.stringify(this.openTopology()),
					credentials: this.options.withCredentials ? "include" : "omit",
					signal: this.abortController.signal,
				},
			);
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as {
					errors?: unknown[];
				} | null;
				for (const error of payload?.errors ?? []) {
					this.dispatch({
						type: "error",
						data: JSON.stringify(error),
					});
				}
				if (!this.hasDemand()) return;
				const error = new Error(
					`Realtime connection failed: ${response.status}`,
				);
				if (
					!this.hasEstablishedSession &&
					isPermanentInitialStatus(response.status)
				) {
					throw new PermanentInitialSseError(error.message);
				}
				throw error;
			}
			if (!response.body) {
				const error = new Error("Realtime response has no body");
				if (!this.hasEstablishedSession) {
					throw new PermanentInitialSseError(error.message);
				}
				throw error;
			}
			this.armWatchdog();
			await this.readStream(response.body);
			throw new Error("Realtime stream closed");
		} catch (error) {
			const normalized = normalizedError(error);
			if (!this.hasDemand()) return;
			if (normalized instanceof PermanentInitialSseError) {
				this.rejectSessionWaiters(normalized);
				this.notifyAll(normalized);
				this.reconnectPending = false;
				return;
			}
			if (normalized.name === "AbortError" && !this.watchdogTriggered) {
				if (this.reconnectPending) {
					for (const resource of this.resources.values()) {
						resource.onEpochEnd?.(normalized);
					}
				}
				return;
			}
			if (
				!this.watchdogTriggered &&
				normalized.message !== "Realtime stream closed"
			) {
				this.notifyAll(normalized);
			}
			for (const resource of this.resources.values()) {
				resource.onEpochEnd?.(normalized);
			}
			const retryBaseMs = this.options.retryBaseMs ?? 1000;
			const maxRetryMs = this.options.maxRetryMs ?? 30_000;
			const base = Math.min(retryBaseMs * 2 ** this.retryAttempt++, maxRetryMs);
			this.scheduleConnect(
				Math.round(base * (0.5 + (this.options.random ?? Math.random)())),
			);
		} finally {
			this.clearWatchdog();
			this.connecting = false;
			this.controlSession = null;
			if (this.reconnectPending) {
				this.reconnectPending = false;
				this.scheduleConnect(0);
			}
		}
	}

	private openTopology(): {
		topics: Record<string, unknown>[];
		channels: Record<string, unknown>[];
		crdtHold?: true;
	} {
		const resources = [...this.resources.values()];
		return {
			topics: resources
				.filter((resource) => resource.kind === "topic")
				.map((resource) => resource.openPayload()),
			channels: resources
				.filter((resource) => resource.kind === "channel")
				.map((resource) => resource.openPayload()),
			...(this.holdCount > 0 ||
			resources.some((resource) => resource.kind === "crdt")
				? { crdtHold: true as const }
				: {}),
		};
	}

	private desiredTopology() {
		const resources = [...this.resources.values()];
		return {
			protocol: "questpie-realtime-topology",
			version: 2,
			revision: ++this.desiredRevision,
			subscriptions: resources.map((resource) => resource.desiredPayload()),
		};
	}

	private flushDesiredTopology(): Promise<void> {
		if (this.flushPromise) return this.flushPromise;
		this.flushPromise = (async () => {
			await Promise.resolve();
			while (this.flushedGeneration < this.topologyGeneration) {
				const generation = this.topologyGeneration;
				const session = this.controlSession;
				if (!session) return;
				const topology = this.desiredTopology();
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
							const payload = (await response.json().catch(() => null)) as {
								error?: unknown;
							} | null;
							if (payload?.error && this.dispatchControlError(payload.error)) {
								throw new DispatchedRealtimeControlError(
									new Error(`Realtime control failed: ${response.status}`),
								);
							}
							throw new Error(`Realtime control failed: ${response.status}`);
						}
					});
				this.controlOperation = operation;
				await operation;
				if (this.controlSession !== session) return;
				this.flushedGeneration = generation;
			}
		})()
			.catch((error) => {
				if (!(error instanceof DispatchedRealtimeControlError)) {
					this.notifyAll(normalizedError(error));
				}
				this.reconnectPending = true;
				this.abortController?.abort();
			})
			.finally(() => {
				this.flushPromise = null;
			});
		return this.flushPromise;
	}

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

	private parseEvent(block: string): RealtimeSseEvent | null {
		let type = "";
		let data = "";
		let ping = false;
		for (const line of block.split("\n")) {
			if (line.startsWith("event: ")) type = line.slice(7);
			else if (line.startsWith("data: ")) data = line.slice(6);
			else if (line.startsWith(":")) ping = true;
		}
		if (type && data) return { type, data };
		return ping ? { type: "ping", data: "" } : null;
	}

	private handleEvent(event: RealtimeSseEvent): void {
		if (event.type === "session") {
			try {
				const session = JSON.parse(event.data) as {
					sessionId?: unknown;
					token?: unknown;
					control?: {
						protocol?: unknown;
						versions?: unknown;
					};
				};
				if (
					typeof session.sessionId !== "string" ||
					typeof session.token !== "string" ||
					session.control?.protocol !== "questpie-realtime-topology" ||
					!Array.isArray(session.control.versions) ||
					!session.control.versions.includes(2)
				) {
					throw new Error(
						"Realtime server does not support desired topology v2",
					);
				}
				this.controlSession = {
					sessionId: session.sessionId,
					token: session.token,
				};
				this.hasEstablishedSession = true;
				for (const waiter of this.sessionWaiters) {
					waiter.resolve(this.controlSession);
				}
				void this.flushDesiredTopology();
			} catch (error) {
				const normalized = normalizedError(error);
				if (!this.hasEstablishedSession) {
					const permanent = new PermanentInitialSseError(normalized.message);
					this.rejectSessionWaiters(permanent);
					this.notifyAll(permanent);
					this.reconnectPending = false;
				} else {
					this.notifyAll(normalized);
					this.reconnectPending = true;
				}
				this.abortController?.abort();
			}
			return;
		}
		if (event.type === "ping") this.retryAttempt = 0;
		if (event.type === "ping") return;
		this.dispatch(event);
	}

	private dispatch(event: RealtimeSseEvent): boolean {
		try {
			const payload = JSON.parse(event.data) as {
				topicId?: unknown;
				channel?: unknown;
				channelSubscriptionId?: unknown;
				topologyEntryId?: unknown;
				kind?: unknown;
				message?: unknown;
			};
			const id =
				typeof payload.topologyEntryId === "string"
					? payload.topologyEntryId
					: typeof payload.topicId === "string"
						? payload.topicId
						: typeof payload.channelSubscriptionId === "string"
							? payload.channelSubscriptionId
							: typeof payload.channel === "string"
								? `channel:${payload.channel}`
								: null;
			if (id === "*") {
				if (event.type === "error") {
					this.notifyAll(
						new Error(
							typeof payload.message === "string"
								? payload.message
								: "Realtime topology failed",
						),
					);
					return true;
				}
				for (const resource of this.resources.values()) {
					resource.onEvent(event);
				}
				return true;
			}
			if (!id) return false;
			const resource = this.resources.get(id);
			if (!resource) return false;
			if (event.type === "error") {
				const message =
					typeof payload.message === "string"
						? payload.message
						: "Realtime topology failed";
				if (resource.kind === "topic") {
					resource.onEvent(event);
					return true;
				}
				resource.onError(
					resource.kind === "crdt" || payload.kind === "crdt"
						? new RealtimeCrdtBindingRejectedError(id, message)
						: new Error(message),
				);
				return true;
			}
			resource.onEvent(event);
			return true;
		} catch {
			// Malformed and unroutable frames cannot cross resource boundaries.
			return false;
		}
	}

	private dispatchControlError(value: unknown): boolean {
		if (!value || typeof value !== "object") return false;
		const payload = value as Record<string, unknown>;
		if (!Array.isArray(payload.entries)) {
			return this.dispatch({
				type: "error",
				data: JSON.stringify(value),
			});
		}
		let dispatched = false;
		for (const entry of payload.entries) {
			if (!entry || typeof entry !== "object") continue;
			const rejected = entry as Record<string, unknown>;
			if (typeof rejected.id !== "string") continue;
			dispatched =
				this.dispatch({
					type: "error",
					data: JSON.stringify({
						topologyEntryId: rejected.id,
						kind: rejected.kind,
						code: rejected.code,
						message: rejected.message,
					}),
				}) || dispatched;
		}
		return dispatched;
	}

	private notifyAll(error: Error): void {
		for (const resource of this.resources.values()) resource.onError(error);
	}

	private rejectSessionWaiters(error: Error): void {
		for (const waiter of this.sessionWaiters) waiter.reject(error);
	}

	private armWatchdog(): void {
		if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
		this.watchdogTimer = setTimeout(() => {
			this.watchdogTriggered = true;
			this.abortController?.abort();
		}, this.options.pingWatchdogMs ?? 25_000);
	}

	private clearWatchdog(): void {
		if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
		this.watchdogTimer = null;
	}

	private hasDemand(): boolean {
		return this.resources.size > 0 || this.holdCount > 0;
	}
}

function isPermanentInitialStatus(status: number): boolean {
	return (
		status >= 400 &&
		status < 500 &&
		status !== 408 &&
		status !== 425 &&
		status !== 429
	);
}
