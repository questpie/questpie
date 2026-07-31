import { describe, expect, test } from "bun:test";

import {
	PusherConnectionManager,
	type PusherModule,
} from "../../src/client/realtime/pusher-connection.js";

type Authorizer = (
	input: { socketId: string; channelName: string },
	callback: (error: Error | null, auth: unknown) => void,
) => void;

type UserAuthenticator = (
	input: { socketId: string },
	callback: (error: Error | null, auth: unknown) => void,
) => void;

class FakeChannel {
	unbound = false;

	bind(): this {
		return this;
	}

	unbind(): this {
		this.unbound = true;
		return this;
	}
}

class FakePusher {
	readonly channels = new Map<string, FakeChannel>();
	readonly unsubscribed: string[] = [];
	readonly user: {
		signinDonePromise: Promise<unknown>;
		user_data: { id: string } | null;
	} = {
		signinDonePromise: Promise.resolve(),
		user_data: { id: "opaque-user" },
	};
	readonly connection = {
		state: "connected",
		socket_id: "1.2",
	};
	disconnected = false;
	signinCalls = 0;

	constructor(
		readonly key: string,
		readonly options: {
			channelAuthorization: { customHandler: Authorizer };
			userAuthentication?: { customHandler: UserAuthenticator };
		},
	) {}

	subscribe(name: string): FakeChannel {
		const channel = new FakeChannel();
		this.channels.set(name, channel);
		return channel;
	}

	unsubscribe(name: string): void {
		this.unsubscribed.push(name);
	}

	disconnect(): void {
		this.disconnected = true;
	}

	signin(): void {
		this.signinCalls += 1;
	}
}

function managerFixture() {
	class CapturingFakePusher extends FakePusher {
		static latest: FakePusher | undefined;

		constructor(
			key: string,
			options: ConstructorParameters<typeof FakePusher>[1],
		) {
			super(key, options);
			CapturingFakePusher.latest = this;
		}
	}
	const manager = new PusherConnectionManager({
		loadPusher: async () =>
			({
				default: CapturingFakePusher,
			}) as unknown as PusherModule,
	});
	return { manager, getPusher: () => CapturingFakePusher.latest };
}

function authorize(
	pusher: FakePusher,
	channelName: string,
): Promise<{ error: Error | null; auth: unknown }> {
	return new Promise((resolve) => {
		pusher.options.channelAuthorization.customHandler(
			{ socketId: "1.2", channelName },
			(error, auth) => resolve({ error, auth }),
		);
	});
}

function authenticateUser(
	pusher: FakePusher,
	socketId: string,
): Promise<{ error: Error | null; auth: unknown }> {
	return new Promise((resolve) => {
		pusher.options.userAuthentication!.customHandler(
			{ socketId },
			(error, auth) => resolve({ error, auth }),
		);
	});
}

describe("PusherConnectionManager", () => {
	test("signs in once and resolves user auth through a currently live shared owner", async () => {
		const fixture = managerFixture();
		const first = await fixture.manager.subscribe({
			config: {
				provider: "pusher",
				key: "key",
				userAuthentication: true,
			},
			channelName: "private-questpie-rt-session",
			lane: "edge",
			authorize: async () => ({ auth: "edge" }),
			authenticateUser: async (socketId) => ({
				auth: `first:${socketId}`,
				user_data: '{"id":"opaque-first"}',
			}),
		});
		const second = await fixture.manager.subscribe({
			config: {
				provider: "pusher",
				key: "key",
				userAuthentication: true,
			},
			channelName: "private-room-one",
			lane: "channel",
			authorize: async () => ({ auth: "application" }),
			authenticateUser: async (socketId) => ({
				auth: `second:${socketId}`,
				user_data: '{"id":"opaque-second"}',
			}),
		});
		const pusher = fixture.getPusher()!;

		expect(pusher.signinCalls).toBe(1);
		expect(await authenticateUser(pusher, "1.2")).toEqual({
			error: null,
			auth: {
				auth: "first:1.2",
				user_data: '{"id":"opaque-first"}',
			},
		});

		first.release();
		expect(await authenticateUser(pusher, "3.4")).toEqual({
			error: null,
			auth: {
				auth: "second:3.4",
				user_data: '{"id":"opaque-second"}',
			},
		});
		expect(pusher.signinCalls).toBe(1);
		second.release();
	});

	test("dispatches authorization by exact channel name and rejects unknown names", async () => {
		const fixture = managerFixture();
		const edge = await fixture.manager.subscribe({
			config: { provider: "pusher", key: "key" },
			channelName: "private-questpie-rt-session",
			lane: "edge",
			authorize: async () => ({ auth: "edge" }),
		});
		const application = await fixture.manager.subscribe({
			config: { provider: "pusher", key: "key" },
			channelName: "private-room-one",
			lane: "channel",
			authorize: async () => ({ auth: "application" }),
		});
		const pusher = fixture.getPusher()!;

		expect(await authorize(pusher, "private-questpie-rt-session")).toEqual({
			error: null,
			auth: { auth: "edge" },
		});
		expect(await authorize(pusher, "private-room-one")).toEqual({
			error: null,
			auth: { auth: "application" },
		});
		const unknown = await authorize(pusher, "private-room-two");
		expect(unknown.error?.message).toBe(
			"Unknown framework channel authorization",
		);
		expect(unknown.auth).toBeNull();

		edge.release();
		expect(pusher.disconnected).toBe(false);
		application.release();
		expect(pusher.disconnected).toBe(true);
	});

	test("waits for physical-connection user sign-in before authorizing a channel", async () => {
		const fixture = managerFixture();
		let authorizationCalls = 0;
		const application = await fixture.manager.subscribe({
			config: {
				provider: "pusher",
				key: "key",
				userAuthentication: true,
			},
			channelName: "private-room-one",
			lane: "channel",
			authorize: async () => {
				authorizationCalls += 1;
				return { auth: "application" };
			},
			authenticateUser: async () => ({
				auth: "user",
				user_data: '{"id":"opaque-user"}',
			}),
		});
		const presence = await fixture.manager.subscribe({
			config: {
				provider: "pusher",
				key: "key",
				userAuthentication: true,
			},
			channelName: "presence-room-two",
			lane: "channel",
			authorize: async () => {
				authorizationCalls += 1;
				return { auth: "presence" };
			},
			authenticateUser: async () => ({
				auth: "user",
				user_data: '{"id":"opaque-user"}',
			}),
		});
		const pusher = fixture.getPusher()!;
		let finishSignin!: () => void;
		pusher.user.user_data = null;
		pusher.user.signinDonePromise = new Promise<void>((resolve) => {
			finishSignin = resolve;
		});

		const pendingAuthorization = authorize(pusher, "private-room-one");
		const pendingPresenceAuthorization = authorize(pusher, "presence-room-two");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(authorizationCalls).toBe(0);

		pusher.user.user_data = { id: "opaque-user" };
		finishSignin();
		expect(await pendingAuthorization).toEqual({
			error: null,
			auth: { auth: "application" },
		});
		expect(await pendingPresenceAuthorization).toEqual({
			error: null,
			auth: { auth: "presence" },
		});
		expect(authorizationCalls).toBe(2);
		application.release();
		presence.release();
	});

	test("fails closed when sign-in fails or the authorizing socket is stale", async () => {
		const failedSignin = managerFixture();
		const failedSubscription = await failedSignin.manager.subscribe({
			config: {
				provider: "pusher",
				key: "key",
				userAuthentication: true,
			},
			channelName: "private-room-one",
			lane: "channel",
			authorize: async () => ({ auth: "must-not-run" }),
			authenticateUser: async () => ({
				auth: "user",
				user_data: '{"id":"opaque-user"}',
			}),
		});
		const failedPusher = failedSignin.getPusher()!;
		failedPusher.user.user_data = null;
		failedPusher.user.signinDonePromise = Promise.resolve();
		expect(
			(await authorize(failedPusher, "private-room-one")).error?.message,
		).toBe("Realtime user authentication did not complete");
		failedSubscription.release();

		const staleSocket = managerFixture();
		const staleSubscription = await staleSocket.manager.subscribe({
			config: {
				provider: "pusher",
				key: "key",
				userAuthentication: true,
			},
			channelName: "private-room-one",
			lane: "channel",
			authorize: async () => ({ auth: "must-not-run" }),
			authenticateUser: async () => ({
				auth: "user",
				user_data: '{"id":"opaque-user"}',
			}),
		});
		const stalePusher = staleSocket.getPusher()!;
		stalePusher.connection.socket_id = "3.4";
		expect(
			(await authorize(stalePusher, "private-room-one")).error?.message,
		).toBe("Realtime channel authorization socket is stale");
		staleSubscription.release();
	});

	test("fails a channel auth waiter whose owner is released during sign-in", async () => {
		const fixture = managerFixture();
		let authorizationCalls = 0;
		const application = await fixture.manager.subscribe({
			config: {
				provider: "pusher",
				key: "key",
				userAuthentication: true,
			},
			channelName: "private-room-one",
			lane: "channel",
			authorize: async () => {
				authorizationCalls += 1;
				return { auth: "must-not-run" };
			},
			authenticateUser: async () => ({
				auth: "user",
				user_data: '{"id":"opaque-user"}',
			}),
		});
		const pusher = fixture.getPusher()!;
		let finishSignin!: () => void;
		pusher.user.user_data = null;
		pusher.user.signinDonePromise = new Promise<void>((resolve) => {
			finishSignin = resolve;
		});
		const pendingAuthorization = authorize(pusher, "private-room-one");

		application.release();
		pusher.user.user_data = { id: "opaque-user" };
		finishSignin();
		expect((await pendingAuthorization).error?.message).toBe(
			"Realtime channel authorization owner was released",
		);
		expect(authorizationCalls).toBe(0);
	});

	test("fails closed on reserved application names and incompatible providers", async () => {
		const fixture = managerFixture();
		await expect(
			fixture.manager.subscribe({
				config: { provider: "pusher", key: "key" },
				channelName: "private-questpie-rt-forged",
				lane: "channel",
				authorize: async () => ({ auth: "forged" }),
			}),
		).rejects.toThrow("collides with realtime namespace");

		const first = await fixture.manager.subscribe({
			config: { provider: "pusher", key: "key", cluster: "eu" },
			channelName: "private-room-one",
			lane: "channel",
			authorize: async () => ({ auth: "one" }),
		});
		await expect(
			fixture.manager.subscribe({
				config: { provider: "pusher", key: "other-key", cluster: "eu" },
				channelName: "private-room-two",
				lane: "channel",
				authorize: async () => ({ auth: "two" }),
			}),
		).rejects.toThrow("Incompatible Pusher configuration");
		first.release();
	});
});
