import pg from "pg";

import {
	pgNotifyEphemeralBroker,
	pgNotifyChangeBroker,
} from "../src/exports/adapters/pg-notify.js";
import { EphemeralChannels } from "../src/server/channels/ephemeral.js";
import { parseCompatibleTypedEventWire } from "../src/shared/typed-wire.js";
import { buildMockApp } from "../test/utils/mocks/mock-app-builder.js";

const mode = process.env.EPHEMERAL_BENCH_MODE!;
const url = process.env.QUESTPIE_EPHEMERAL_DATABASE_URL!;
const pool = new pg.Pool({ connectionString: url, max: 8 });
let notifies = 0;
let fanoutRoundTrips = 0;
let pendingFanout = 0;
let failedFanout = 0;
const broker =
	mode === "ephemeral"
		? pgNotifyEphemeralBroker({
				connectionString: url,
				channel: process.env.EPHEMERAL_BENCH_CHANNEL!,
			})
		: pgNotifyChangeBroker({
				connectionString: url,
				channel: process.env.EPHEMERAL_BENCH_CHANNEL!,
			});
const originalPublish = broker.publish.bind(broker);
(broker as any).publish = async (message: any) => {
	pendingFanout++;
	try {
		await originalPublish(message);
		fanoutRoundTrips++;
		notifies += Array.isArray(message) ? message.length : 1;
	} catch (error) {
		failedFanout++;
		throw error;
	} finally {
		pendingFanout--;
	}
};
const ephemeral =
	mode === "ephemeral"
		? new EphemeralChannels({ broker: broker as any }, (error) =>
				process.send?.({ error: String(error) }),
			)
		: undefined;
const setup =
	mode !== "ephemeral"
		? await buildMockApp(
				{},
				{
					db: { url, pool: { max: 12 } },
					realtime: {
						changeBroker: broker as any,
						retentionDays: 0,
						pollIntervalMs: 0,
					},
				},
			)
		: undefined;
const seen = new Set<string>();
let latencies: number[] = [];
let received = 0;
const releases: (() => Promise<void>)[] = [];
async function authorize() {
	return (await pool.query("select true as allowed")).rows[0].allowed;
}

process.on("message", async (message: any) => {
	try {
		if (message.operation === "subscribe") {
			for (let i = 0; i < message.cursors; i++) {
				const channel = `bench-page-${i % 10}`;
				const sink = {
					sessionId: `cursor-${i}`,
					async write(bytes: Uint8Array) {
						const text = new TextDecoder().decode(bytes);
						let frame: any;
						if (text.startsWith("event: ")) {
							const lines = text.split("\n");
							if (!lines[0]!.includes("channel_ephemeral"))
								return { status: "accepted" as const, bufferedBytes: 0 };
							frame = parseCompatibleTypedEventWire(lines[1]!.slice(6));
						} else frame = JSON.parse(text);
						if (frame.type === "channel_gap")
							throw new Error("Durable channel gap");
						received++;
						if (!seen.has(frame.eventId) && frame.data?.sentAt) {
							seen.add(frame.eventId);
							latencies.push(Date.now() - frame.data.sentAt);
						}
						return { status: "accepted" as const, bufferedBytes: 0 };
					},
					async close(reason: string) {
						process.send?.({ error: `Subscriber closed: ${reason}` });
					},
				};
				const input = {
					subscriptionId: `cursor-${i}`,
					channel,
					sink,
					subject: `cursor-${i}`,
					reauthorize: authorize,
					presence: {
						channel,
						connectionId: `cursor-${i}`,
						principalId: `cursor-${i}`,
						data: { id: `cursor-${i}` },
						sink,
					},
				};
				releases.push(
					ephemeral
						? await ephemeral.subscribe(input)
						: await setup!.app.realtime.subscribeChannel(input),
				);
			}
		} else if (message.operation === "run") {
			const deadline = Date.now() + message.durationMs;
			let offered = 0,
				completed = 0,
				maximumPending = 0;
			const pending = new Set<Promise<void>>();
			while (Date.now() < deadline) {
				const started = Date.now();
				for (let i = 0; i < message.cursors; i++) {
					offered++;
					const input = {
						channel: `bench-page-${i % 10}`,
						event: "cursor",
						schemaIdentity: "bench:cursor",
						data: {
							actor: `cursor-${i}`,
							x: offered % 1000,
							y: i,
							sentAt: Date.now(),
						},
					};
					let task: Promise<void>;
					task = (async () => {
						if (ephemeral) await ephemeral.publish(input, {}, `cursor-${i}`);
						else await setup!.app.realtime.appendChannelEvent(input);
						completed++;
					})().finally(() => pending.delete(task));
					pending.add(task);
				}
				maximumPending = Math.max(maximumPending, pending.size);
				if (pending.size > 10_000)
					throw new Error("Publisher backlog exceeded 10,000");
				await Bun.sleep(
					Math.max(
						0,
						1000 / (mode === "channels-throttled" ? 10 : message.inputHz) -
							(Date.now() - started),
					),
				);
			}
			await Promise.all(pending);
			await Bun.sleep(500);
			const drainDeadline = Date.now() + 5000;
			for (;;) {
				if (!pendingFanout || Date.now() >= drainDeadline) break;
				await Bun.sleep(20);
			}
			process.send?.({
				request: message.request,
				offered,
				completed,
				notifies,
				fanoutRoundTrips,
				failedFanout,
				pendingFanout,
				maximumPending,
			});
			return;
		} else if (message.operation === "stats") {
			process.send?.({
				request: message.request,
				latencies,
				received,
				notifies,
				fanoutRoundTrips,
				failedFanout,
				pendingFanout,
			});
			latencies = [];
			return;
		} else if (message.operation === "stop") {
			for (const release of releases) await release();
			await ephemeral?.destroy();
			await setup?.cleanup();
			await pool.end();
			process.send?.({ request: message.request });
			process.exit(0);
		}
		process.send?.({ request: message.request });
	} catch (error) {
		process.send?.({ request: message.request, error: String(error) });
	}
});
process.send?.({ ready: true });
