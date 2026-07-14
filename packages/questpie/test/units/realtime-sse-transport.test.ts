import { describe, expect, it } from "bun:test";

import {
	encodeSseEvent,
	SseClientTransport,
} from "../../src/server/modules/core/integrated/realtime/sse-client-transport.js";

describe("SseClientTransport", () => {
	it("delivers serialized frames through a local-session sink", async () => {
		const frames: Uint8Array[] = [];
		let closeCalls = 0;
		const transport = new SseClientTransport({
			enqueue: (frame) => frames.push(frame),
			close: () => {
				closeCalls += 1;
			},
		});

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
			bufferedBytes: null,
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
});
