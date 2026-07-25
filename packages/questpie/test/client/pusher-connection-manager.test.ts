import { describe, expect, test } from "bun:test";

import {
	PusherConnectionManager,
	type PusherModule,
} from "../../src/client/realtime/pusher-connection.js";

type Authorizer = (
	input: { socketId: string; channelName: string },
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
	disconnected = false;

	constructor(
		readonly key: string,
		readonly options: {
			channelAuthorization: { customHandler: Authorizer };
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

describe("PusherConnectionManager", () => {
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
