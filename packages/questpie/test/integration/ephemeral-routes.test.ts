import { expect, test } from "bun:test";

import { z } from "zod";

import { createClient } from "../../src/client/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { channel } from "../../src/server/channels/channel-builder.js";
import { ChannelTokenBucketLimiter } from "../../src/server/channels/security.js";
import {
	questpieChannelEventTable,
	questpieChannelHeadTable,
	questpieChannelPresenceTable,
	questpieChannelAuthorityFenceTable,
} from "../../src/server/modules/core/integrated/realtime/collection.js";
import { setChannelPublishLimiterForTests } from "../../src/server/modules/core/routes/channels/_shared.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
	for (let i = 0; i < 300; i++) {
		if (check()) return;
		await wait(10);
	}
	throw new Error("Timed out waiting for SSE client");
}

test("HTTP + public client: shared SSE, dates, limits, no ledger/presence rows and idle access loss", async () => {
	let allowed = true;
	let session: any = { user: { id: "ada" }, session: { id: "ada-session" } };
	const setup = await buildMockApp(
		{
			channels: {
				page: channel("page-[id]")
					.events({
						cursor: z.object({ x: z.number(), at: z.date() }),
						typing: z.string(),
					})
					.authorize({
						subscribe: ({ session }) => allowed && !!session,
						publish: ({ session }) => allowed && !!session,
					})
					.presence(({ session }) => ({ id: session!.user.id }))
					.ephemeral(),
			},
		},
		{
			app: { url: "http://localhost:3000" },
			realtime: {
				retentionDays: 0,
				ephemeral: {
					authorizationIntervalMs: 30,
					heartbeatMs: 50,
					leaseMs: 200,
				},
			},
		},
	);
	let streams = 0;
	const requests: any[] = [];
	let client: ReturnType<typeof createClient<any>> | undefined;
	try {
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, {
			getSession: async () => session,
		});
		client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: async (input, init) => {
				const request = new Request(input as string, init);
				if (request.url.endsWith("/realtime") && init?.body) {
					const body = JSON.parse(String(init.body));
					requests.push(body);
					if (body.channels) streams++;
				}
				return handler(request);
			},
		});
		const events: any[] = [],
			presence: any[] = [],
			errors: Error[] = [];
		const one = client.channels.page({ id: "one" });
		let ready = false;
		const stop = one.subscribe((message: any) => events.push(message), {
			onReady: () => {
				ready = true;
			},
			onError: (e: Error) => errors.push(e),
		});
		const stopPresence = one.subscribePresence((members: any[]) =>
			presence.push(members),
		);
		await until(
			() => ready && presence.some((members) => members.length === 1),
		);
		const at = new Date("2026-10-22T10:00:00Z");
		await one.publish("cursor", { x: 1, at });
		await one.publish("cursor", { x: 2, at });
		await until(() => events.length === 1);
		expect(events[0].data).toEqual({ x: 2, at });
		expect(streams).toBe(1);
		await expect(one.publish("typing", "é".repeat(600))).rejects.toThrow();
		const post = (data: string) =>
			handler(
				new Request("http://localhost:3000/channels/publish", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						channel: "page",
						params: { id: "one" },
						event: "typing",
						data,
					}),
				}),
			);
		expect((await post("é".repeat(600))).status).toBe(413);
		setChannelPublishLimiterForTests(
			setup.app,
			new ChannelTokenBucketLimiter({ ratePerSecond: 1, burst: 1 }),
		);
		expect((await post("typing")).status).toBe(200);
		expect((await post("typing")).status).toBe(429);

		const replay = await handler(
			new Request("http://localhost:3000/channels/replay", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					channel: "page",
					params: { id: "one" },
					afterEventId: "ignored",
				}),
			}),
		);
		expect(replay.status).toBe(409);
		for (const table of [
			questpieChannelEventTable,
			questpieChannelHeadTable,
			questpieChannelPresenceTable,
			questpieChannelAuthorityFenceTable,
		])
			expect(await setup.app.db.select().from(table)).toEqual([]);
		allowed = false;
		await until(() => errors.length > 0);
		const count = events.length;
		await wait(120);
		expect(events).toHaveLength(count);
		stop();
		stopPresence();
		session = null;
		const denied = await handler(
			new Request("http://localhost:3000/realtime", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					channels: [{ id: "denied", channel: "page", params: { id: "one" } }],
				}),
			}),
		);
		expect(denied.status).toBeGreaterThanOrEqual(400);
		expect(
			requests.every((r) => !r.channels?.some((c: any) => c.lastEventId)),
		).toBe(true);
	} finally {
		client?.channels.destroy();
		await setup.cleanup();
	}
}, 15_000);
