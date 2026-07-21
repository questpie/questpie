import { describe, expect, it } from "bun:test";

import {
	encodeSseComment,
	encodeSseEvent,
	RealtimeDeltaBufferOverflowError,
	RealtimeSnapshotBufferOverflowError,
	SseOrderedDeltaWriter,
	SseLatestSnapshotWriter,
	SseClientTransport,
} from "../../src/server/modules/core/integrated/realtime/sse-client-transport.js";
import { SharedSseKeepAliveTicker } from "../../src/server/modules/core/integrated/realtime/sse-keep-alive.js";

describe("realtime matrix SseClientTransport", () => {
	it("delivers serialized frames through a local-session sink", async () => {
		const frames: Uint8Array[] = [];
		let closeCalls = 0;
		let desiredSize = 128;
		const transport = new SseClientTransport(
			{
				get desiredSize() {
					return desiredSize;
				},
				enqueue: (frame) => {
					frames.push(frame);
					desiredSize = 64;
				},
				close: () => {
					closeCalls += 1;
				},
			},
			128,
		);

		await transport.start({ onError: () => {} });
		const sink = await transport.openSession({
			sessionId: "session-1",
			principal: null,
			resolvePrincipal: async () => null,
		});
		const frame = encodeSseEvent("snapshot", {
			topicId: "posts",
			seq: 4,
			data: { docs: [] },
		});

		await expect(sink.write(frame, "latest-snapshot")).resolves.toEqual({
			status: "accepted",
			bufferedBytes: 64,
		});
		expect(new TextDecoder().decode(frames[0])).toBe(
			'event: snapshot\ndata: {"topicId":"posts","seq":4,"data":{"docs":[]}}\n\n',
		);

		await transport.stop();
		await transport.stop();
		expect(closeCalls).toBe(1);
	});

	it("reports and rejects controller write failures", async () => {
		const failure = new Error("stream closed");
		const errors: unknown[] = [];
		const transport = new SseClientTransport({
			desiredSize: null,
			enqueue: () => {
				throw failure;
			},
			close: () => {},
		});

		await transport.start({ onError: (error) => errors.push(error) });
		const sink = await transport.openSession({
			sessionId: "session-1",
			principal: null,
			resolvePrincipal: async () => null,
		});

		await expect(
			sink.write(encodeSseEvent("ping", { ts: 1 }), "latest-snapshot"),
		).rejects.toBe(failure);
		expect(errors).toEqual([failure]);
	});

	it("returns busy without enqueueing when the stream is backpressured", async () => {
		const frames: Uint8Array[] = [];
		const transport = new SseClientTransport(
			{
				desiredSize: 0,
				enqueue: (frame) => frames.push(frame),
				close: () => {},
			},
			16,
		);

		await transport.start({ onError: () => {} });
		const sink = await transport.openSession({
			sessionId: "session-1",
			principal: null,
			resolvePrincipal: async () => null,
		});

		await expect(
			sink.write(
				encodeSseEvent("snapshot", { topicId: "posts" }),
				"latest-snapshot",
			),
		).resolves.toEqual({ status: "busy", bufferedBytes: 16 });
		expect(frames).toHaveLength(0);
	});

	it("keeps only the latest pending snapshot per topic", async () => {
		const accepted: string[] = [];
		let busy = true;
		const sink = {
			sessionId: "session-1",
			write: async (frame: Uint8Array) => {
				if (busy) return { status: "busy" as const, bufferedBytes: 10 };
				accepted.push(new TextDecoder().decode(frame));
				return { status: "accepted" as const, bufferedBytes: 0 };
			},
			close: async () => {},
		};
		const writer = new SseLatestSnapshotWriter(sink);

		await writer.write("posts", new TextEncoder().encode("posts-v1"));
		await writer.write("posts", new TextEncoder().encode("posts-v2"));
		await writer.write("pages", new TextEncoder().encode("pages-v1"));
		expect(writer.bufferedBytes).toBe(16);

		busy = false;
		await writer.flush();

		expect(accepted).toEqual(["posts-v2", "pages-v1"]);
		expect(writer.bufferedBytes).toBe(0);
	});

	it("rejects pending snapshots that would exceed the edge buffer cap", async () => {
		const sink = {
			sessionId: "session-1",
			write: async () => ({ status: "busy" as const, bufferedBytes: 8 }),
			close: async () => {},
		};
		const writer = new SseLatestSnapshotWriter(sink, 16);

		await expect(
			writer.write("posts", new Uint8Array(9)),
		).rejects.toBeInstanceOf(RealtimeSnapshotBufferOverflowError);
		expect(writer.bufferedBytes).toBe(0);
	});

	it("queues row deltas in order and tears down on overflow", async () => {
		const closed: string[] = [];
		const sink = {
			sessionId: "session-1",
			write: async () => ({ status: "busy" as const, bufferedBytes: 0 }),
			close: async (reason: string) => {
				closed.push(reason);
			},
		};
		const writer = new SseOrderedDeltaWriter(sink, {
			maximumBufferedEvents: 2,
			maximumBufferedBytes: 8,
			busyRetryMs: 60_000,
		});

		await expect(writer.write(new Uint8Array(5))).resolves.toMatchObject({
			status: "busy",
		});
		await expect(writer.write(new Uint8Array(4))).rejects.toBeInstanceOf(
			RealtimeDeltaBufferOverflowError,
		);
		expect(closed).toEqual(["slow_consumer"]);
		expect(writer.bufferedBytes).toBe(0);
	});
});

describe("realtime matrix SharedSseKeepAliveTicker", () => {
	it("uses one timer for all registered sessions and emits comment frames", () => {
		const scheduled: Array<() => void> = [];
		let cleared = 0;
		let now = 100;
		const ticker = new SharedSseKeepAliveTicker({
			now: () => now,
			setTimeout: (callback) => {
				scheduled.push(callback);
				return scheduled.length;
			},
			clearTimeout: () => {
				cleared += 1;
			},
		});
		const frames: string[] = [];

		const removeFirst = ticker.register(50, (frame) => {
			frames.push(new TextDecoder().decode(frame));
		});
		const removeSecond = ticker.register(50, (frame) => {
			frames.push(new TextDecoder().decode(frame));
		});
		expect(scheduled).toHaveLength(1);
		expect(ticker.size).toBe(2);

		now = 150;
		scheduled.shift()!();
		expect(frames).toEqual([": ping 150\n\n", ": ping 150\n\n"]);
		expect(scheduled).toHaveLength(1);

		removeFirst();
		removeSecond();
		expect(ticker.size).toBe(0);
		expect(cleared).toBe(1);
	});

	it("sanitizes comment data", () => {
		expect(new TextDecoder().decode(encodeSseComment("ping\nunsafe"))).toBe(
			": ping\n: unsafe\n\n",
		);
	});
});
