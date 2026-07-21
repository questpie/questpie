import type { Principal } from "#questpie/server/config/context.js";

/** A lossy, notice-only hint that durable realtime state may have advanced. */
export type ChangeWake =
	| {
			kind: "outbox-maybe-advanced";
			highWaterSeq?: number;
			reason: "publish" | "reconnect" | "reconcile";
	  }
	| {
			kind: "channel-events-maybe-advanced";
			channelHash?: string;
			highWaterEventId?: string;
			reason: "publish" | "reconnect" | "reconcile";
	  }
	| {
			kind: "topology-maybe-advanced";
			sessionKey: string;
			ownerId: string;
			ownerGeneration: number;
			desiredRevision: number;
			reason: "submit" | "reconnect" | "reconcile";
	  };

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Validate and strip a broker wake down to its bounded metadata contract. */
export function normalizeChangeWake(value: unknown): ChangeWake | null {
	if (!value || typeof value !== "object") return null;
	const wake = value as Record<string, unknown>;

	if (wake.kind === "outbox-maybe-advanced") {
		if (
			wake.reason !== "publish" &&
			wake.reason !== "reconnect" &&
			wake.reason !== "reconcile"
		) {
			return null;
		}
		if (
			wake.highWaterSeq !== undefined &&
			!isNonNegativeSafeInteger(wake.highWaterSeq)
		) {
			return null;
		}
		return {
			kind: wake.kind,
			reason: wake.reason,
			...(wake.highWaterSeq === undefined
				? {}
				: { highWaterSeq: wake.highWaterSeq }),
		};
	}

	if (wake.kind === "channel-events-maybe-advanced") {
		if (
			wake.reason !== "publish" &&
			wake.reason !== "reconnect" &&
			wake.reason !== "reconcile"
		) {
			return null;
		}
		if (
			(wake.channelHash !== undefined &&
				typeof wake.channelHash !== "string") ||
			(wake.highWaterEventId !== undefined &&
				typeof wake.highWaterEventId !== "string")
		) {
			return null;
		}
		return {
			kind: wake.kind,
			reason: wake.reason,
			...(wake.channelHash === undefined
				? {}
				: { channelHash: wake.channelHash }),
			...(wake.highWaterEventId === undefined
				? {}
				: { highWaterEventId: wake.highWaterEventId }),
		};
	}

	if (
		wake.kind !== "topology-maybe-advanced" ||
		typeof wake.sessionKey !== "string" ||
		wake.sessionKey.length === 0 ||
		typeof wake.ownerId !== "string" ||
		wake.ownerId.length === 0 ||
		!isNonNegativeSafeInteger(wake.ownerGeneration) ||
		!isNonNegativeSafeInteger(wake.desiredRevision) ||
		(wake.reason !== "submit" &&
			wake.reason !== "reconnect" &&
			wake.reason !== "reconcile")
	) {
		return null;
	}

	return {
		kind: wake.kind,
		sessionKey: wake.sessionKey,
		ownerId: wake.ownerId,
		ownerGeneration: wake.ownerGeneration,
		desiredRevision: wake.desiredRevision,
		reason: wake.reason,
	};
}

/** Cross-instance invalidation seam. It never carries snapshots or records. */
export interface ChangeBroker {
	start(input: {
		onWake: (wake: ChangeWake) => void;
		onError: (error: unknown) => void;
		onStateChange?: (state: ChangeBrokerState) => void;
	}): Promise<void>;
	publish(wake: ChangeWake): Promise<void>;
	stop(): Promise<void>;
}

export type ChangeBrokerState =
	| "connecting"
	| "connected"
	| "unavailable"
	| "failed"
	| "disconnected";

export type DeliveryClass =
	| "latest-snapshot"
	| "ordered-channel-event"
	| "row-delta";

export type SinkWriteResult =
	| { status: "accepted"; bufferedBytes: number | null }
	| { status: "busy"; bufferedBytes: number };

export type ClientCloseReason =
	| "normal"
	| "aborted"
	| "no_topics"
	| "transport_error"
	| "write_failed"
	| "slow_consumer";

export interface ClientSink {
	readonly sessionId: string;
	/** Provider-private channel returned only for managed client transports. */
	readonly clientChannel?: string;
	write(frame: Uint8Array, delivery: DeliveryClass): Promise<SinkWriteResult>;
	close(reason: ClientCloseReason): Promise<void>;
}

export type EdgeSessionInput = {
	sessionId: string;
	principal: Principal | null;
	resolvePrincipal: () => Promise<Principal | null>;
};

export type ClientConfigInput = {
	request?: Request;
};

export type ClientAuthInput = {
	socketId: string;
	channel: string;
	principal: Principal | null;
	/** Framework channel routes have already proved subscribe authorization. */
	scope?: "session" | "channel";
	/** Presence data classified as visible to every channel member. */
	presence?: { user_info?: Record<string, unknown> };
};

export type ClientAuthResponse = {
	auth: string;
	channel_data?: string;
	shared_secret?: string;
};

export type ClientTransportConfig =
	| { transport: "sse" }
	| {
			transport: "shared-provider";
			config: Record<string, unknown>;
	  };

export type OrderedChannelDelivery = {
	channel: string;
	frame: Uint8Array;
	eventId: string;
};

export type OrderedChannelEventFrame = {
	type: "channel_event";
	channel: string;
	event: string;
	eventId: string;
	data: unknown;
};

export type ChannelGapFrame = {
	type: "channel_gap";
	channel: string;
	requestedEventId: string;
	oldestEventId: string | null;
};

interface ClientTransportBase {
	start(input: { onError: (error: unknown) => void }): Promise<void>;
	openSession(input: EdgeSessionInput): Promise<ClientSink>;
	getClientConfig(input: ClientConfigInput): Promise<ClientTransportConfig>;
	stop(): Promise<void>;
}

export interface LocalSessionClientTransport extends ClientTransportBase {
	readonly channelDeliveryScope: "local-sessions";
	encodeChannelFrame?(
		frame: OrderedChannelEventFrame | ChannelGapFrame,
	): Uint8Array;
}

export interface SharedProviderClientTransport extends ClientTransportBase {
	readonly channelDeliveryScope: "shared-provider";
	generateAuth(input: ClientAuthInput): Promise<ClientAuthResponse>;
	publishChannel(input: OrderedChannelDelivery): Promise<SinkWriteResult>;
}

export type ClientTransport =
	| LocalSessionClientTransport
	| SharedProviderClientTransport;
