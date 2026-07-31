/**
 * `start()` must mean "subscribed", not "reader connected".
 *
 * `RedisStreamsChangeBroker.start()` connected the reader and then launched the
 * read loop WITHOUT awaiting it, and the loop opened with `XREAD ... id="$"`.
 * `$` means "messages that arrive after this call reaches the server", so
 * anything published in the gap between `start()` resolving and the loop's
 * first `xRead` was dropped and never redelivered:
 *
 *     await broker.start({ onWake });
 *     await broker.publish(wake);   // could vanish
 *
 * `pg-notify` never had this problem — its `start()` awaits `LISTEN`, so the
 * subscription exists before it returns. Two implementations of one
 * `ChangeBroker` interface were giving different delivery guarantees.
 *
 * This surfaced as a flaky CI failure in the driver matrix
 * (`redis streams matrix delivery timed out`, the full 10s deadline rather than
 * a near-miss, which is the signature of a message that never arrives rather
 * than a slow one).
 *
 * The fake below pins the ordering that the real race only hits sometimes:
 * `xRead` waits on a gate the test opens *after* publishing, so the publish is
 * guaranteed to land before the first read. Under `$` semantics that message is
 * unobservable; the assertion is that it is delivered anyway.
 */
import { describe, expect, test } from "bun:test";

import {
	RedisStreamsChangeBroker,
	type RedisStreamsClient,
} from "../../src/server/modules/core/integrated/realtime/adapters/redis-streams.js";
import type { ChangeWake } from "../../src/server/modules/core/integrated/realtime/transport.js";

type Entry = { id: string; fields: Record<string, string> };

/**
 * Minimal in-memory Redis Streams stand-in with real `$` semantics: a read
 * issued with `$` resolves the position at CALL time, so it cannot see anything
 * added earlier.
 */
function createFakeRedis(gate: Promise<void>) {
	const entries: Entry[] = [];
	let seq = 0;
	let firstRead = true;

	const client: RedisStreamsClient = {
		async xAdd(_stream, _id, fields) {
			seq += 1;
			const id = `1-${seq}`;
			entries.push({ id, fields });
			return id;
		},
		async xRead(streams, options) {
			// Hold the very first read until the test says go, forcing the publish
			// to happen first. This is the race, made deterministic.
			if (firstRead) {
				firstRead = false;
				await gate;
			}
			const requested = streams[0]!;
			const after =
				requested.id === "$"
					? (entries.at(-1)?.id ?? "0-0") // `$` = only what comes later
					: requested.id;
			const fresh = entries.filter((e) => e.id > after);
			if (fresh.length === 0) {
				// Honour BLOCK. Returning immediately would make the broker's read
				// loop spin on microtasks, which starves the macrotask queue and
				// hangs any timer the test is waiting on — the fake has to block
				// like the real client does.
				await new Promise((resolve) =>
					setTimeout(resolve, options?.BLOCK ?? 5),
				);
				return null;
			}
			return [{ name: requested.key, messages: fresh }];
		},
		async xInfoStream() {
			return { "last-generated-id": entries.at(-1)?.id ?? "0-0" };
		},
	};
	return client;
}

const WAKE: ChangeWake = {
	kind: "outbox-maybe-advanced",
	highWaterSeq: 7,
	reason: "publish",
};

describe("RedisStreamsChangeBroker start window", () => {
	test("delivers a wake published immediately after start() resolves", async () => {
		let openGate!: () => void;
		const gate = new Promise<void>((resolve) => {
			openGate = resolve;
		});
		const client = createFakeRedis(gate);

		const received: ChangeWake[] = [];
		let resolveWake!: () => void;
		const gotWake = new Promise<void>((resolve) => {
			resolveWake = resolve;
		});

		const broker = new RedisStreamsChangeBroker({
			client,
			reader: client,
			stream: "test-stream",
			blockMs: 5,
		});

		await broker.start({
			onWake: (wake) => {
				received.push(wake);
				resolveWake();
			},
			onError: () => {},
		});

		// `stop()` must run even when the assertion below fails, or the read loop
		// keeps spinning and the whole test file hangs instead of reporting.
		try {
			// The gap: start() has resolved, the read loop has not read yet.
			await broker.publish(WAKE);
			openGate();

			await Promise.race([
				gotWake,
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("wake was never delivered")),
						2_000,
					),
				),
			]);

			expect(received).toHaveLength(1);
			expect(received[0]?.highWaterSeq).toBe(7);
		} finally {
			await broker.stop();
		}
	});

	test("subscribes from a concrete id, never from $", async () => {
		// The direct statement of the fix, and the one that cannot hang: `$` is
		// resolved at read time by the server, so using it at all reopens the gap
		// regardless of how fast the loop starts. Asserting the id the first read
		// carries is a stronger and faster check than waiting for a delivery.
		const seenIds: string[] = [];
		const base = createFakeRedis(Promise.resolve());
		const client: RedisStreamsClient = {
			...base,
			async xRead(streams, options) {
				seenIds.push(streams[0]!.id);
				return base.xRead(streams, options);
			},
		};

		const broker = new RedisStreamsChangeBroker({
			client,
			reader: client,
			stream: "test-stream",
			blockMs: 5,
		});
		try {
			await broker.start({ onWake: () => {}, onError: () => {} });
			// Give the loop a turn to issue its first read.
			await new Promise((resolve) => setTimeout(resolve, 20));
		} finally {
			await broker.stop();
		}

		expect(seenIds.length).toBeGreaterThan(0);
		expect(seenIds[0]).not.toBe("$");
	});

	test("falls back safely when the client cannot report stream info", async () => {
		// A client without xInfoStream keeps the old `$` behaviour rather than
		// throwing — the gap returns, but nothing breaks.
		const gate = Promise.resolve();
		const client = createFakeRedis(gate);
		const { xInfoStream: _dropped, ...withoutInfo } = client;

		const broker = new RedisStreamsChangeBroker({
			client: withoutInfo as RedisStreamsClient,
			reader: withoutInfo as RedisStreamsClient,
			stream: "test-stream",
			blockMs: 5,
		});

		await broker.start({ onWake: () => {}, onError: () => {} });
		await broker.stop();
	});
});
