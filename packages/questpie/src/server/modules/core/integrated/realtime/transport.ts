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
	  };

/** Cross-instance invalidation seam. It never carries snapshots or records. */
export interface ChangeBroker {
	start(input: {
		onWake: (wake: ChangeWake) => void;
		onError: (error: unknown) => void;
	}): Promise<void>;
	publish(wake: ChangeWake): Promise<void>;
	stop(): Promise<void>;
}

export type DeliveryClass = "latest-snapshot" | "ordered-channel-event";

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

interface ClientTransportBase {
	start(input: { onError: (error: unknown) => void }): Promise<void>;
	openSession(input: EdgeSessionInput): Promise<ClientSink>;
	getClientConfig(input: ClientConfigInput): Promise<ClientTransportConfig>;
	stop(): Promise<void>;
}

export interface LocalSessionClientTransport extends ClientTransportBase {
	readonly channelDeliveryScope: "local-sessions";
}

export interface SharedProviderClientTransport extends ClientTransportBase {
	readonly channelDeliveryScope: "shared-provider";
	publishChannel(input: OrderedChannelDelivery): Promise<SinkWriteResult>;
}

export type ClientTransport =
	| LocalSessionClientTransport
	| SharedProviderClientTransport;
