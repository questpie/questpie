export type PusherRealtimeConfig = {
	provider: "pusher";
	key: string;
	cluster?: string;
	wsHost?: string;
	wsPort?: number;
	wssPort?: number;
	forceTLS?: boolean;
	authEndpoint?: string;
	userAuthentication?: boolean;
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

type UserAuthenticator = (socketId: string) => Promise<{
	auth: string;
	user_data: string;
}>;

type ChannelOwner = {
	authorize: ChannelAuthorizer;
	authenticateUser?: UserAuthenticator;
	onConnectionEpochEnd?: () => void;
	channel?: PusherChannel;
};

export type ManagedPusherSubscription = {
	channel: PusherChannel;
	isConnectionActive(): boolean;
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
		userAuthentication: config.userAuthentication === true,
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
		authenticateUser?: UserAuthenticator;
		onConnectionEpochEnd?: () => void;
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

		const owner: ChannelOwner = {
			authorize: options.authorize,
			authenticateUser: options.authenticateUser,
			onConnectionEpochEnd: options.onConnectionEpochEnd,
		};
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
				isConnectionActive: () => pusher.connection.state === "connected",
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
							void (async () => {
								if (config.userAuthentication === true) {
									const assertCurrentSignedInConnection = () => {
										if (this.owners.get(request.channelName) !== owner) {
											throw new Error(
												"Realtime channel authorization owner was released",
											);
										}
										if (
											pusher.connection.state !== "connected" ||
											pusher.connection.socket_id !== request.socketId
										) {
											throw new Error(
												"Realtime channel authorization socket is stale",
											);
										}
										if (
											typeof pusher.user.user_data?.id !== "string" ||
											pusher.user.user_data.id.length === 0
										) {
											throw new Error(
												"Realtime user authentication did not complete",
											);
										}
									};
									const signinDone = pusher.user.signinDonePromise;
									if (!signinDone) {
										throw new Error(
											"Realtime user authentication has not started",
										);
									}
									await signinDone;
									assertCurrentSignedInConnection();
									const auth = await owner.authorize(
										request.socketId,
										request.channelName,
									);
									assertCurrentSignedInConnection();
									return auth;
								}
								return owner.authorize(request.socketId, request.channelName);
							})()
								.then((auth) => callback(null, auth))
								.catch((error) => callback(normalizedError(error), null));
						},
					},
					...(config.userAuthentication === true
						? {
								userAuthentication: {
									customHandler: (request, callback) => {
										const owner = [...this.owners.values()].find(
											(candidate) => candidate.authenticateUser,
										);
										if (!owner?.authenticateUser) {
											callback(
												new Error(
													"Realtime user authentication is unavailable",
												),
												null,
											);
											return;
										}
										void owner
											.authenticateUser(request.socketId)
											.then((auth) => callback(null, auth))
											.catch((error) => callback(normalizedError(error), null));
									},
								},
							}
						: {}),
				});
				pusher.connection.bind("state_change", (change: unknown) => {
					if (this.pusher !== pusher) return;
					if (!isConnectionEpochEnd(change)) return;
					for (const owner of this.owners.values()) {
						try {
							owner.onConnectionEpochEnd?.();
						} catch {
							// One transport owner cannot suppress the epoch fence for siblings.
						}
					}
				});
				if (config.userAuthentication === true) pusher.signin();
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

function isConnectionEpochEnd(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const change = value as { previous?: unknown; current?: unknown };
	return change.previous === "connected" && change.current !== "connected";
}
