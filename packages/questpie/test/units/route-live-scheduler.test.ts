import { describe, expect, it, spyOn } from "bun:test";

import { ApiError } from "../../src/server/errors/index.js";
import { RealtimeBindingOutputGate } from "../../src/server/modules/core/integrated/realtime/edge-session.js";
import {
	RealtimeRefreshScheduler,
	type CoherentRefreshSubscriptionInput,
} from "../../src/server/modules/core/integrated/realtime/refresh-scheduler.js";
import { SseLatestSnapshotWriter } from "../../src/server/modules/core/integrated/realtime/sse-client-transport.js";
import { sharedSseKeepAliveTicker } from "../../src/server/modules/core/integrated/realtime/sse-keep-alive.js";
import type { ClientSink } from "../../src/server/modules/core/integrated/realtime/transport.js";
import type {
	RealtimeChangeEvent,
	RealtimeTopics,
} from "../../src/server/modules/core/integrated/realtime/types.js";
import { parseCompatibleTypedEventWire } from "../../src/shared/typed-wire.js";

const tick = () => Bun.sleep(5);
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const decode = (frame: Uint8Array) =>
	parseCompatibleTypedEventWire<any>(
		new TextDecoder().decode(frame).split("\ndata: ")[1]!.trim(),
	);
class Source {
	listeners = new Map<(event: RealtimeChangeEvent) => void, RealtimeTopics>();
	async getLatestSeq() {
		return 4;
	}
	subscribe(
		listener: (event: RealtimeChangeEvent) => void,
		topic: RealtimeTopics,
	) {
		this.listeners.set(listener, topic);
		return () => {
			this.listeners.delete(listener);
		};
	}
	emit(resource: string, seq = 9) {
		for (const [listener, topic] of this.listeners)
			if (topic.resource === resource)
				listener({
					seq,
					resource,
					resourceType: "collection",
					operation: "update",
					createdAt: new Date(),
				});
	}
}
const base = (
	compute: CoherentRefreshSubscriptionInput["compute"],
	onFrame: CoherentRefreshSubscriptionInput["onFrame"],
): CoherentRefreshSubscriptionInput => ({
	kind: "coherent",
	key: "same-key",
	topicId: "route",
	dependencies: [
		{
			topic: { resourceType: "collection", resource: "data" },
			authority: false,
		},
		{
			topic: { resourceType: "collection", resource: "authority" },
			authority: true,
		},
	],
	compute,
	onFrame,
	onError: (error) => {
		throw error;
	},
	onInvalidate: () => {},
});

describe("coherent route scheduler", () => {
	it("subscribes before reading, latches a bootstrap commit, and stamps the captured sequence/watermark", async () => {
		const source = new Source();
		const scheduler = new RealtimeRefreshScheduler(source);
		const started = deferred();
		const release = deferred();
		const frames: any[] = [];
		let calls = 0;
		const close = scheduler.subscribe(
			base(
				async () => {
					expect(source.listeners.size).toBe(2);
					calls++;
					if (calls === 1) {
						started.resolve();
						await release.promise;
						return { data: "old", upToDate: "100" };
					}
					return { data: "new", upToDate: "200" };
				},
				(frame) => {
					frames.push(decode(frame));
				},
			),
		);
		try {
			await started.promise;
			source.emit("data", 9);
			release.resolve();
			await tick();
			await tick();
			expect(calls).toBe(2);
			expect(
				frames.map((frame) => [frame.data, frame.seq, frame.upToDate]),
			).toEqual([
				["old", 4, "100"],
				["new", 9, "200"],
			]);
		} finally {
			release.resolve();
			close();
		}
	});
	it("discards blocked protected computation after authority revoke, then reports denial while a sibling delivers", async () => {
		const source = new Source();
		const scheduler = new RealtimeRefreshScheduler(source);
		const started = deferred();
		const release = deferred();
		const frames: any[] = [];
		const errors: unknown[] = [];
		let calls = 0;
		let invalidations = 0;
		const close = scheduler.subscribe({
			...base(
				async () => {
					if (++calls === 1) {
						started.resolve();
						await release.promise;
						return { data: "protected", upToDate: "100" };
					}
					throw ApiError.forbidden({ operation: "read", resource: "route" });
				},
				(frame) => {
					frames.push(decode(frame));
				},
			),
			onError: (error) => {
				errors.push(error);
			},
			onInvalidate: () => {
				invalidations++;
			},
		});
		const sibling: any[] = [];
		const closeSibling = scheduler.subscribe({
			...base(
				async () => ({ data: "sibling", upToDate: "101" }),
				(frame) => {
					sibling.push(decode(frame));
				},
			),
			dependencies: [
				{
					topic: { resourceType: "collection", resource: "sibling" },
					authority: false,
				},
			],
		});
		try {
			await started.promise;
			source.emit("authority");
			expect(invalidations).toBe(1);
			release.resolve();
			await tick();
			await tick();
			expect(frames).toEqual([]);
			expect(errors).toHaveLength(1);
			expect(sibling[0].data).toBe("sibling");
		} finally {
			release.resolve();
			close();
			closeSibling();
		}
	});
	it("checks the authority epoch again after asynchronous hashing", async () => {
		const source = new Source();
		const scheduler = new RealtimeRefreshScheduler(source);
		const hashing = deferred();
		const release = deferred();
		const frames: any[] = [];
		let calls = 0;
		let hashes = 0;
		const original = crypto.subtle.digest.bind(crypto.subtle);
		const digest = spyOn(crypto.subtle, "digest").mockImplementation(
			async (...args: Parameters<typeof original>) => {
				if (++hashes === 1) {
					hashing.resolve();
					await release.promise;
				}
				return original(...args);
			},
		);
		const close = scheduler.subscribe(
			base(
				async () => ({
					data: ++calls === 1 ? "stale" : "fresh",
					upToDate: String(calls),
				}),
				(frame) => {
					frames.push(decode(frame));
				},
			),
		);
		try {
			await hashing.promise;
			source.emit("authority");
			release.resolve();
			await tick();
			await tick();
			expect(frames.map((frame) => frame.data)).toEqual(["fresh"]);
		} finally {
			release.resolve();
			close();
			digest.mockRestore();
		}
	});
	it("hashes typed payloads without conflating Date and its ISO string", async () => {
		const source = new Source();
		const scheduler = new RealtimeRefreshScheduler(source);
		const frames: any[] = [];
		let calls = 0;
		const at = new Date("2026-10-22T12:00:00Z");
		const close = scheduler.subscribe(
			base(
				async () => ({
					data: calls++ === 0 ? at : at.toISOString(),
					upToDate: "100",
				}),
				(frame) => {
					frames.push(decode(frame));
				},
			),
		);
		try {
			await tick();
			source.emit("data");
			await tick();
			expect(frames).toHaveLength(2);
			expect(frames[0].data).toBeInstanceOf(Date);
			expect(typeof frames[1].data).toBe("string");
		} finally {
			close();
		}
	});
	it("serializes application values once per evaluation and preserves compatible typed wire values", async () => {
		const source = new Source();
		const scheduler = new RealtimeRefreshScheduler(source);
		const frames: ReturnType<typeof decode>[] = [];
		const firstFrame = deferred();
		const secondFrame = deferred();
		const at = new Date("2026-10-22T12:00:00Z");
		let getterCalls = 0;
		let toJSONCalls = 0;
		let evaluations = 0;
		const close = scheduler.subscribe(
			base(
				async () => ({
					data: {
						at,
						items: [at, undefined],
						omitted: undefined,
						get label() {
							getterCalls++;
							return "stable";
						},
						custom: {
							toJSON() {
								toJSONCalls++;
								return { __questpieTypedWire: "nested app value" };
							},
						},
					},
					upToDate: String(++evaluations),
				}),
				(frame) => {
					frames.push(decode(frame));
					if (frames.length === 1) firstFrame.resolve();
					else secondFrame.resolve();
				},
			),
		);
		try {
			await firstFrame.promise;
			expect(getterCalls).toBe(1);
			expect(toJSONCalls).toBe(1);
			expect(frames[0].data).toEqual({
				at,
				items: [at, null],
				label: "stable",
				custom: { __questpieTypedWire: "nested app value" },
			});
			source.emit("data");
			await secondFrame.promise;
			expect(getterCalls).toBe(2);
			expect(toJSONCalls).toBe(2);
			expect(frames).toHaveLength(2);
			expect(frames[1]).toMatchObject({ type: "up-to-date", upToDate: "2" });
		} finally {
			close();
		}
	});
	it("does not revisit data omitted by its toJSON method when framing the snapshot", async () => {
		const scheduler = new RealtimeRefreshScheduler(new Source());
		const frames: ReturnType<typeof decode>[] = [];
		const delivered = deferred();
		let calls = 0;
		const close = scheduler.subscribe(
			base(
				async () => ({
					data: { toJSON: () => (++calls === 1 ? undefined : "unexpected") },
					upToDate: "1",
				}),
				(frame) => {
					frames.push(decode(frame));
					delivered.resolve();
				},
			),
		);
		try {
			await delivered.promise;
			expect(calls).toBe(1);
			expect(frames).toHaveLength(1);
			expect(Object.hasOwn(frames[0], "data")).toBe(false);
		} finally {
			close();
		}
	});
	it("publishes the same normalized data that was hashed even when the source changes during hashing", async () => {
		const source = new Source();
		const scheduler = new RealtimeRefreshScheduler(source);
		const hashing = deferred();
		const release = deferred();
		const frames: ReturnType<typeof decode>[] = [];
		const firstFrame = deferred();
		const secondFrame = deferred();
		const data = { title: "before", at: new Date("2026-10-22T12:00:00Z") };
		const original = crypto.subtle.digest.bind(crypto.subtle);
		let hashes = 0;
		const digest = spyOn(crypto.subtle, "digest").mockImplementation(
			async (...args: Parameters<typeof original>) => {
				if (++hashes === 1) {
					hashing.resolve();
					await release.promise;
				}
				return original(...args);
			},
		);
		const close = scheduler.subscribe(
			base(
				async () => ({ data, upToDate: "1" }),
				(frame) => {
					frames.push(decode(frame));
					if (frames.length === 1) firstFrame.resolve();
					else secondFrame.resolve();
				},
			),
		);
		try {
			await hashing.promise;
			data.title = "after";
			data.at.setUTCFullYear(2027);
			release.resolve();
			await firstFrame.promise;
			expect(frames[0].data).toEqual({
				title: "before",
				at: new Date("2026-10-22T12:00:00Z"),
			});
			source.emit("data");
			await secondFrame.promise;
			expect(frames[1].data).toEqual(data);
		} finally {
			release.resolve();
			close();
			digest.mockRestore();
		}
	});
	it("isolates equal route keys per binding and recomputes on reconnect", async () => {
		const source = new Source();
		const scheduler = new RealtimeRefreshScheduler(source);
		const frames: string[] = [];
		let calls = 0;
		const close = scheduler.subscribe(
			base(
				async () => {
					calls++;
					return { data: "first-principal", upToDate: "1" };
				},
				(frame) => {
					frames.push(decode(frame).data);
				},
			),
		);
		await tick();
		const next = scheduler.subscribe(
			base(
				async () => {
					calls++;
					return { data: "second-principal", upToDate: "1" };
				},
				(frame) => {
					frames.push(decode(frame).data);
				},
			),
		);
		try {
			await tick();
			expect(calls).toBe(2);
			expect(frames).toEqual(["first-principal", "second-principal"]);
		} finally {
			close();
			next();
		}
	});
	it("an age deadline queues a recheck without discarding active authorized work", async () => {
		let ageTick!: () => void;
		const ticker = spyOn(
			sharedSseKeepAliveTicker,
			"register",
		).mockImplementation((_interval, onPing) => {
			ageTick = () => onPing(new Uint8Array());
			return () => {};
		});
		const source = new Source();
		const scheduler = new RealtimeRefreshScheduler(source);
		const started = deferred();
		const release = deferred();
		const secondStarted = deferred();
		const secondRelease = deferred();
		let calls = 0;
		let invalidations = 0;
		const frames: unknown[] = [];
		const close = scheduler.subscribe({
			...base(
				async () => {
					if (++calls === 1) {
						started.resolve();
						await release.promise;
						return { data: "authorized-first", upToDate: "1" };
					}
					secondStarted.resolve();
					await secondRelease.promise;
					return { data: "authorized-next", upToDate: "2" };
				},
				(frame) => {
					frames.push(decode(frame).data);
				},
			),
			onInvalidate: () => {
				invalidations++;
			},
		});
		try {
			await started.promise;
			ageTick();
			expect(invalidations).toBe(1);
			release.resolve();
			await secondStarted.promise;
			expect(frames).toEqual(["authorized-first"]);
			expect(calls).toBe(2);
		} finally {
			release.resolve();
			secondRelease.resolve();
			close();
			ticker.mockRestore();
		}
	});
	it("absorbs queued authority and data wakes before starting a fresh coherent evaluation", async () => {
		const source = new Source();
		const scheduler = new RealtimeRefreshScheduler(source, 1);
		const occupied = deferred();
		const release = deferred();
		const frames: unknown[] = [];
		let calls = 0;
		const blocker = scheduler.subscribe({
			...base(
				async () => {
					occupied.resolve();
					await release.promise;
					return { data: "blocker", upToDate: "1" };
				},
				() => {},
			),
			dependencies: [],
		});
		await occupied.promise;
		const close = scheduler.subscribe(
			base(
				async () => ({ data: ++calls, upToDate: "10" }),
				(frame) => {
					frames.push(decode(frame));
				},
			),
		);
		try {
			await tick();
			source.emit("authority", 8);
			source.emit("data", 9);
			release.resolve();
			await tick();
			await tick();
			expect(calls).toBe(1);
			expect(frames).toHaveLength(1);
			expect(frames[0]).toMatchObject({ data: 1, seq: 9, upToDate: "10" });
		} finally {
			release.resolve();
			close();
			blocker();
		}
	});
	it("uses the shared ticker for maximum-age authority evaluation and removes its registration", async () => {
		const source = new Source();
		const scheduler = new RealtimeRefreshScheduler(source);
		const size = sharedSseKeepAliveTicker.size;
		let calls = 0;
		let invalidations = 0;
		const close = scheduler.subscribe({
			...base(
				async () => ({ data: ++calls, upToDate: String(calls) }),
				() => {},
			),
			maxAgeMs: 10,
			onInvalidate: () => {
				invalidations++;
			},
		});
		try {
			await Bun.sleep(35);
			expect(calls).toBeGreaterThan(1);
			expect(invalidations).toBeGreaterThan(0);
			expect(sharedSseKeepAliveTicker.size).toBe(size + 1);
		} finally {
			close();
		}
		expect(sharedSseKeepAliveTicker.size).toBe(size);
	});
});

describe("protected route output cleanup", () => {
	it("removes only the denied topic and fences its already queued callbacks", async () => {
		let busy = true;
		const delivered: string[] = [];
		const sink: ClientSink = {
			sessionId: "session",
			write: async (frame) => {
				if (busy) return { status: "busy", bufferedBytes: 0 };
				delivered.push(new TextDecoder().decode(frame));
				return { status: "accepted", bufferedBytes: 0 };
			},
			close: async () => {},
		};
		const writer = new SseLatestSnapshotWriter(sink);
		const bytes = (text: string) => new TextEncoder().encode(text);
		await writer.write("denied", bytes("protected pending"));
		await writer.write("sibling", bytes("sibling pending"));
		const queued = writer.write("denied", bytes("protected queued"));
		const remove = writer.remove("denied");
		busy = false;
		await queued;
		await remove;
		await writer.flush();
		expect(delivered).toEqual(["sibling pending"]);
		expect(writer.bufferedBytes).toBe(0);
		writer.clear();
	});
	it("discards staged and queued binding snapshots on authority invalidation and close", async () => {
		const delivered: string[] = [];
		const sink: ClientSink = {
			sessionId: "session",
			write: async (frame) => {
				delivered.push(new TextDecoder().decode(frame));
				return { status: "accepted", bufferedBytes: 0 };
			},
			close: async () => {},
		};
		const gate = new RealtimeBindingOutputGate(sink, {
			maximumOrderedEvents: 5,
			maximumBufferedBytes: 1024,
			onError: (error) => {
				throw error;
			},
		});
		const bytes = (text: string) => new TextEncoder().encode(text);
		await gate.write(bytes("staged protected"), "latest-snapshot");
		gate.activate();
		gate.discardSnapshots();
		await tick();
		expect(delivered).toEqual([]);
		const write = gate.write(bytes("queued protected"), "latest-snapshot");
		await gate.dispose();
		await write;
		expect(delivered).toEqual([]);
	});
});
