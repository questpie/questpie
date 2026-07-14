import { describe, expect, test } from "bun:test";

import Pusher from "pusher";
import PusherJs, {
	type ChannelAuthorizationHandler,
	type Channel,
} from "pusher-js";

import { pusherRealtime } from "../../src/exports/adapters/pusher.js";

const runSoketi = process.env.QUESTPIE_SOKETI_INTEGRATION === "1";
const PusherJsConstructor =
	(PusherJs as unknown as { Pusher?: typeof PusherJs }).Pusher ?? PusherJs;
const credentials = {
	appId: "questpie-test",
	key: "questpie-test-key",
	secret: "questpie-test-secret",
	host: "127.0.0.1",
	port: 6001,
	useTLS: false,
};

function timeout<T>(promise: Promise<T>, message: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(message)), 5000),
		),
	]);
}

function rawClient(server: Pusher): PusherJs {
	const authorize: ChannelAuthorizationHandler = (params, callback) => {
		callback(
			null,
			server.authorizeChannel(params.socketId, params.channelName),
		);
	};
	return new PusherJsConstructor(credentials.key, {
		cluster: "mt1",
		forceTLS: false,
		wsHost: credentials.host,
		wsPort: credentials.port,
		enabledTransports: ["ws"],
		channelAuthorization: { customHandler: authorize },
	});
}

function subscribed(channel: Channel): Promise<void> {
	return timeout(
		new Promise((resolve, reject) => {
			channel.bind("pusher:subscription_succeeded", () => resolve());
			channel.bind("pusher:subscription_error", reject);
		}),
		"Soketi subscription timed out",
	);
}

describe.skipIf(!runSoketi)("soketi pusher transport conformance", () => {
	test("delivers a notice wake between application instances", async () => {
		const receiver = pusherRealtime(credentials).changeBroker;
		const publisher = pusherRealtime(credentials).changeBroker;
		const received = timeout(
			new Promise<void>((resolve) => {
				void receiver.start({
					onWake: (wake) => {
						if (wake.reason === "publish" && wake.highWaterSeq === 42)
							resolve();
					},
					onError: () => {},
				});
			}),
			"Soketi notice delivery timed out",
		);
		await publisher.start({ onWake: () => {}, onError: () => {} });
		await new Promise((resolve) => setTimeout(resolve, 100));
		await publisher.publish({
			kind: "outbox-maybe-advanced",
			highWaterSeq: 42,
			reason: "publish",
		});

		await received;
		await Promise.all([receiver.stop(), publisher.stop()]);
	});

	test("raw hostile client proves SDK channel allowlists are not authorization", async () => {
		const server = new Pusher({
			appId: credentials.appId,
			key: credentials.key,
			secret: credentials.secret,
			host: credentials.host,
			port: String(credentials.port),
			useTLS: false,
		});
		const hostile = rawClient(server);
		const receiver = rawClient(server);
		const channelName = "private-not-in-framework-allowlist";
		const hostileChannel = hostile.subscribe(channelName);
		const receiverChannel = receiver.subscribe(channelName);
		const event = timeout(
			new Promise<{ attack: boolean }>((resolve) => {
				receiverChannel.bind("client-hostile", resolve);
			}),
			"Hostile client event was not delivered",
		);

		await Promise.all([
			subscribed(hostileChannel),
			subscribed(receiverChannel),
		]);
		expect(hostileChannel.trigger("client-hostile", { attack: true })).toBe(
			true,
		);
		expect(await event).toEqual({ attack: true });

		hostile.disconnect();
		receiver.disconnect();
	});
});
