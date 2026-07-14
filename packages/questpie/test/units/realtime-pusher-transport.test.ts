import { describe, expect, spyOn, test } from "bun:test";

import {
	PusherChangeBroker,
	PusherClientTransport,
	assertPusherChannelName,
	type PusherProvider,
	type PusherSubscriber,
} from "#questpie/server/modules/core/integrated/realtime/pusher-transport.js";
import { RealtimeService } from "#questpie/server/modules/core/integrated/realtime/service.js";
import type {
	ChangeBroker,
	ChangeBrokerState,
	ChangeWake,
} from "#questpie/server/modules/core/integrated/realtime/transport.js";
import type { RealtimeChangeEvent } from "#questpie/server/modules/core/integrated/realtime/types.js";

type Trigger = {
	channel: string;
	event: string;
	data: unknown;
};

function createProvider() {
	const triggers: Trigger[] = [];
	const provider: PusherProvider = {
		trigger: async (channel, event, data) => {
			triggers.push({ channel, event, data });
		},
		authorizeChannel: (socketId, channel, presence) => ({
			auth: `${socketId}:${channel}`,
			...(presence ? { channel_data: JSON.stringify(presence) } : {}),
		}),
		authenticateUser: (socketId, user) => ({
			auth: `${socketId}:${user.id}`,
			user_data: JSON.stringify(user),
		}),
		terminateUserConnections: async () => {},
		getPresenceMemberCount: async () => 0,
	};
	return { provider, triggers };
}

function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

class DroppingChangeBroker implements ChangeBroker {
	started = false;
	published: ChangeWake[] = [];
	private onWake: (wake: ChangeWake) => void = () => {};
	private onStateChange: (state: ChangeBrokerState) => void = () => {};

	async start(input: {
		onWake: (wake: ChangeWake) => void;
		onError: (error: unknown) => void;
		onStateChange?: (state: ChangeBrokerState) => void;
	}): Promise<void> {
		this.started = true;
		this.onWake = input.onWake;
		this.onStateChange = input.onStateChange ?? (() => {});
	}

	async publish(wake: ChangeWake): Promise<void> {
		this.published.push(wake);
		// Accepted but intentionally lost before any subscriber observes it.
	}

	emit(wake: ChangeWake): void {
		this.onWake(wake);
	}

	emitState(state: ChangeBrokerState): void {
		this.onStateChange(state);
	}

	async stop(): Promise<void> {}
}

class RealtimeReadDb {
	rows: RealtimeChangeEvent[] = [];

	select(selection?: unknown) {
		const latestOnly =
			selection !== undefined &&
			typeof selection === "object" &&
			selection !== null &&
			Object.keys(selection).length === 1;
		const query = {
			from: () => query,
			where: () => query,
			orderBy: () => query,
			limit: async () =>
				latestOnly
					? this.rows.at(-1)
						? [{ seq: this.rows.at(-1)!.seq }]
						: []
					: this.rows,
		};
		return query;
	}
}

describe("pusher channel matrix change broker", () => {
	test("coalesces notice-only wakes and emits a reconcile wake after reconnect", async () => {
		const { provider, triggers } = createProvider();
		let onMessage: ((value: unknown) => void) | undefined;
		let onStateChange: ((state: string) => void) | undefined;
		const subscriber: PusherSubscriber = {
			start: async (input) => {
				onMessage = input.onMessage;
				onStateChange = input.onStateChange;
			},
			stop: async () => {},
		};
		const wakes: unknown[] = [];
		const states: string[] = [];
		const broker = new PusherChangeBroker({
			provider,
			subscriber,
			channel: "questpie-broker-test",
		});

		await broker.start({
			onWake: (wake) => wakes.push(wake),
			onError: () => {},
			onStateChange: (state) => states.push(state),
		});
		const first = broker.publish({
			kind: "outbox-maybe-advanced",
			highWaterSeq: 10,
			reason: "publish",
		});
		const second = broker.publish({
			kind: "outbox-maybe-advanced",
			highWaterSeq: 11,
			reason: "publish",
		});
		await Promise.all([first, second]);

		expect(triggers).toHaveLength(1);
		expect(triggers[0]?.data).toEqual({
			kind: "outbox-maybe-advanced",
			highWaterSeq: 11,
			reason: "publish",
		});

		onMessage?.({
			kind: "outbox-maybe-advanced",
			highWaterSeq: 12,
			reason: "publish",
			snapshot: "must be stripped",
		});
		onStateChange?.("connected");
		expect(wakes).toEqual([
			{
				kind: "outbox-maybe-advanced",
				highWaterSeq: 12,
				reason: "publish",
			},
			{
				kind: "outbox-maybe-advanced",
				reason: "reconnect",
			},
		]);
		expect(states).toEqual(["connected"]);
	});

	test("reports provider failures while publish remains off the caller path", async () => {
		const errors: unknown[] = [];
		const provider = createProvider().provider;
		provider.trigger = async () => {
			throw new Error("provider unavailable");
		};
		const broker = new PusherChangeBroker({
			provider,
			subscriber: { start: async () => {}, stop: async () => {} },
			channel: "questpie-broker-test",
		});
		await broker.start({
			onWake: () => {},
			onError: (error) => errors.push(error),
		});

		const pending = broker.publish({
			kind: "outbox-maybe-advanced",
			reason: "publish",
		});
		expect(errors).toHaveLength(0);
		await expect(pending).rejects.toThrow("provider unavailable");
		expect(errors).toHaveLength(1);
	});

	test("pusher notice loss heals from the durable outbox poll", async () => {
		const broker = new DroppingChangeBroker();
		const db = new RealtimeReadDb();
		let poll: (() => void) | undefined;
		const intervalSpy = spyOn(globalThis, "setInterval").mockImplementation(
			(handler, delay) => {
				if (delay === 25_000) {
					poll = () => {
						if (typeof handler === "function") handler();
					};
				}
				return 1 as unknown as ReturnType<typeof setInterval>;
			},
		);
		const realtime = new RealtimeService(db as never, {
			changeBroker: broker,
			pollIntervalMs: 25_000,
			retentionDays: 0,
		});
		try {
			const delivered: RealtimeChangeEvent[] = [];
			realtime.subscribe((event) => delivered.push(event), {
				resourceType: "collection",
				resource: "posts",
			});
			await tick();
			const change: RealtimeChangeEvent = {
				seq: 1,
				resourceType: "collection",
				resource: "posts",
				operation: "create",
				recordId: "post-1",
				locale: null,
				payload: {},
				createdAt: new Date(),
			};
			db.rows = [change];
			await realtime.notify(change);
			expect(delivered).toEqual([]);
			expect(broker.published).toEqual([
				{
					kind: "outbox-maybe-advanced",
					highWaterSeq: 1,
					reason: "publish",
				},
			]);

			poll?.();
			await tick();
			expect(delivered).toEqual([change]);
		} finally {
			intervalSpy.mockRestore();
			await realtime.destroy();
		}
	});

	test("pusher unavailable state escalates reconciliation cadence", async () => {
		const broker = new DroppingChangeBroker();
		const delays: number[] = [];
		const intervalSpy = spyOn(globalThis, "setInterval").mockImplementation(
			(_handler, delay) => {
				delays.push(Number(delay));
				return delays.length as unknown as ReturnType<typeof setInterval>;
			},
		);
		const realtime = new RealtimeService(new RealtimeReadDb() as never, {
			changeBroker: broker,
			pollIntervalMs: 15_000,
			retentionDays: 0,
		});
		try {
			realtime.subscribe(() => {}, {
				resourceType: "collection",
				resource: "posts",
			});
			await tick();
			broker.emitState("unavailable");
			expect(delays).toEqual([15_000, 2000]);
			broker.emitState("connected");
			expect(delays).toEqual([15_000, 2000, 15_000]);
		} finally {
			intervalSpy.mockRestore();
			await realtime.destroy();
		}
	});
});

describe("pusher channel matrix client delivery", () => {
	test("validates final provider names at the 164-character boundary", () => {
		expect(() => assertPusherChannelName("a".repeat(164))).not.toThrow();
		expect(() => assertPusherChannelName("a".repeat(165))).toThrow("1-164");
		expect(() => assertPusherChannelName("private-chat/room")).toThrow(
			"provider-safe",
		);
	});

	test("coalesces private invalidations without leaking snapshot bytes", async () => {
		const { provider, triggers } = createProvider();
		const transport = new PusherClientTransport({
			provider,
			key: "public-key",
			identityKey: "test-secret",
		});
		await transport.start({ onError: () => {} });
		const principal = {
			kind: "user" as const,
			user: { id: "user-1" } as any,
			session: { id: "session-1" } as any,
		};
		const sink = await transport.openSession({
			sessionId: "018f1d92-7ab0-7d68-a230-000000000001",
			principal,
			resolvePrincipal: async () => principal,
		});

		await Promise.all([
			sink.write(
				new TextEncoder().encode("TOP SECRET SNAPSHOT A"),
				"latest-snapshot",
			),
			sink.write(
				new TextEncoder().encode("TOP SECRET SNAPSHOT B"),
				"latest-snapshot",
			),
		]);
		await tick();

		expect(triggers).toHaveLength(1);
		expect(triggers[0]?.channel.startsWith("private-questpie-rt-")).toBe(true);
		expect(triggers[0]?.event).toBe("questpie:invalidate");
		const serialized = JSON.stringify(triggers[0]?.data);
		expect(serialized).not.toContain("TOP SECRET");
		expect(serialized).not.toContain("SNAPSHOT");
		await expect(
			sink.write(new Uint8Array(), "ordered-channel-event"),
		).rejects.toThrow("publishChannel");
	});

	test("maps one ordered publish call to exactly one provider publish", async () => {
		const { provider, triggers } = createProvider();
		const transport = new PusherClientTransport({
			provider,
			key: "public-key",
			identityKey: "test-secret",
		});
		await transport.start({ onError: () => {} });

		const result = await transport.publishChannel({
			channel: "private-chat-room-123",
			eventId: "event-1",
			frame: new TextEncoder().encode('{"message":"hello"}'),
		});

		expect(result).toEqual({ status: "accepted", bufferedBytes: null });
		expect(triggers).toEqual([
			{
				channel: "private-chat-room-123",
				event: "questpie:channel",
				data: { eventId: "event-1", data: '{"message":"hello"}' },
			},
		]);
	});

	test("binds channel auth to an active session and its current principal", async () => {
		const { provider } = createProvider();
		const transport = new PusherClientTransport({
			provider,
			key: "public-key",
			identityKey: "test-secret",
		});
		const principal = {
			kind: "user" as const,
			user: { id: "user-1" } as any,
			session: { id: "session-1" } as any,
		};
		const sink = await transport.openSession({
			sessionId: "018f1d92-7ab0-7d68-a230-000000000001",
			principal,
			resolvePrincipal: async () => principal,
		});
		const channel = transport.getSessionChannel(sink.sessionId);

		await expect(
			transport.generateAuth({ socketId: "123.456", channel, principal }),
		).resolves.toEqual({ auth: `123.456:${channel}` });
		await expect(
			transport.generateAuth({
				socketId: "123.456",
				channel,
				principal: { ...principal, session: { id: "other" } as any },
			}),
		).rejects.toThrow("not authorized");
		await sink.close("normal");
		await expect(
			transport.generateAuth({ socketId: "123.456", channel, principal }),
		).rejects.toThrow("not authorized");
	});

	test("keeps secrets out of config and requires the provider-wide client-event acknowledgement", async () => {
		const { provider } = createProvider();
		expect(
			() =>
				new PusherClientTransport({
					provider,
					key: "public-key",
					identityKey: "test-secret",
					clientEvents: { enabled: true },
				} as any),
		).toThrow("provider-wide");

		const transport = new PusherClientTransport({
			provider,
			key: "public-key",
			identityKey: "test-secret",
			clientEvents: {
				enabled: true,
				acknowledgeProviderWideRisk: true,
				allowedChannels: ["private-chat-room-*"],
			},
		});
		const config = await transport.getClientConfig({});
		const serialized = JSON.stringify(config);
		expect(serialized).toContain("public-key");
		expect(serialized).toContain("clientEvents");
		expect(serialized).not.toContain("test-secret");
	});

	test("enforces presence limits and can revoke provider-authenticated users", async () => {
		const terminated: string[] = [];
		const { provider } = createProvider();
		provider.getPresenceMemberCount = async () => 100;
		provider.terminateUserConnections = async (id) => terminated.push(id);
		const transport = new PusherClientTransport({
			provider,
			key: "public-key",
			identityKey: "test-secret",
		});
		const principal = {
			kind: "user" as const,
			user: { id: "user-1" } as any,
			session: { id: "session-1" } as any,
		};

		await expect(
			transport.generatePresenceAuth({
				socketId: "123.456",
				channel: "presence-chat-room-1",
				principal,
				member: { user_info: { displayName: "Ada" } },
			}),
		).rejects.toThrow("100 members");

		provider.getPresenceMemberCount = async () => 0;
		const auth = await transport.generatePresenceAuth({
			socketId: "123.456",
			channel: "presence-chat-room-1",
			principal,
			member: { user_info: { displayName: "Ada" } },
		});
		const channelData = JSON.parse(auth.channel_data!);
		expect(channelData.user_id).toHaveLength(64);
		expect(channelData.user_id).not.toContain("user-1");

		await transport.revokePrincipal(principal);
		expect(terminated).toEqual([channelData.user_id]);
		await expect(
			transport.generateUserAuth({ socketId: "123.456", principal }),
		).rejects.toThrow("revoked");
		await expect(
			transport.generatePresenceAuth({
				socketId: "123.456",
				channel: "presence-chat-room-1",
				principal,
			}),
		).rejects.toThrow("revoked");

		transport.restorePrincipal(principal);
		await expect(
			transport.generateUserAuth({ socketId: "123.456", principal }),
		).resolves.toMatchObject({ auth: expect.any(String) });
	});
});
