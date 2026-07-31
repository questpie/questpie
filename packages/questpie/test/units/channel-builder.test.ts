import { describe, expect, test } from "bun:test";

import { z } from "zod";

import {
	channel,
	resolveChannelName,
} from "../../src/server/channels/channel-builder.js";
import { ChannelsService } from "../../src/server/channels/service.js";
import { extractAppServices } from "../../src/server/config/app-context.js";
import { RequestScope } from "../../src/server/config/request-scope.js";
import { service } from "../../src/server/services/define-service.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";

const userContext = {
	accessMode: "user",
	session: { user: { id: "user-1" } },
} as any;

describe("channel builder", () => {
	test("builds immutable definitions and infers visibility", () => {
		const base = channel("news");
		const withEvents = base.events({
			updated: z.object({ title: z.string() }),
		});
		const privateChannel = withEvents.authorize(({ session }) => !!session);
		const presenceChannel = privateChannel.presence(({ session }) => ({
			id: session!.user.id,
		}));

		expect(Object.isFrozen(base)).toBe(true);
		expect(Object.isFrozen(withEvents)).toBe(true);
		expect(Object.isFrozen(withEvents.eventSchemas)).toBe(true);
		expect(base).not.toBe(withEvents);
		expect(withEvents).not.toBe(privateChannel);
		expect(base.visibility).toBe("public");
		expect(privateChannel.visibility).toBe("private");
		expect(presenceChannel.visibility).toBe("presence");
		expect(presenceChannel["__brand"]).toBe("channel");
	});

	test("resolves bracket params into transport-safe names", () => {
		const definition = channel("chat-room-[roomId]").authorize(() => true);
		expect(resolveChannelName(definition, { roomId: "room_42" })).toBe(
			"private-chat-room-room_42",
		);
		expect(() =>
			resolveChannelName(definition, { roomId: "bad/value" }),
		).toThrow("transport-safe");
		expect(() => channel("bad/channel")).toThrow("wire pattern");
	});
});

describe("channel ChannelsService", () => {
	test("is projected as request-bound ctx.channels by the core module", async () => {
		const setup = await buildMockApp({});
		(setup.app.config as any).channels = {
			room: channel("room-[roomId]").authorize(({ session }) => !!session),
		};
		const ctx = extractAppServices(setup.app, {
			accessMode: "user",
			session: { user: { id: "user-1" } },
		});

		expect(ctx.channels).toBeInstanceOf(ChannelsService);
		expect(
			await (ctx.channels as ChannelsService<any>).authorize(
				"room",
				{ roomId: "one" },
				"subscribe",
			),
		).toBe(true);
		await setup.cleanup();
	});

	test("keeps server publish authorization on the transaction and extension context", async () => {
		const transactionDb = { marker: "transaction-db" };
		let authorizationContext: Record<string, any> | undefined;
		const setup = await buildMockApp({});
		(setup.app.config as any).channels = {
			room: channel("room-[roomId]")
				.events({ message: z.object({ text: z.string() }) })
				.authorize({
					subscribe: true,
					publish: (ctx) => {
						authorizationContext = ctx;
						return true;
					},
				}),
		};
		const ctx = extractAppServices(setup.app, {
			db: transactionDb,
			accessMode: "user",
			session: {
				user: { id: "user-1" },
				session: { id: "session-1" },
			},
			contextExtensions: {
				tenantId: "tenant-a",
				collections: "shadow-collections",
				services: "shadow-services",
			},
		});

		await (ctx.channels as ChannelsService<any>).preparePublish("room", {
			params: { roomId: "one" },
			event: "message",
			data: { text: "hello" },
		});

		expect(authorizationContext?.db).toBe(transactionDb);
		expect(authorizationContext?.session?.user?.id).toBe("user-1");
		expect(authorizationContext?.tenantId).toBe("tenant-a");
		expect(typeof authorizationContext?.collections).toBe("object");
		expect(typeof authorizationContext?.services).toBe("object");
		expect(authorizationContext?.channels).toBeInstanceOf(ChannelsService);
		await setup.cleanup();
	});

	test("keeps projected request services stable and service namespaces flat-enumerable", async () => {
		let policyCreations = 0;
		const observations: Array<Record<string, any>> = [];
		const setup = await buildMockApp({
			services: {
				policy: service()
					.lifecycle("request")
					.create(() => ({ id: ++policyCreations })),
				workflows: service()
					.lifecycle("singleton")
					.namespace(null)
					.create(() => ({ marker: "workflows" })),
				tracker: service()
					.lifecycle("singleton")
					.namespace("analytics")
					.create(() => ({ marker: "tracker" })),
			},
		});
		(setup.app.config as any).channels = {
			room: channel("room-[roomId]").authorize((operation) => {
				const context = operation as any;
				observations.push({
					policy: context.services.policy,
					top: { ...context },
					services: { ...context.services },
					analytics: { ...context.analytics },
				});
				return true;
			}),
		};
		const scope = new RequestScope();
		const context = extractAppServices(setup.app, {
			accessMode: "user",
			session: { user: { id: "user-1" } },
			scope,
		});
		const projectedPolicy = (context.services as any).policy;
		const channels = context.channels as ChannelsService<any>;

		expect(
			await channels.authorize("room", { roomId: "one" }, "subscribe"),
		).toBe(true);
		expect(
			await channels.authorize("room", { roomId: "two" }, "subscribe"),
		).toBe(true);
		expect(policyCreations).toBe(1);
		expect(observations.map(({ policy }) => policy)).toEqual([
			projectedPolicy,
			projectedPolicy,
		]);
		for (const observation of observations) {
			expect(observation.top.workflows).toEqual({ marker: "workflows" });
			expect(observation.top.analytics.tracker).toEqual({ marker: "tracker" });
			expect(observation.services.policy).toBe(projectedPolicy);
			expect(observation.analytics.tracker).toEqual({ marker: "tracker" });
		}

		await scope.dispose();
		await setup.cleanup();
	});

	test("enforces publish authorization, validates zod, and delegates parsed bytes", async () => {
		const definitions = {
			chatRoom: channel("chat-room-[roomId]")
				.events({
					message: z.object({ text: z.string().min(1) }).strip(),
				})
				.authorize({
					subscribe: ({ session }) => !!session,
					publish: ({ params, session }) =>
						params.roomId === "allowed" && !!session,
				}),
		};
		const deliveries: Array<{
			channel: string;
			event: string;
			data: unknown;
		}> = [];
		const service = new ChannelsService(
			definitions,
			{
				appendChannelEvent: async (delivery) => {
					deliveries.push(delivery);
					return { eventId: "event-1" };
				},
			},
			userContext,
		);

		await expect(
			service.publish("chatRoom", {
				params: { roomId: "denied" },
				event: "message",
				data: { text: "hello" },
			}),
		).rejects.toMatchObject({ code: "channel_publish_denied" });
		expect(deliveries).toHaveLength(0);

		await expect(
			service.publish("chatRoom", {
				params: { roomId: "allowed" },
				event: "message",
				data: { text: "" },
			}),
		).rejects.toMatchObject({ code: "channel_event_invalid" });
		expect(deliveries).toHaveLength(0);

		const receipt = await service.publish("chatRoom", {
			params: { roomId: "allowed" },
			event: "message",
			data: { text: "hello", ignored: true },
		});
		expect(receipt.eventId).toBeString();
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0]?.channel).toBe("private-chat-room-allowed");
		expect(deliveries[0]).toMatchObject({
			event: "message",
			data: { text: "hello" },
		});
	});

	test("keeps public channels read-only for user contexts and lets system code publish", async () => {
		const definitions = {
			news: channel("news").events({ updated: z.object({ id: z.string() }) }),
		};
		let publishes = 0;
		const publisher = {
			appendChannelEvent: async () => {
				publishes += 1;
				return { eventId: `event-${publishes}` };
			},
		};

		const userService = new ChannelsService(
			definitions,
			publisher,
			userContext,
		);
		await expect(
			userService.publish("news", {
				event: "updated",
				data: { id: "1" },
			}),
		).rejects.toMatchObject({ code: "channel_publish_denied" });

		const systemService = new ChannelsService(definitions, publisher, {
			accessMode: "system",
		} as any);
		await systemService.publish("news", {
			event: "updated",
			data: { id: "1" },
		});
		expect(publishes).toBe(1);
	});

	test("snapshots authority fields and keeps authorization context flat-enumerable", async () => {
		let spreadContext: Record<string, unknown> | undefined;
		const mutableContext = {
			accessMode: "user",
			session: { user: { id: "user-1" } },
			services: { policy: { marker: "policy-service" } },
			tables: { actors: { marker: "actors-table" } },
		} as any;
		const service = new ChannelsService(
			{
				news: channel("news").events({ updated: z.object({ id: z.string() }) }),
				identity: channel("identity").authorize(
					(ctx) => ctx.session?.user.id === "admin",
				),
				room: channel("room-[roomId]")
					.events({ updated: z.object({ id: z.string() }) })
					.authorize({
						subscribe: false,
						publish: (ctx) => {
							spreadContext = { ...ctx };
							return false;
						},
					}),
			},
			{
				appendChannelEvent: async () => ({ eventId: "event-1" }),
			},
			mutableContext,
		);

		mutableContext.accessMode = "system";
		mutableContext.session.user.id = "admin";
		await expect(
			service.publish("news", {
				event: "updated",
				data: { id: "one" },
			}),
		).rejects.toMatchObject({ code: "channel_publish_denied" });

		expect(await service.authorize("room", { roomId: "one" }, "publish")).toBe(
			false,
		);
		expect(await service.authorize("identity", {}, "subscribe")).toBe(false);
		expect(spreadContext).toMatchObject({
			session: { user: { id: "user-1" } },
			services: { policy: { marker: "policy-service" } },
			tables: { actors: { marker: "actors-table" } },
			params: { roomId: "one" },
		});
	});

	test("keeps channels as a real own property when an authorizer freezes its context", async () => {
		let observedKeys: string[] = [];
		const service = new ChannelsService(
			{
				room: channel("room-[roomId]").authorize((context) => {
					Object.freeze(context);
					observedKeys = Object.keys(context);
					return Object.isFrozen(context);
				}),
			},
			{
				appendChannelEvent: async () => ({ eventId: "event-1" }),
			},
			userContext,
		);

		expect(
			await service.authorize("room", { roomId: "one" }, "subscribe"),
		).toBe(true);
		expect(observedKeys).toContain("channels");
	});

	test("uses subscribe as the omitted publish rule and resolves presence", async () => {
		const definitions = {
			room: channel("room-[roomId]")
				.events({ ping: z.object({}) })
				.authorize(({ params }) => params.roomId === "allowed")
				.presence(({ params, session }) => ({
					id: session!.user.id,
					roomId: params.roomId,
				})),
		};
		const service = new ChannelsService(
			definitions,
			{
				appendChannelEvent: async () => ({ eventId: "event-1" }),
			},
			userContext,
		);

		expect(
			await service.authorize("room", { roomId: "allowed" }, "publish"),
		).toBe(true);
		expect(
			await service.authorize("room", { roomId: "denied" }, "publish"),
		).toBe(false);
		expect(
			await service.resolvePresence("room", { roomId: "allowed" }),
		).toEqual({ id: "user-1", roomId: "allowed" });
	});

	test("revokes resolved channel authority through the generic publisher and awaits acknowledgement", async () => {
		const definitions = {
			room: channel("room-[roomId]").authorize(() => true),
		};
		const revocations: unknown[] = [];
		let acknowledge: (() => void) | undefined;
		const acknowledged = new Promise<void>((resolve) => {
			acknowledge = resolve;
		});
		const service = new ChannelsService(
			definitions,
			{
				appendChannelEvent: async () => ({ eventId: "event-1" }),
				revokeChannelAuthority: async (input) => {
					revocations.push(input);
					await acknowledged;
					return {
						scope: "principal-connections" as const,
						generation: 1,
					};
				},
			},
			userContext,
		);
		let settled = false;

		const revocation = service
			.revokeAuthority("room", {
				params: { roomId: "one" },
				subject: { kind: "user", id: "user-2" },
				idempotencyKey: "room-one:user-2:membership-v2",
			})
			.then((receipt) => {
				settled = true;
				return receipt;
			});
		await Promise.resolve();

		expect(revocations).toEqual([
			{
				channel: "private-room-one",
				subject: { kind: "user", id: "user-2" },
				idempotencyKey: "room-one:user-2:membership-v2",
			},
		]);
		expect(settled).toBe(false);
		acknowledge?.();
		await expect(revocation).resolves.toEqual({
			scope: "principal-connections",
			generation: 1,
		});
	});

	test("publishes a batch in input order", async () => {
		const definitions = {
			news: channel("news").events({ updated: z.object({ id: z.string() }) }),
		};
		const frames: unknown[] = [];
		const service = new ChannelsService(
			definitions,
			{
				appendChannelEvent: async ({ data }) => {
					frames.push(data);
					return { eventId: `event-${frames.length}` };
				},
			},
			{ accessMode: "system" } as any,
		);

		await service.publishBatch([
			{ channel: "news", event: "updated", data: { id: "1" } },
			{ channel: "news", event: "updated", data: { id: "2" } },
		]);
		expect(frames.map((frame: any) => frame.id)).toEqual(["1", "2"]);
	});
});
