import { describe, expect, mock, test } from "bun:test";

type FakePusherOptions = {
	channelAuthorization: {
		customHandler: (
			input: { socketId: string; channelName: string },
			callback: (error: Error | null, auth: unknown) => void,
		) => void;
	};
};

class FakeChannel {
	private readonly listeners = new Map<string, Set<(data: unknown) => void>>();
	memberInfos: unknown[] = [{ id: "member-1", roomId: "one" }];
	readonly members = {
		each: (callback: (member: { info: unknown }) => void) => {
			for (const info of this.memberInfos) callback({ info });
		},
	};

	bind(event: string, callback: (data: unknown) => void): this {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(callback);
		this.listeners.set(event, listeners);
		return this;
	}

	unbind(): this {
		this.listeners.clear();
		return this;
	}

	emit(event: string, data: unknown): void {
		for (const callback of this.listeners.get(event) ?? []) callback(data);
	}
}

class FakePusher {
	static instances: FakePusher[] = [];
	readonly channel = new FakeChannel();
	disconnected = false;

	constructor(
		readonly key: string,
		readonly options: FakePusherOptions,
	) {
		FakePusher.instances.push(this);
	}

	subscribe(channelName: string): FakeChannel {
		if (
			channelName.startsWith("private-") ||
			channelName.startsWith("presence-")
		) {
			this.options.channelAuthorization.customHandler(
				{ socketId: "123.456", channelName },
				(error) => {
					if (error) throw error;
				},
			);
		}
		return this.channel;
	}

	unsubscribe(): void {}

	disconnect(): void {
		this.disconnected = true;
	}
}

mock.module("pusher-js", () => ({ default: FakePusher }));

import { createClient } from "../../src/client/index.js";

async function waitFor(
	assertion: () => boolean,
	timeoutMs = 3000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("Timed out waiting for assertion");
}

describe("channels client", () => {
	test("subscribes and publishes through the SSE transport with fresh auth", async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		let authVersion = 0;
		const encoder = new TextEncoder();
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			requests.push({ url, init });
			expect(new Headers(init?.headers).get("Authorization")).toMatch(
				/^Bearer channel-/,
			);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "sse",
					channels: {
						news: { pattern: "news", visibility: "public" },
						room: {
							pattern: "room-[roomId]",
							visibility: "presence",
						},
					},
				});
			}
			if (url.endsWith("/realtime")) {
				const payload = JSON.parse(String(init?.body));
				if (payload.sessionId) return new Response(null, { status: 204 });
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						streamController = controller;
						controller.enqueue(
							encoder.encode(
								`event: session\ndata: ${JSON.stringify({ sessionId: "s1", token: "t1" })}\n\n`,
							),
						);
					},
				});
				return new Response(stream, {
					headers: { "Content-Type": "text/event-stream" },
				});
			}
			if (url.endsWith("/channels/publish")) {
				return Response.json({ eventId: "event-1" });
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
			getAuthHeaders: () => ({
				Authorization: `Bearer channel-${++authVersion}`,
			}),
		});
		const messages: unknown[] = [];
		const rosters: unknown[] = [];
		const errors: Error[] = [];
		const stop = client.channels.news.subscribe(
			(message: unknown) => messages.push(message),
			{ onError: (error: Error) => errors.push(error) },
		);
		const stopPresence = client.channels.room.subscribePresence(
			{ roomId: "one" },
			(members: unknown) => rosters.push(members),
			{ onError: (error: Error) => errors.push(error) },
		);

		await waitFor(() => !!streamController);
		streamController!.enqueue(
			encoder.encode(
				`event: channel_event\ndata: ${JSON.stringify({ type: "channel_event", channel: "news", event: "updated", eventId: "event-1", data: { title: "Hello" } })}\n\n`,
			),
		);
		await waitFor(() => messages.length === 1);
		expect(messages[0]).toEqual({
			event: "updated",
			eventId: "event-1",
			data: { title: "Hello" },
		});
		expect(errors).toHaveLength(0);
		streamController!.enqueue(
			encoder.encode(
				`event: channel_presence\ndata: ${JSON.stringify({ type: "channel_presence", channel: "presence-room-one", members: [{ id: "member-1" }] })}\n\n`,
			),
		);
		await waitFor(() => rosters.length === 1);
		expect(rosters).toEqual([[{ id: "member-1" }]]);
		streamController!.enqueue(
			encoder.encode(
				`event: channel_presence\ndata: ${JSON.stringify({ type: "channel_presence", channel: "presence-room-one", members: [{ id: "member-1" }] })}\n\n`,
			),
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(rosters).toHaveLength(1);

		await expect(
			client.channels.news.publish({
				event: "updated",
				data: { title: "Published" },
			}),
		).resolves.toEqual({ eventId: "event-1" });
		const publishRequest = requests.find(({ url }) =>
			url.endsWith("/channels/publish"),
		);
		expect(JSON.parse(String(publishRequest?.init?.body))).toEqual({
			channel: "news",
			params: {},
			event: "updated",
			data: { title: "Published" },
		});

		stopPresence();
		await waitFor(() =>
			requests.some(({ url, init }) => {
				if (!url.endsWith("/realtime")) return false;
				const payload = JSON.parse(String(init?.body));
				return payload.frames?.some(
					(frame: { type: string }) => frame.type === "unsubscribe_channel",
				);
			}),
		);
		const controlCount = requests.filter(({ url, init }) => {
			if (!url.endsWith("/realtime")) return false;
			return Boolean(JSON.parse(String(init?.body)).sessionId);
		}).length;
		stop();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(
			requests.filter(({ url, init }) => {
				if (!url.endsWith("/realtime")) return false;
				return Boolean(JSON.parse(String(init?.body)).sessionId);
			}).length,
		).toBe(controlCount);
		client.channels.destroy();
	});

	test("coalesces advertised v1 channel topology and closes the last channel locally", async () => {
		const controls: Array<{
			revision: number;
			channels: Array<{ id: string }>;
		}> = [];
		let streamReady = false;
		let aborted = false;
		const encoder = new TextEncoder();
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "sse",
					channels: {
						news: { pattern: "news", visibility: "public" },
						room: {
							pattern: "room-[roomId]",
							visibility: "public",
						},
					},
				});
			}
			if (url.endsWith("/realtime")) {
				const payload = JSON.parse(String(init?.body));
				if (payload.topology) {
					controls.push(payload.topology);
					return Response.json({ status: "accepted" }, { status: 202 });
				}
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						streamReady = true;
						controller.enqueue(
							encoder.encode(
								`event: session\ndata: ${JSON.stringify({
									sessionId: "channels-v1",
									token: "token-v1",
									control: {
										protocol: "questpie-realtime-topology",
										versions: [1],
									},
								})}\n\n`,
							),
						);
						init?.signal?.addEventListener("abort", () => {
							aborted = true;
							try {
								controller.close();
							} catch {}
						});
					},
				});
				return new Response(stream, {
					headers: { "Content-Type": "text/event-stream" },
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		const stopNews = client.channels.news.subscribe(() => {});
		await waitFor(() => streamReady);
		const stopOne = client.channels.room.subscribe({ roomId: "one" }, () => {});
		const stopTwo = client.channels.room.subscribe({ roomId: "two" }, () => {});
		await waitFor(() => controls.length === 1);
		expect(controls[0]).toMatchObject({ revision: 1 });
		expect(controls[0].channels).toHaveLength(3);

		stopOne();
		stopTwo();
		await waitFor(() => controls.length === 2);
		expect(controls[1]).toMatchObject({ revision: 2 });
		expect(controls[1].channels).toHaveLength(1);

		stopNews();
		await waitFor(() => aborted);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(controls).toHaveLength(2);
		client.channels.destroy();
	});

	test("subscribes to typed provider channels and exposes native presence", async () => {
		FakePusher.instances = [];
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		let token = 0;
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			requests.push({ url, init });
			expect(new Headers(init?.headers).get("Authorization")).toMatch(
				/^Bearer provider-/,
			);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key", cluster: "eu" },
					channels: {
						room: {
							pattern: "room-[roomId]",
							visibility: "presence",
						},
						signalRoom: {
							pattern: "signal-room-[signal]",
							visibility: "presence",
						},
					},
				});
			}
			if (url.endsWith("/channels/auth")) {
				return Response.json({ auth: "signed", channel_data: "{}" });
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
			getAuthHeaders: () => ({
				Authorization: `Bearer provider-${++token}`,
			}),
		});
		const messages: unknown[] = [];
		const rosters: unknown[] = [];
		const stop = client.channels.room.subscribe(
			{ roomId: "one" },
			(message: unknown) => messages.push(message),
		);
		const stopPresence = client.channels.room.subscribePresence(
			{ roomId: "one" },
			(members: unknown) => rosters.push(members),
		);

		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0];
		expect(provider.key).toBe("public-key");
		provider.channel.emit("questpie:channel", {
			eventId: "event-2",
			data: JSON.stringify({ event: "message", data: { text: "hello" } }),
		});
		await waitFor(() => messages.length === 1);
		expect(messages[0]).toEqual({
			event: "message",
			eventId: "event-2",
			data: { text: "hello" },
		});
		provider.channel.emit(
			"pusher:subscription_succeeded",
			provider.channel.members,
		);
		await waitFor(() => rosters.length === 1);
		expect(rosters[0]).toEqual([{ id: "member-1", roomId: "one" }]);
		provider.channel.memberInfos = [
			{ id: "member-1", roomId: "one" },
			{ id: "member-2", roomId: "one" },
		];
		provider.channel.emit("pusher:member_added", {});
		await waitFor(() => rosters.length === 2);
		expect(rosters[1]).toEqual([
			{ id: "member-1", roomId: "one" },
			{ id: "member-2", roomId: "one" },
		]);
		provider.channel.emit("pusher:member_added", {});
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(rosters).toHaveLength(2);
		await expect(
			client.channels.room.presence({ roomId: "one" }),
		).resolves.toEqual([
			{ id: "member-1", roomId: "one" },
			{ id: "member-2", roomId: "one" },
		]);
		const signalPresence = client.channels.signalRoom.presence({
			signal: "two",
		});
		await waitFor(() =>
			requests
				.filter(({ url }) => url.endsWith("/channels/auth"))
				.map(({ init }) => JSON.parse(String(init?.body)))
				.some(({ channel }) => channel === "signalRoom"),
		);
		provider.channel.emit(
			"pusher:subscription_succeeded",
			provider.channel.members,
		);
		await expect(signalPresence).resolves.toEqual([
			{ id: "member-1", roomId: "one" },
			{ id: "member-2", roomId: "one" },
		]);
		await waitFor(() =>
			requests.some(({ url }) => url.endsWith("/channels/auth")),
		);
		expect(
			JSON.parse(
				String(
					requests.find(({ url }) => url.endsWith("/channels/auth"))?.init
						?.body,
				),
			),
		).toEqual({
			socketId: "123.456",
			channelName: "presence-room-one",
			channel: "room",
			params: { roomId: "one" },
		});
		expect(
			requests
				.filter(({ url }) => url.endsWith("/channels/auth"))
				.map(({ init }) => JSON.parse(String(init?.body))),
		).toContainEqual({
			socketId: "123.456",
			channelName: "presence-signal-room-two",
			channel: "signalRoom",
			params: { signal: "two" },
		});

		stopPresence();
		stop();
		client.channels.destroy();
		expect(provider.disconnected).toBe(true);
	});
});
