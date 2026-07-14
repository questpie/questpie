import { createHash } from "node:crypto";

import Pusher from "pusher";
import PusherJs from "pusher-js";

import {
	PusherChangeBroker,
	PusherClientTransport,
	type PusherClientEventsConfig,
	type PusherProvider,
	type PusherSubscriber,
} from "#questpie/server/modules/core/integrated/realtime/pusher-transport.js";
import type { ChangeBrokerState } from "#questpie/server/modules/core/integrated/realtime/transport.js";

export * from "#questpie/server/modules/core/integrated/realtime/pusher-transport.js";

function resolvePusherJsConstructor(value: unknown): typeof PusherJs {
	if (typeof value === "function") return value as typeof PusherJs;
	if (value && typeof value === "object") {
		const constructor = Reflect.get(value, "Pusher");
		if (typeof constructor === "function") {
			return constructor as typeof PusherJs;
		}
	}
	throw new TypeError("pusher-js did not expose a constructor");
}

const PusherJsConstructor = resolvePusherJsConstructor(PusherJs);

export type PusherRealtimeOptions = {
	appId: string;
	key: string;
	secret: string;
	cluster?: string;
	host?: string;
	port?: number;
	useTLS?: boolean;
	wsHost?: string;
	wsPort?: number;
	wssPort?: number;
	brokerChannel?: string;
	authEndpoint?: string;
	clientEvents?: PusherClientEventsConfig;
};

function assertSuccessfulResponse(response: {
	ok: boolean;
	status: number;
}): void {
	if (!response.ok) {
		throw new Error(`Pusher request failed with HTTP ${response.status}`);
	}
}

function createProvider(client: Pusher): PusherProvider {
	return {
		trigger: async (channel, event, data) => {
			const response = await client.trigger(channel, event, data);
			assertSuccessfulResponse(response);
		},
		authorizeChannel: (socketId, channel, presence) =>
			client.authorizeChannel(socketId, channel, presence),
		authenticateUser: (socketId, user) =>
			client.authenticateUser(socketId, user),
		terminateUserConnections: async (userId) => {
			const response = await client.terminateUserConnections(userId);
			assertSuccessfulResponse(response);
		},
		getPresenceMemberCount: async (channel) => {
			const response = await client.get({
				path: `/channels/${encodeURIComponent(channel)}`,
				params: { info: "user_count" },
			});
			assertSuccessfulResponse(response);
			const body = (await response.json()) as { user_count?: unknown };
			return typeof body.user_count === "number" ? body.user_count : 0;
		},
	};
}

function toBrokerState(value: string): ChangeBrokerState | null {
	if (
		value === "connecting" ||
		value === "connected" ||
		value === "unavailable" ||
		value === "failed" ||
		value === "disconnected"
	) {
		return value;
	}
	return null;
}

function createSubscriber(options: PusherRealtimeOptions): PusherSubscriber {
	let client: PusherJs | null = null;
	return {
		start: async (input) => {
			client = new PusherJsConstructor(options.key, {
				cluster: options.cluster ?? "mt1",
				forceTLS: options.useTLS ?? true,
				enabledTransports: ["ws"],
				...(options.wsHost || options.host
					? { wsHost: options.wsHost ?? options.host }
					: {}),
				...(options.wsPort || options.port
					? { wsPort: options.wsPort ?? options.port }
					: {}),
				...(options.wssPort ? { wssPort: options.wssPort } : {}),
			});
			client.connection.bind("state_change", (change: { current: string }) => {
				const state = toBrokerState(change.current);
				if (state) input.onStateChange(state);
			});
			client.connection.bind("error", input.onError);
			const channel = client.subscribe(input.channel);
			channel.bind(input.event, input.onMessage);
			channel.bind("pusher:subscription_error", input.onError);
		},
		stop: async () => {
			client?.disconnect();
			client = null;
		},
	};
}

/**
 * Create the managed-WS realtime preset without loading its optional peers from
 * the root `questpie` entrypoint.
 */
export function pusherRealtime(options: PusherRealtimeOptions): {
	changeBroker: PusherChangeBroker;
	clientTransport: PusherClientTransport;
} {
	const serverOptions: Pusher.Options = options.host
		? {
				appId: options.appId,
				key: options.key,
				secret: options.secret,
				host: options.host,
				...(options.port ? { port: String(options.port) } : {}),
				useTLS: options.useTLS ?? true,
			}
		: {
				appId: options.appId,
				key: options.key,
				secret: options.secret,
				cluster: options.cluster ?? "mt1",
				useTLS: options.useTLS ?? true,
			};
	const provider = createProvider(new Pusher(serverOptions));
	const brokerChannel =
		options.brokerChannel ??
		`questpie-broker-${createHash("sha256")
			.update(`${options.appId}:${options.key}`)
			.digest("hex")
			.slice(0, 24)}`;
	return {
		changeBroker: new PusherChangeBroker({
			provider,
			subscriber: createSubscriber(options),
			channel: brokerChannel,
		}),
		clientTransport: new PusherClientTransport({
			provider,
			key: options.key,
			identityKey: options.secret,
			cluster: options.cluster,
			wsHost: options.wsHost ?? options.host,
			wsPort: options.wsPort ?? options.port,
			wssPort: options.wssPort,
			forceTLS: options.useTLS,
			authEndpoint: options.authEndpoint,
			clientEvents: options.clientEvents,
		}),
	};
}
