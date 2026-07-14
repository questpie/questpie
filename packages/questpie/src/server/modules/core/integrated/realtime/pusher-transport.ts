import { createHmac, createHash } from "node:crypto";

import type { Principal } from "#questpie/server/config/context.js";

import type {
	ChangeBroker,
	ChangeBrokerState,
	ChangeWake,
	ClientConfigInput,
	ClientSink,
	ClientTransportConfig,
	DeliveryClass,
	EdgeSessionInput,
	OrderedChannelDelivery,
	SharedProviderClientTransport,
	SinkWriteResult,
} from "./transport.js";

const CHANNEL_PATTERN = /^[A-Za-z0-9_\-=@,.;]+$/;
const SOCKET_ID_PATTERN = /^\d+\.\d+$/;
const MAX_CHANNEL_LENGTH = 164;
const MAX_PRESENCE_ID_LENGTH = 128;
const MAX_PRESENCE_DATA_BYTES = 1024;
const MAX_PRESENCE_MEMBERS = 100;

export type PusherAuthResponse = {
	auth: string;
	channel_data?: string;
	shared_secret?: string;
};

export type PusherUserAuthResponse = {
	auth: string;
	user_data: string;
};

export interface PusherProvider {
	trigger(channel: string, event: string, data: unknown): Promise<unknown>;
	authorizeChannel(
		socketId: string,
		channel: string,
		presence?: { user_id: string; user_info?: Record<string, unknown> },
	): PusherAuthResponse;
	authenticateUser(
		socketId: string,
		user: { id: string; user_info?: Record<string, unknown> },
	): PusherUserAuthResponse;
	terminateUserConnections(userId: string): Promise<unknown>;
	getPresenceMemberCount(channel: string): Promise<number>;
}

export interface PusherSubscriber {
	start(input: {
		channel: string;
		event: string;
		onMessage: (message: unknown) => void;
		onError: (error: unknown) => void;
		onStateChange: (state: ChangeBrokerState) => void;
	}): Promise<void>;
	stop(): Promise<void>;
}

export type PusherClientEventsConfig = {
	enabled: true;
	/** Required because Pusher enables client events for the entire provider app. */
	acknowledgeProviderWideRisk: true;
	/** SDK affordance only. A raw provider client can bypass this allowlist. */
	allowedChannels: string[];
};

export type PusherClientTransportOptions = {
	provider: PusherProvider;
	key: string;
	identityKey: string;
	cluster?: string;
	wsHost?: string;
	wsPort?: number;
	wssPort?: number;
	forceTLS?: boolean;
	authEndpoint?: string;
	clientEvents?: PusherClientEventsConfig;
};

export type PusherChangeBrokerOptions = {
	provider: Pick<PusherProvider, "trigger">;
	subscriber: PusherSubscriber;
	channel: string;
};

function normalizeChangeWake(value: unknown): ChangeWake | null {
	if (!value || typeof value !== "object") return null;
	const fields = value as Record<string, unknown>;
	const wake = value as Partial<ChangeWake>;
	if (
		wake.kind !== "outbox-maybe-advanced" &&
		wake.kind !== "channel-events-maybe-advanced"
	) {
		return null;
	}
	if (
		wake.reason !== "publish" &&
		wake.reason !== "reconnect" &&
		wake.reason !== "reconcile"
	) {
		return null;
	}
	if (wake.kind === "outbox-maybe-advanced") {
		return {
			kind: wake.kind,
			...(typeof wake.highWaterSeq === "number"
				? { highWaterSeq: wake.highWaterSeq }
				: {}),
			reason: wake.reason,
		};
	}
	return {
		kind: wake.kind,
		...(typeof fields.channelHash === "string"
			? { channelHash: fields.channelHash }
			: {}),
		...(typeof fields.highWaterEventId === "string"
			? { highWaterEventId: fields.highWaterEventId }
			: {}),
		reason: wake.reason,
	};
}

export function assertPusherChannelName(channel: string): void {
	if (
		channel.length === 0 ||
		channel.length > MAX_CHANNEL_LENGTH ||
		!CHANNEL_PATTERN.test(channel)
	) {
		throw new Error(
			`Invalid Pusher channel name: expected 1-${MAX_CHANNEL_LENGTH} provider-safe characters`,
		);
	}
}

function assertSocketId(socketId: string): void {
	if (!SOCKET_ID_PATTERN.test(socketId)) {
		throw new Error("Invalid Pusher socket id");
	}
}

function principalIdentity(principal: Principal | null): string {
	if (!principal) return "anonymous";
	if (principal.kind === "system") return "system";
	if (principal.kind === "oauth") return `oauth:${principal.tokenId}`;
	return `user-session:${principal.session.id}`;
}

function stableUserIdentity(principal: Principal): string {
	if (principal.kind === "system") return "system";
	if (principal.kind === "oauth") return `oauth:${principal.user.id}`;
	return `user:${principal.user.id}`;
}

function byteLength(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function wakeKey(wake: ChangeWake): string {
	return wake.kind === "outbox-maybe-advanced"
		? wake.kind
		: `${wake.kind}:${wake.channelHash ?? "*"}`;
}

/** Pusher-protocol cross-instance wake broker. Payloads are notice-only. */
export class PusherChangeBroker implements ChangeBroker {
	private onWake: (wake: ChangeWake) => void = () => {};
	private onError: (error: unknown) => void = () => {};
	private onStateChange: (state: ChangeBrokerState) => void = () => {};
	private pending = new Map<string, ChangeWake>();
	private waiters: Array<{
		resolve: () => void;
		reject: (error: unknown) => void;
	}> = [];
	private flushScheduled = false;
	private started = false;

	constructor(private readonly options: PusherChangeBrokerOptions) {
		assertPusherChannelName(options.channel);
	}

	async start(input: {
		onWake: (wake: ChangeWake) => void;
		onError: (error: unknown) => void;
		onStateChange?: (state: ChangeBrokerState) => void;
	}): Promise<void> {
		if (this.started) return;
		this.onWake = input.onWake;
		this.onError = input.onError;
		this.onStateChange = input.onStateChange ?? (() => {});
		await this.options.subscriber.start({
			channel: this.options.channel,
			event: "questpie-wake",
			onMessage: (message) => {
				const wake = normalizeChangeWake(message);
				if (wake) this.onWake(wake);
			},
			onError: (error) => this.onError(error),
			onStateChange: (state) => {
				this.onStateChange(state);
				if (state === "connected") {
					this.onWake({
						kind: "outbox-maybe-advanced",
						reason: "reconnect",
					});
				}
			},
		});
		this.started = true;
	}

	publish(wake: ChangeWake): Promise<void> {
		if (!this.started) {
			return Promise.reject(new Error("Pusher change broker is not started"));
		}
		const normalized = normalizeChangeWake(wake);
		if (!normalized) {
			return Promise.reject(new Error("Invalid realtime change wake"));
		}
		this.pending.set(wakeKey(normalized), normalized);
		const promise = new Promise<void>((resolve, reject) => {
			this.waiters.push({ resolve, reject });
		});
		if (!this.flushScheduled) {
			this.flushScheduled = true;
			queueMicrotask(() => void this.flush());
		}
		return promise;
	}

	private async flush(): Promise<void> {
		this.flushScheduled = false;
		const wakes = [...this.pending.values()];
		const waiters = this.waiters;
		this.pending.clear();
		this.waiters = [];
		try {
			await Promise.all(
				wakes.map((wake) =>
					this.options.provider.trigger(
						this.options.channel,
						"questpie-wake",
						wake,
					),
				),
			);
			for (const waiter of waiters) waiter.resolve();
		} catch (error) {
			this.onError(error);
			for (const waiter of waiters) waiter.reject(error);
		}
		if (this.pending.size > 0 && !this.flushScheduled) {
			this.flushScheduled = true;
			queueMicrotask(() => void this.flush());
		}
	}

	async stop(): Promise<void> {
		if (!this.started) return;
		this.started = false;
		await this.options.subscriber.stop();
	}
}

type PusherSession = {
	sessionId: string;
	principalIdentity: string;
	opaquePrincipalId?: string;
	resolvePrincipal: () => Promise<Principal | null>;
};

class PusherSessionSink implements ClientSink {
	private closed = false;
	private queued = false;

	constructor(
		readonly sessionId: string,
		readonly clientChannel: string,
		private readonly provider: PusherProvider,
		private readonly onError: (error: unknown) => void,
		private readonly onClose: () => void,
	) {}

	async write(
		_frame: Uint8Array,
		delivery: DeliveryClass,
	): Promise<SinkWriteResult> {
		if (this.closed) throw new Error("Pusher realtime session is closed");
		if (delivery !== "latest-snapshot") {
			throw new Error("Ordered channel events must use publishChannel()");
		}
		if (!this.queued) {
			this.queued = true;
			queueMicrotask(() => {
				this.queued = false;
				if (this.closed) return;
				void this.provider
					.trigger(this.clientChannel, "questpie:invalidate", {
						sessionId: this.sessionId,
					})
					.catch(this.onError);
			});
		}
		return { status: "accepted", bufferedBytes: null };
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.onClose();
	}
}

/** Managed-Pusher edge transport. Live-query writes become private refetch wakes. */
export class PusherClientTransport implements SharedProviderClientTransport {
	readonly channelDeliveryScope = "shared-provider" as const;

	private onError: (error: unknown) => void = () => {};
	private readonly sessions = new Map<string, PusherSession>();
	private readonly sinks = new Map<string, PusherSessionSink>();
	private readonly revokedPrincipalIds = new Set<string>();
	private started = false;
	private stopped = false;

	constructor(private readonly options: PusherClientTransportOptions) {
		if (
			options.clientEvents?.enabled &&
			options.clientEvents.acknowledgeProviderWideRisk !== true
		) {
			throw new Error(
				"Pusher client events require acknowledgement of their provider-wide security scope",
			);
		}
	}

	async start(input: { onError: (error: unknown) => void }): Promise<void> {
		if (this.stopped) throw new Error("Pusher client transport is stopped");
		this.onError = input.onError;
		this.started = true;
	}

	getSessionChannel(sessionId: string): string {
		const digest = createHash("sha256")
			.update(sessionId)
			.digest("hex")
			.slice(0, 32);
		return `private-questpie-rt-${digest}`;
	}

	async openSession(input: EdgeSessionInput): Promise<ClientSink> {
		if (this.stopped) throw new Error("Pusher client transport is stopped");
		if (!this.started) await this.start({ onError: this.onError });
		const channel = this.getSessionChannel(input.sessionId);
		assertPusherChannelName(channel);
		if (this.sessions.has(channel)) {
			throw new Error("Pusher realtime session already exists");
		}
		const opaquePrincipalId = input.principal
			? this.opaquePrincipalId(input.principal)
			: undefined;
		if (opaquePrincipalId && this.revokedPrincipalIds.has(opaquePrincipalId)) {
			throw new Error("Realtime principal is revoked");
		}
		this.sessions.set(channel, {
			sessionId: input.sessionId,
			principalIdentity: principalIdentity(input.principal),
			opaquePrincipalId,
			resolvePrincipal: input.resolvePrincipal,
		});
		const sink = new PusherSessionSink(
			input.sessionId,
			channel,
			this.options.provider,
			(error) => this.onError(error),
			() => {
				this.sessions.delete(channel);
				this.sinks.delete(input.sessionId);
			},
		);
		this.sinks.set(input.sessionId, sink);
		return sink;
	}

	async getClientConfig(
		_input: ClientConfigInput,
	): Promise<ClientTransportConfig> {
		return {
			transport: "shared-provider",
			config: {
				provider: "pusher",
				key: this.options.key,
				...(this.options.cluster ? { cluster: this.options.cluster } : {}),
				...(this.options.wsHost ? { wsHost: this.options.wsHost } : {}),
				...(this.options.wsPort ? { wsPort: this.options.wsPort } : {}),
				...(this.options.wssPort ? { wssPort: this.options.wssPort } : {}),
				forceTLS: this.options.forceTLS ?? true,
				heartbeat: "provider-managed",
				authEndpoint: this.options.authEndpoint ?? "realtime/auth",
				userAuthentication: true,
				...(this.options.clientEvents
					? {
							clientEvents: {
								enabled: true,
								allowedChannels: this.options.clientEvents.allowedChannels,
								security: "provider-app-scoped",
							},
						}
					: {}),
			},
		};
	}

	async generateAuth(input: {
		socketId: string;
		channel: string;
		principal: Principal | null;
		scope?: "session" | "channel";
		presence?: { user_info?: Record<string, unknown> };
	}): Promise<PusherAuthResponse> {
		assertSocketId(input.socketId);
		assertPusherChannelName(input.channel);
		if (input.scope === "channel") {
			if (input.channel.startsWith("presence-")) {
				if (!input.principal) {
					throw new Error(
						"Presence channel authorization requires a principal",
					);
				}
				return this.generatePresenceAuth({
					socketId: input.socketId,
					channel: input.channel,
					principal: input.principal,
					member: input.presence,
				});
			}
			return this.options.provider.authorizeChannel(
				input.socketId,
				input.channel,
			);
		}
		const session = this.sessions.get(input.channel);
		if (!session) throw new Error("Realtime session is not authorized");
		const currentPrincipal = await session.resolvePrincipal();
		const expected = session.principalIdentity;
		if (
			principalIdentity(input.principal) !== expected ||
			principalIdentity(currentPrincipal) !== expected ||
			(session.opaquePrincipalId !== undefined &&
				this.revokedPrincipalIds.has(session.opaquePrincipalId))
		) {
			throw new Error("Realtime session is not authorized");
		}
		return this.options.provider.authorizeChannel(
			input.socketId,
			input.channel,
		);
	}

	private opaquePrincipalId(principal: Principal): string {
		return createHmac("sha256", this.options.identityKey)
			.update(stableUserIdentity(principal))
			.digest("hex");
	}

	async generateUserAuth(input: {
		socketId: string;
		principal: Principal;
	}): Promise<PusherUserAuthResponse> {
		assertSocketId(input.socketId);
		const id = this.opaquePrincipalId(input.principal);
		if (this.revokedPrincipalIds.has(id)) {
			throw new Error("Realtime principal is revoked");
		}
		return this.options.provider.authenticateUser(input.socketId, {
			id,
		});
	}

	async generatePresenceAuth(input: {
		socketId: string;
		channel: string;
		principal: Principal;
		member?: { user_info?: Record<string, unknown> };
	}): Promise<PusherAuthResponse> {
		assertSocketId(input.socketId);
		assertPusherChannelName(input.channel);
		if (!input.channel.startsWith("presence-")) {
			throw new Error("Presence auth requires a presence channel");
		}
		const userId = this.opaquePrincipalId(input.principal);
		if (this.revokedPrincipalIds.has(userId)) {
			throw new Error("Realtime principal is revoked");
		}
		if (userId.length > MAX_PRESENCE_ID_LENGTH) {
			throw new Error(
				`Presence member id exceeds ${MAX_PRESENCE_ID_LENGTH} characters`,
			);
		}
		const presence = {
			user_id: userId,
			...(input.member?.user_info ? { user_info: input.member.user_info } : {}),
		};
		if (byteLength(presence) > MAX_PRESENCE_DATA_BYTES) {
			throw new Error(
				`Presence member object exceeds ${MAX_PRESENCE_DATA_BYTES} bytes`,
			);
		}
		const memberCount = await this.options.provider.getPresenceMemberCount(
			input.channel,
		);
		if (memberCount >= MAX_PRESENCE_MEMBERS) {
			throw new Error(
				`Presence channel is limited to ${MAX_PRESENCE_MEMBERS} members`,
			);
		}
		return this.options.provider.authorizeChannel(
			input.socketId,
			input.channel,
			presence,
		);
	}

	async revokePrincipal(principal: Principal): Promise<void> {
		const id = this.opaquePrincipalId(principal);
		this.revokedPrincipalIds.add(id);
		const sessions = [...this.sessions.entries()]
			.filter(([, session]) => session.opaquePrincipalId === id)
			.map(([, session]) => this.sinks.get(session.sessionId))
			.filter((sink): sink is PusherSessionSink => sink !== undefined);
		await Promise.all(sessions.map((sink) => sink.close()));
		await this.options.provider.terminateUserConnections(id);
	}

	restorePrincipal(principal: Principal): void {
		this.revokedPrincipalIds.delete(this.opaquePrincipalId(principal));
	}

	async publishChannel(
		input: OrderedChannelDelivery,
	): Promise<SinkWriteResult> {
		assertPusherChannelName(input.channel);
		await this.options.provider.trigger(input.channel, "questpie:channel", {
			eventId: input.eventId,
			data: new TextDecoder().decode(input.frame),
		});
		return { status: "accepted", bufferedBytes: null };
	}

	async stop(): Promise<void> {
		if (this.stopped) return;
		this.stopped = true;
		this.started = false;
		await Promise.all([...this.sinks.values()].map((sink) => sink.close()));
		this.sinks.clear();
		this.sessions.clear();
		this.revokedPrincipalIds.clear();
	}
}
