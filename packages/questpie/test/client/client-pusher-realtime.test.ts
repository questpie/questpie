import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type FakePusherOptions = {
	channelAuthorization: {
		customHandler: (
			input: { socketId: string; channelName: string },
			callback: (error: Error | null, auth: unknown) => void,
		) => void;
	};
};

class FakeChannel {
	private listeners = new Map<string, Set<(data: unknown) => void>>();

	bind(event: string, callback: (data: unknown) => void): this {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(callback);
		this.listeners.set(event, listeners);
		return this;
	}

	unbind(event?: string, callback?: (data: unknown) => void): this {
		if (!event) this.listeners.clear();
		else if (!callback) this.listeners.delete(event);
		else this.listeners.get(event)?.delete(callback);
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
		this.options.channelAuthorization.customHandler(
			{ socketId: "123.456", channelName },
			(error) => {
				if (error) throw error;
			},
		);
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

describe("Pusher realtime client transport", () => {
	let requests: Array<{ url: string; init?: RequestInit }>;
	let snapshotVersion: number;
	let authVersion: number;

	beforeEach(() => {
		requests = [];
		snapshotVersion = 0;
		authVersion = 0;
		FakePusher.instances = [];
	});

	afterEach(() => {
		mock.restore();
	});

	test("keeps collections.live transport-agnostic and refetches on private invalidation", async () => {
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			requests.push({ url, init });
			expect(new Headers(init?.headers).get("Authorization")).toMatch(
				/^Bearer token-/,
			);
			if (url.endsWith("/realtime/config")) {
				return Response.json({
					transport: "shared-provider",
					config: {
						provider: "pusher",
						key: "public-key",
						cluster: "eu",
						authEndpoint: "realtime/auth",
					},
				});
			}
			if (url.endsWith("/realtime/auth")) {
				expect(init?.headers).toMatchObject({
					Authorization: expect.stringMatching(/^Bearer token-/),
					"Content-Type": "application/x-www-form-urlencoded",
				});
				return Response.json({ auth: "signed" });
			}
			if (url.endsWith("/realtime") && init?.method === "POST") {
				const body = JSON.parse(String(init.body));
				if (body.transport === "shared-provider") {
					return Response.json({
						transport: "shared-provider",
						sessionId: "session-1",
						token: "control-1",
						channel: "private-questpie-rt-session-1",
					});
				}
				return new Response(null, { status: 204 });
			}
			if (url.startsWith("http://localhost:3000/posts")) {
				snapshotVersion += 1;
				return Response.json({
					docs: [{ id: String(snapshotVersion) }],
					totalDocs: 1,
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
			getAuthHeaders: () => ({
				Authorization: `Bearer token-${++authVersion}`,
			}),
		});
		const snapshots: unknown[] = [];
		const errors: Error[] = [];
		const stop = client.collections.posts.live(
			{ where: { published: true } },
			(snapshot) => snapshots.push(snapshot),
			{ onError: (error) => errors.push(error) },
		);

		await waitFor(
			() => snapshots.length === 1 && FakePusher.instances.length === 1,
		);
		expect(FakePusher.instances[0].key).toBe("public-key");
		expect(snapshots[0]).toEqual({
			docs: [{ id: "1" }],
			totalDocs: 1,
		});
		expect(errors).toHaveLength(0);

		FakePusher.instances[0].channel.emit("questpie:invalidate", {
			sessionId: "session-1",
		});
		await waitFor(() => snapshots.length === 2);
		expect(snapshots[1]).toEqual({
			docs: [{ id: "2" }],
			totalDocs: 1,
		});

		stop();
		await waitFor(() =>
			requests.some(({ url, init }) => {
				if (!url.endsWith("/realtime") || init?.method !== "POST") return false;
				const body = JSON.parse(String(init.body));
				return body.frames?.some(
					(frame: { type: string }) => frame.type === "remove_topic",
				);
			}),
		);
		client.realtime.destroy();
		expect(FakePusher.instances[0].disconnected).toBe(true);
		expect(authVersion).toBeGreaterThanOrEqual(4);
	});

	test("flushes the newest desired topology and closes the final server session", async () => {
		const controls: Array<{
			revision: number;
			topics: Array<{ id: string }>;
		}> = [];
		let releaseFirstControl!: () => void;
		const firstControlGate = new Promise<void>((resolve) => {
			releaseFirstControl = resolve;
		});
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/realtime/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key" },
				});
			}
			if (url.endsWith("/realtime/auth")) {
				return Response.json({ auth: "signed" });
			}
			if (url.endsWith("/realtime") && init?.method === "POST") {
				const body = JSON.parse(String(init.body));
				if (body.transport === "shared-provider") {
					return Response.json({
						transport: "shared-provider",
						sessionId: "session-v1",
						token: "control-v1",
						channel: "private-questpie-rt-session-v1",
						control: {
							protocol: "questpie-realtime-topology",
							versions: [1],
						},
					});
				}
				if (body.topology) {
					controls.push(body.topology);
					if (controls.length === 1) await firstControlGate;
					return Response.json({ status: "accepted" }, { status: 202 });
				}
			}
			if (url.includes("/posts") || url.includes("/pages")) {
				return Response.json({ docs: [], totalDocs: 0 });
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		const errors: Error[] = [];
		let postSnapshots = 0;
		const stopPosts = client.collections.posts.live(
			{},
			() => {
				postSnapshots += 1;
			},
			{ onError: (error) => errors.push(error) },
		);
		await waitFor(
			() => FakePusher.instances.length === 1 && postSnapshots === 1,
		);
		const stopPages = client.collections.pages.live({}, () => {}, {
			onError: (error) => errors.push(error),
		});
		await waitFor(() => controls.length === 1 || errors.length > 0);
		expect(errors).toHaveLength(0);
		expect(controls[0].topics.map((topic) => topic.id)).toHaveLength(2);

		stopPages();
		releaseFirstControl();
		await waitFor(() => controls.length === 2);
		expect(controls[1]).toMatchObject({ revision: 2 });
		expect(controls[1].topics).toHaveLength(1);

		stopPosts();
		await waitFor(() => controls.length === 3);
		expect(controls[2]).toEqual({
			protocol: "questpie-realtime-topology",
			version: 1,
			revision: 3,
			topics: [],
			channels: [],
		});
		await waitFor(() => FakePusher.instances[0].disconnected);
		client.realtime.destroy();
	});
});
