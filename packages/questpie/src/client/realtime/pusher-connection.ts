export type PusherRealtimeConfig = {
	provider: "pusher";
	key: string;
	cluster?: string;
	wsHost?: string;
	wsPort?: number;
	wssPort?: number;
	forceTLS?: boolean;
	authEndpoint?: string;
};

export type PusherModule = typeof import("pusher-js");

export type PusherAuthResponse = {
	auth: string;
	channel_data?: string;
	shared_secret?: string;
};

type PusherChannel = ReturnType<
	InstanceType<PusherModule["default"]>["subscribe"]
>;

type ChannelAuthorizer = (
	socketId: string,
	channelName: string,
) => Promise<PusherAuthResponse>;

type ChannelOwner = {
	authorize: ChannelAuthorizer;
	channel?: PusherChannel;
};

export type ManagedPusherSubscription = {
	channel: PusherChannel;
	release(): void;
};

function normalizedError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function connectionSignature(config: PusherRealtimeConfig): string {
	return JSON.stringify({
		key: config.key,
		cluster: config.cluster ?? "mt1",
		wsHost: config.wsHost ?? null,
		wsPort: config.wsPort ?? null,
		wssPort: config.wssPort ?? null,
		forceTLS: config.forceTLS ?? true,
	});
}

/**
 * Owns one physical Pusher connection for every realtime facade of one client.
 *
 * Authorization is dispatched by an exact server-issued channel name. The
 * application channel lane cannot claim the framework's private edge namespace.
 */
export class PusherConnectionManager {
	private readonly owners = new Map<string, ChannelOwner>();
	private pusher: InstanceType<PusherModule["default"]> | null = null;
	private pusherPromise: Promise<InstanceType<PusherModule["default"]>> | null =
		null;
	private signature: string | null = null;

	constructor(
		private readonly options: {
			loadPusher?: () => Promise<PusherModule>;
		} = {},
	) {}

	async subscribe(options: {
		config: PusherRealtimeConfig;
		channelName: string;
		lane: "edge" | "channel";
		authorize: ChannelAuthorizer;
	}): Promise<ManagedPusherSubscription> {
		if (
			options.lane === "channel" &&
			options.channelName.startsWith("private-questpie-rt-")
		) {
			throw new Error("Application channel collides with realtime namespace");
		}
		if (this.owners.has(options.channelName)) {
			throw new Error(`Pusher channel already owned: ${options.channelName}`);
		}

		const owner: ChannelOwner = { authorize: options.authorize };
		this.owners.set(options.channelName, owner);
		try {
			const pusher = await this.getPusher(options.config);
			if (this.owners.get(options.channelName) !== owner) {
				throw new Error("Pusher channel subscription was released");
			}
			const channel = pusher.subscribe(options.channelName);
			owner.channel = channel;
			let released = false;
			return {
				channel,
				release: () => {
					if (released) return;
					released = true;
					this.release(options.channelName, owner);
				},
			};
		} catch (error) {
			this.release(options.channelName, owner);
			throw error;
		}
	}

	private async getPusher(
		config: PusherRealtimeConfig,
	): Promise<InstanceType<PusherModule["default"]>> {
		const signature = connectionSignature(config);
		if (this.signature !== null && this.signature !== signature) {
			throw new Error(
				"Incompatible Pusher configuration for shared connection",
			);
		}
		if (this.pusher) return this.pusher;
		if (!this.pusherPromise) {
			this.signature = signature;
			this.pusherPromise = (async () => {
				const module = await (this.options.loadPusher?.() ??
					import("pusher-js"));
				const pusher = new module.default(config.key, {
					cluster: config.cluster ?? "mt1",
					...(config.wsHost ? { wsHost: config.wsHost } : {}),
					...(config.wsPort ? { wsPort: config.wsPort } : {}),
					...(config.wssPort ? { wssPort: config.wssPort } : {}),
					forceTLS: config.forceTLS ?? true,
					channelAuthorization: {
						customHandler: (request, callback) => {
							const owner = this.owners.get(request.channelName);
							if (!owner) {
								callback(
									new Error("Unknown framework channel authorization"),
									null,
								);
								return;
							}
							void owner
								.authorize(request.socketId, request.channelName)
								.then((auth) => callback(null, auth))
								.catch((error) => callback(normalizedError(error), null));
						},
					},
				});
				this.pusher = pusher;
				return pusher;
			})().catch((error) => {
				this.pusherPromise = null;
				this.signature = null;
				throw error;
			});
		}
		return this.pusherPromise;
	}

	private release(channelName: string, owner: ChannelOwner): void {
		if (this.owners.get(channelName) !== owner) return;
		owner.channel?.unbind();
		this.pusher?.unsubscribe(channelName);
		this.owners.delete(channelName);
		if (this.owners.size > 0) return;
		this.pusher?.disconnect();
		this.pusher = null;
		this.pusherPromise = null;
		this.signature = null;
	}
}
