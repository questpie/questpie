import { describe, expect, it } from "bun:test";

import type { RealtimeObservation } from "../../src/server/modules/core/integrated/realtime/observer.js";
import {
	RealtimeRefreshScheduler,
	resolveRealtimeAccessKey,
} from "../../src/server/modules/core/integrated/realtime/refresh-scheduler.js";
import type {
	RealtimeChangeEvent,
	RealtimeTopics,
} from "../../src/server/modules/core/integrated/realtime/types.js";

class FakeRealtimeSource {
	listeners = new Set<(event: RealtimeChangeEvent) => void>();

	async getLatestSeq() {
		return 4;
	}

	subscribe(
		listener: (event: RealtimeChangeEvent) => void,
		_topics: RealtimeTopics,
	) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(seq: number, change: Partial<RealtimeChangeEvent> = {}) {
		const event: RealtimeChangeEvent = {
			seq,
			resourceType: "collection",
			resource: "posts",
			operation: "update",
			createdAt: new Date(),
			...change,
		};
		for (const listener of this.listeners) listener(event);
	}
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function decodeFrame(frame: Uint8Array): Record<string, any> {
	const data = new TextDecoder()
		.decode(frame)
		.split("\n")
		.find((line) => line.startsWith("data: "))!;
	return JSON.parse(data.slice(6));
}

describe("realtime scheduler", () => {
	it("computes once for 100 equivalent subscribers and fans out one frame", async () => {
		const realtime = new FakeRealtimeSource();
		const scheduler = new RealtimeRefreshScheduler(realtime);
		let computes = 0;
		const frames = Array.from({ length: 100 }, () => [] as Uint8Array[]);

		const unsubscribers = frames.map((received) =>
			scheduler.subscribe({
				key: "posts:session-1",
				topicId: "posts",
				topics: { resourceType: "collection", resource: "posts" },
				compute: async () => ({ docs: [], totalDocs: ++computes }),
				onFrame: async (frame) => {
					received.push(frame);
				},
				onError: () => {},
			}),
		);

		await tick();
		expect(computes).toBe(1);
		expect(frames.every((received) => received.length === 1)).toBe(true);
		expect(realtime.listeners.size).toBe(1);

		for (const unsubscribe of unsubscribers) unsubscribe();
		expect(realtime.listeners.size).toBe(0);
	});

	it("deploy storm resumes 500 equivalent clients without a snapshot herd", async () => {
		const realtime = new FakeRealtimeSource();
		const observations: Array<{ type: string; subscribers?: number }> = [];
		const scheduler = new RealtimeRefreshScheduler(realtime, 10, {
			record: (event) => observations.push(event),
		});
		let computes = 0;
		const frames = Array.from({ length: 500 }, () => 0);
		const unsubscribers = frames.map((_, index) =>
			scheduler.subscribe({
				key: "posts:shared-principal",
				topicId: "posts",
				sinceSeq: 4,
				topics: { resourceType: "collection", resource: "posts" },
				compute: async () => ({ docs: [], run: ++computes }),
				onFrame: () => {
					frames[index] += 1;
				},
				onError: () => {},
			}),
		);

		await tick();
		expect(computes).toBe(0);
		expect(frames.every((count) => count === 0)).toBe(true);
		expect(realtime.listeners.size).toBe(1);

		realtime.emit(5);
		await tick();
		expect(computes).toBe(1);
		expect(frames.every((count) => count === 1)).toBe(true);
		expect(observations).toContainEqual(
			expect.objectContaining({ type: "refresh.completed", subscribers: 500 }),
		);

		for (const unsubscribe of unsubscribers) unsubscribe();
		expect(realtime.listeners.size).toBe(0);
	});

	it("does not share row, field, or afterRead output across access keys", async () => {
		for (const variant of [
			"row access",
			"field access",
			"afterRead",
		] as const) {
			const realtime = new FakeRealtimeSource();
			const scheduler = new RealtimeRefreshScheduler(realtime);
			const payloads: string[] = [];

			for (const principal of ["alice", "bob"] as const) {
				scheduler.subscribe({
					key: `posts:${principal}`,
					topicId: "posts",
					topics: { resourceType: "collection", resource: "posts" },
					compute: async () => ({ variant, principal }),
					onFrame: async (frame) =>
						payloads.push(new TextDecoder().decode(frame)),
					onError: () => {},
				});
			}

			await tick();
			expect(payloads).toHaveLength(2);
			expect(
				payloads.some((payload) => payload.includes('"principal":"alice"')),
			).toBe(true);
			expect(
				payloads.some((payload) => payload.includes('"principal":"bob"')),
			).toBe(true);
		}
	});

	it("suppresses an unchanged snapshot after a matching change", async () => {
		const realtime = new FakeRealtimeSource();
		const scheduler = new RealtimeRefreshScheduler(realtime);
		let frames = 0;
		let computes = 0;
		scheduler.subscribe({
			key: "posts:session-1",
			topicId: "posts",
			topics: { resourceType: "collection", resource: "posts" },
			compute: async () => {
				computes += 1;
				return { docs: [{ id: "1", title: "same" }] };
			},
			onFrame: async () => {
				frames += 1;
			},
			onError: () => {},
		});

		await tick();
		realtime.emit(5);
		await tick();

		expect(computes).toBe(2);
		expect(frames).toBe(1);
	});

	it("skips a deploy-restart snapshot when sinceSeq is already current", async () => {
		const realtime = new FakeRealtimeSource();
		const scheduler = new RealtimeRefreshScheduler(realtime);
		let computes = 0;
		const frames: string[] = [];
		scheduler.subscribe({
			key: "posts:session-1:since-4",
			topicId: "posts",
			topics: { resourceType: "collection", resource: "posts" },
			sinceSeq: 4,
			compute: async () => ({ docs: [], run: ++computes }),
			onFrame: (frame) => frames.push(new TextDecoder().decode(frame)),
			onError: () => {},
		});

		await tick();
		expect(computes).toBe(0);
		expect(frames).toHaveLength(0);

		realtime.emit(5);
		await tick();
		expect(computes).toBe(1);
		expect(frames[0]).toContain('"seq":5');
		expect(frames[0]).toContain('"reset":false');
	});

	it("captures and emits the watermark before snapshot computation", async () => {
		const realtime = new FakeRealtimeSource();
		const scheduler = new RealtimeRefreshScheduler(realtime);
		const order: string[] = [];
		const frames: Uint8Array[] = [];
		const stop = scheduler.subscribe({
			key: "posts:watermarked-snapshot",
			topicId: "posts",
			topics: { resourceType: "collection", resource: "posts" },
			captureWatermark: async () => {
				order.push("watermark");
				return "41";
			},
			compute: async () => {
				order.push("compute");
				return { docs: [] };
			},
			onFrame: (frame) => frames.push(frame),
			onError: () => {},
		});
		await tick();
		await tick();
		stop();

		expect(order).toEqual(["watermark", "compute"]);
		expect(decodeFrame(frames[0]!).upToDate).toBe("41");
	});

	it("emits an idle watermark heartbeat without recomputing", async () => {
		const realtime = new FakeRealtimeSource();
		const scheduler = new RealtimeRefreshScheduler(realtime);
		const frames: Uint8Array[] = [];
		let computes = 0;
		const stop = scheduler.subscribe({
			key: "posts:watermark-heartbeat",
			topicId: "posts",
			topics: { resourceType: "collection", resource: "posts" },
			captureWatermark: async () => "43",
			heartbeatIntervalMs: 10,
			compute: async () => ({ docs: [], compute: ++computes }),
			onFrame: (frame) => frames.push(frame),
			onError: () => {},
		});
		await new Promise((resolve) => setTimeout(resolve, 25));
		stop();

		expect(computes).toBe(1);
		expect(
			frames
				.map(decodeFrame)
				.some(
					(frame) => frame.type === "up-to-date" && frame.upToDate === "43",
				),
		).toBe(true);
	});

	it("bounds refresh computation concurrency", async () => {
		const realtime = new FakeRealtimeSource();
		const scheduler = new RealtimeRefreshScheduler(realtime, 2);
		let active = 0;
		let maximum = 0;

		for (let index = 0; index < 6; index += 1) {
			scheduler.subscribe({
				key: `topic-${index}`,
				topicId: `topic-${index}`,
				topics: { resourceType: "collection", resource: "posts" },
				compute: async () => {
					active += 1;
					maximum = Math.max(maximum, active);
					await new Promise((resolve) => setTimeout(resolve, 5));
					active -= 1;
					return { index };
				},
				onFrame: async () => {},
				onError: () => {},
			});
		}

		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(maximum).toBe(2);
	});

	it("bootstraps each late delta subscriber before forwarding newer rows", async () => {
		const realtime = new FakeRealtimeSource();
		const scheduler = new RealtimeRefreshScheduler(realtime);
		let rows = [{ id: "1", title: "One" }];
		let computes = 0;
		const first: Uint8Array[] = [];
		const second: Uint8Array[] = [];
		const input = {
			key: "posts:shared-delta",
			topicId: "posts",
			topics: { resourceType: "collection" as const, resource: "posts" },
			mode: "delta" as const,
			compute: async () => {
				computes += 1;
				return { docs: rows, totalDocs: rows.length };
			},
			hydrateRows: async (ids: string[]) => ({
				docs: rows.filter((row) => ids.includes(row.id)),
			}),
			onError: () => {},
		};

		const stopFirst = scheduler.subscribe({
			...input,
			onFrame: (frame: Uint8Array) => first.push(frame),
		});
		await tick();
		await tick();
		expect(
			first.map(decodeFrame).map((frame) => frame.type ?? "snapshot"),
		).toEqual(["snapshot"]);

		rows = [...rows, { id: "2", title: "Two" }];
		realtime.emit(5, { operation: "create", recordId: "2" });
		await tick();
		await tick();
		expect(
			first.map(decodeFrame).map((frame) => frame.type ?? "snapshot"),
		).toEqual(["snapshot", "insert", "up-to-date"]);

		const stopSecond = scheduler.subscribe({
			...input,
			topicId: "posts-second",
			onFrame: (frame: Uint8Array) => second.push(frame),
		});
		await tick();
		await tick();
		expect(computes).toBe(2);
		expect(second.map(decodeFrame)).toEqual([
			expect.objectContaining({
				topicId: "posts-second",
				seq: 5,
				data: { docs: rows, totalDocs: 2 },
			}),
		]);

		rows = rows.map((row) =>
			row.id === "2" ? { ...row, title: "Two updated" } : row,
		);
		realtime.emit(6, { operation: "update", recordId: "2" });
		await tick();
		await tick();
		expect(first.map(decodeFrame).at(-2)?.type).toBe("update");
		expect(second.map(decodeFrame).at(-2)?.type).toBe("update");
		expect(second.map(decodeFrame).at(-2)?.topicId).toBe("posts-second");

		stopFirst();
		stopSecond();
	});

	it("collapses a delta queue overflow to one authoritative reset", async () => {
		const realtime = new FakeRealtimeSource();
		const observations: RealtimeObservation[] = [];
		const scheduler = new RealtimeRefreshScheduler(realtime, 10, {
			record: (event) => observations.push(event),
		});
		const frames: Uint8Array[] = [];
		let releaseHydration: () => void = () => {};
		const hydrationBlocked = new Promise<void>((resolve) => {
			releaseHydration = resolve;
		});
		const stop = scheduler.subscribe({
			key: "posts:overflow-delta",
			topicId: "posts",
			topics: { resourceType: "collection", resource: "posts" },
			mode: "delta",
			maxDeltaQueueEvents: 1,
			maxDeltaQueueBytes: 1024 * 1024,
			compute: async () => ({ docs: [{ id: "1" }], totalDocs: 1 }),
			hydrateRows: async () => {
				await hydrationBlocked;
				return { docs: [{ id: "1" }] };
			},
			onFrame: (frame) => frames.push(frame),
			onError: () => {},
		});
		await tick();
		await tick();

		realtime.emit(5, { recordId: "1" });
		await tick();
		realtime.emit(6, { recordId: "2" });
		realtime.emit(7, { recordId: "3" });
		releaseHydration();
		await tick();
		await tick();
		stop();

		expect(observations).toContainEqual({
			type: "delta.fallback_snapshot",
			reason: "queue_overflow",
		});
		expect(frames.map(decodeFrame).some((frame) => frame.reset === true)).toBe(
			true,
		);
	});

	it("never grows retained delta row state past its admission cap", async () => {
		const realtime = new FakeRealtimeSource();
		const observations: RealtimeObservation[] = [];
		const scheduler = new RealtimeRefreshScheduler(realtime, 10, {
			record: (event) => observations.push(event),
		});
		const frames: Uint8Array[] = [];
		const stop = scheduler.subscribe({
			key: "posts:row-cap",
			topicId: "posts",
			topics: { resourceType: "collection", resource: "posts" },
			mode: "delta",
			maxDeltaRows: 1,
			compute: async () => ({ docs: [{ id: "1" }], totalDocs: 1 }),
			hydrateRows: async () => ({ docs: [{ id: "2" }] }),
			onFrame: (frame) => frames.push(frame),
			onError: () => {},
		});
		await tick();
		await tick();
		realtime.emit(5, { operation: "create", recordId: "2" });
		await tick();
		await tick();
		stop();

		expect(observations).toContainEqual({
			type: "delta.fallback_snapshot",
			reason: "row_cap",
		});
		expect(frames.map(decodeFrame).at(-1)?.reset).toBe(true);
	});

	it("re-bootstraps when a watched access dependency changes", async () => {
		const realtime = new FakeRealtimeSource();
		const frames: Uint8Array[] = [];
		const scheduler = new RealtimeRefreshScheduler(realtime);
		const stop = scheduler.subscribe({
			key: "posts:access-dependency",
			topicId: "posts",
			topics: { resourceType: "collection", resource: "posts" },
			mode: "delta",
			compute: async () => ({ docs: [], totalDocs: 0 }),
			hydrateRows: async () => ({ docs: [] }),
			onFrame: (frame) => frames.push(frame),
			onError: () => {},
		});
		await tick();
		await tick();
		realtime.emit(5, { resource: "memberships", recordId: "membership-1" });
		await tick();
		await tick();
		stop();

		expect(frames.map(decodeFrame).at(-1)?.reset).toBe(true);
	});

	it("isolates delta hydration by locale and principal access key", async () => {
		for (const variants of [
			["en", "de"],
			["alice", "bob"],
		] as const) {
			const realtime = new FakeRealtimeSource();
			const scheduler = new RealtimeRefreshScheduler(realtime);
			const received = new Map<string, Uint8Array[]>();
			const stops = variants.map((variant) => {
				const frames: Uint8Array[] = [];
				received.set(variant, frames);
				const row = { id: "1", value: variant };
				const updatedRow = { id: "1", value: `${variant}-updated` };
				return scheduler.subscribe({
					key: `posts:${variant}`,
					topicId: `posts-${variant}`,
					topics: { resourceType: "collection", resource: "posts" },
					mode: "delta",
					compute: async () => ({ docs: [row], totalDocs: 1 }),
					hydrateRows: async () => ({ docs: [updatedRow] }),
					onFrame: (frame) => frames.push(frame),
					onError: () => {},
				});
			});
			await tick();
			await tick();
			realtime.emit(5, { recordId: "1" });
			await tick();
			await tick();

			for (const variant of variants) {
				const ownFrames = received.get(variant)!.map(decodeFrame);
				expect(
					ownFrames.find((frame) => frame.type === "update")?.row.value,
				).toBe(`${variant}-updated`);
			}
			for (const stop of stops) stop();
		}
	});

	it("periodically re-bootstraps delta groups through an ordered reset", async () => {
		const realtime = new FakeRealtimeSource();
		const observations: RealtimeObservation[] = [];
		const scheduler = new RealtimeRefreshScheduler(realtime, 10, {
			record: (event) => observations.push(event),
		});
		const frames: Uint8Array[] = [];
		const stop = scheduler.subscribe({
			key: "posts:periodic-delta",
			topicId: "posts",
			topics: { resourceType: "collection", resource: "posts" },
			mode: "delta",
			compute: async () => ({ docs: [{ id: "1" }], totalDocs: 1 }),
			hydrateRows: async () => ({ docs: [] }),
			deltaRebootstrapIntervalMs: 10,
			onFrame: (frame) => frames.push(frame),
			onError: () => {},
		});

		await new Promise((resolve) => setTimeout(resolve, 25));
		stop();
		const decoded = frames.map(decodeFrame);
		expect(decoded.length).toBeGreaterThanOrEqual(2);
		expect(decoded[0]).toEqual(expect.objectContaining({ reset: false }));
		expect(decoded.slice(1).every((frame) => frame.reset === true)).toBe(true);
		expect(observations).toContainEqual({
			type: "delta.fallback_snapshot",
			reason: "periodic",
		});
		expect(
			observations.some(
				(event) =>
					event.type === "delta.emitted" && event.operation === "snapshot",
			),
		).toBe(true);
	});

	it("observes delta buffers, suppression, and emitted frames", async () => {
		const realtime = new FakeRealtimeSource();
		const observations: RealtimeObservation[] = [];
		const scheduler = new RealtimeRefreshScheduler(realtime, 10, {
			record: (event) => observations.push(event),
		});
		const row = { id: "1", title: "Unchanged" };
		const frames: Uint8Array[] = [];
		const stop = scheduler.subscribe({
			key: "posts:observed-delta",
			topicId: "posts",
			topics: { resourceType: "collection", resource: "posts" },
			mode: "delta",
			captureWatermark: async () => "50",
			compute: async () => ({ docs: [row], totalDocs: 1 }),
			hydrateRows: async () => ({ docs: [row] }),
			onFrame: (frame) => frames.push(frame),
			onError: () => {},
		});
		await tick();
		await tick();
		realtime.emit(5, { operation: "update", recordId: "1" });
		await tick();
		await tick();
		stop();

		expect(observations).toContainEqual({
			type: "delta.suppressed",
			reason: "unchanged",
		});
		expect(
			observations.some(
				(event) => event.type === "delta.buffer" && event.scope === "group",
			),
		).toBe(true);
		expect(
			observations.some(
				(event) =>
					event.type === "delta.emitted" && event.operation === "up-to-date",
			),
		).toBe(true);
		expect(
			frames.map(decodeFrame).find((frame) => frame.type === "up-to-date")
				?.upToDate,
		).toBe("50");
	});
});

describe("realtime scheduler access keys", () => {
	it("uses session identity by default and only shares through an explicit key", async () => {
		const base = {
			locale: "en",
			stage: "published",
			accessMode: "user" as const,
		};
		const alice = {
			...base,
			principal: {
				kind: "user" as const,
				user: { id: "alice" },
				session: { id: "session-a" },
			},
		};
		const bob = {
			...base,
			principal: {
				kind: "user" as const,
				user: { id: "bob" },
				session: { id: "session-b" },
			},
		};

		const aliceDefault = await resolveRealtimeAccessKey("edge-a", alice);
		const bobDefault = await resolveRealtimeAccessKey("edge-b", bob);
		expect(aliceDefault).not.toBe(bobDefault);

		const resolver = async () => "public-read";
		expect(await resolveRealtimeAccessKey("edge-a", alice, resolver)).toBe(
			await resolveRealtimeAccessKey("edge-b", bob, resolver),
		);
	});
});
