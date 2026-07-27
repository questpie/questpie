import { describe, expect, it } from "bun:test";

import {
	CrdtMutationError,
	type CrdtClientClock,
} from "../../../src/client/crdt/types.js";
import { CrdtExchangeHarness } from "./http-harness.js";

const GENERATION_A = "A".repeat(43);
const GENERATION_B = "B".repeat(43);

describe("CRDT awareness over the bounded exchange", () => {
	it("validates positions and emits at most one latest-wins write per 50 ms", async () => {
		const clock = fakeClock(1_000);
		const harness = new CrdtExchangeHarness({
			fields: [{ key: "title", fieldSlot: 1, format: "text", value: "A😀B" }],
			awarenessEnabled: true,
			clock,
		});
		const document = harness.createDocument();
		expect((document.awareness as any).enabled).toBe(false);
		expect(() => (document.awareness as any).set({ name: "Ada" })).toThrow(
			new CrdtMutationError("NOT_READY"),
		);
		await document.connect({ mode: "edit" });
		expect((document.awareness as any).enabled).toBe(true);

		(document.awareness as any).set(
			{ name: "Ada" },
			{ activeField: "title", cursor: 3, selectionEnd: 4 },
		);
		const latest = { name: "Grace" };
		(document.awareness as any).set(latest);
		latest.name = "mutated after set";
		expect(writeRequests(harness)).toHaveLength(0);
		clock.advance(49);
		await settle();
		expect(writeRequests(harness)).toHaveLength(0);
		clock.advance(1);
		await settle();

		expect(writeRequests(harness)).toHaveLength(1);
		expect(writeRequests(harness)[0]?.payload).toMatchObject({
			action: "write",
			value: {
				v: 1,
				kind: "awareness",
				value: { name: "Grace" },
			},
		});
		expect(() =>
			(document.awareness as any).set(
				{ name: "Ada" },
				{ activeField: "title", cursor: 2 },
			),
		).toThrow(new CrdtMutationError("INVALID_OPERATION"));
		expect(() =>
			(document.awareness as any).set({
				name: "Ada",
				activeField: "title",
			}),
		).toThrow(new CrdtMutationError("INVALID_OPERATION"));
	});

	it("rejects profile depth and byte abuse before exchange admission", async () => {
		const clock = fakeClock(1_000);
		const harness = new CrdtExchangeHarness({
			awarenessEnabled: true,
			clock,
		});
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });

		let nested: unknown = "leaf";
		for (let depth = 0; depth < 9; depth++) nested = { nested };
		expect(() => (document.awareness as any).set(nested)).toThrow(
			new CrdtMutationError("INVALID_OPERATION"),
		);
		expect(() =>
			(document.awareness as any).set({ bio: "x".repeat(513) }),
		).toThrow(new CrdtMutationError("INVALID_OPERATION"));
		clock.advance(50);
		await settle();
		expect(writeRequests(harness)).toHaveLength(0);
	});

	it("assembles out-of-order roster pages atomically after an awareness dirty marker", async () => {
		const clock = fakeClock(1_000);
		const harness = new CrdtExchangeHarness({
			awarenessEnabled: true,
			clock,
		});
		const document = harness.createDocument();
		await document.connect({ mode: "view" });
		const snapshots: unknown[] = [];
		(document.awareness as any).subscribe(() => {
			throw new Error("observer failure");
		});
		(document.awareness as any).subscribe((roster: unknown) =>
			snapshots.push(roster),
		);
		harness.setRoster([
			rosterPage(GENERATION_A, 1, 2, [
				participant("B".repeat(22), "00000000-0000-4000-8000-000000000002", {
					name: "Grace",
				}),
			]),
			rosterPage(GENERATION_A, 0, 2, [
				participant(
					"A".repeat(22),
					"00000000-0000-4000-8000-000000000001",
					{ name: "Ada" },
					{
						fieldSlot: 1,
						cursor: "AQAAAAE",
						selectionEnd: "AQAAAAI",
					},
				),
			]),
		]);

		harness.dirty("awareness");
		clock.advance(50);
		await waitUntil(() => (document.awareness as any).getRoster().length === 2);

		expect((document.awareness as any).getRoster()).toEqual([
			{
				participantId: "A".repeat(22),
				sessions: [
					{
						sessionId: "00000000-0000-4000-8000-000000000001",
						value: { name: "Ada" },
						active: { field: "title", cursor: 1, selectionEnd: 2 },
						expiresAtMs: 31_000,
					},
				],
			},
			{
				participantId: "B".repeat(22),
				sessions: [
					{
						sessionId: "00000000-0000-4000-8000-000000000002",
						value: { name: "Grace" },
						expiresAtMs: 31_000,
					},
				],
			},
		]);
		expect(snapshots).toHaveLength(1);

		harness.setRoster([
			rosterPage(GENERATION_B, 0, 1, [
				participant("C".repeat(22), "00000000-0000-4000-8000-000000000003", {
					name: "Lin",
				}),
			]),
		]);
		harness.dirty("awareness");
		clock.advance(50);
		await waitUntil(
			() =>
				(document.awareness as any).getRoster()[0]?.participantId ===
				"C".repeat(22),
		);
		clock.advance(30_001);
		await settle();
		expect((document.awareness as any).getRoster()).toEqual([]);
	});

	it("fails closed without publishing a conflicting duplicate page", async () => {
		const clock = fakeClock(1_000);
		const harness = new CrdtExchangeHarness({
			awarenessEnabled: true,
			clock,
		});
		const document = harness.createDocument();
		await document.connect({ mode: "view" });
		harness.setRoster([rosterPage(GENERATION_A, 0, 2, [])]);
		harness.dirty("awareness");
		clock.advance(50);
		await settle();
		expect((document.awareness as any).getRoster()).toEqual([]);

		harness.setRoster([
			rosterPage(GENERATION_A, 0, 2, [
				participant("A".repeat(22), "00000000-0000-4000-8000-000000000001", {
					name: "Ada",
				}),
			]),
		]);
		harness.dirty("awareness");
		clock.advance(50);
		await waitUntil(() => document.getSnapshot().status === "offline");

		expect((document.awareness as any).getRoster()).toEqual([]);
	});

	it("drops ephemeral roster state and incomplete generations on disconnect", async () => {
		const clock = fakeClock(1_000);
		const harness = new CrdtExchangeHarness({
			awarenessEnabled: true,
			clock,
		});
		const document = harness.createDocument();
		await document.connect({ mode: "view" });
		harness.setRoster([
			rosterPage(GENERATION_A, 0, 1, [
				participant("A".repeat(22), "00000000-0000-4000-8000-000000000001", {
					name: "Ada",
				}),
			]),
		]);
		harness.dirty("awareness");
		clock.advance(50);
		await waitUntil(() => (document.awareness as any).getRoster().length === 1);

		await document.disconnect();

		expect((document.awareness as any).getRoster()).toEqual([]);
	});
});

function writeRequests(harness: CrdtExchangeHarness) {
	return harness.sent.filter(
		(frame) => frame.opcode === 0x04 && frame.payload.action === "write",
	);
}

function participant(
	participantId: string,
	sessionId: string,
	value: unknown,
	active?: { fieldSlot: number; cursor?: string; selectionEnd?: string },
) {
	return {
		participantId,
		sessions: [
			{
				sessionId,
				value,
				expiresAtMs: 31_000,
				...(active ? { active } : {}),
			},
		],
	};
}

function rosterPage(
	generation: string,
	pageIndex: number,
	pageCount: number,
	participants: unknown[],
) {
	return {
		v: 1,
		kind: "roster-page",
		generation,
		pageIndex,
		pageCount,
		participants,
	};
}

function fakeClock(initial: number) {
	let now = initial;
	let nextId = 1;
	const timers = new Map<number, { due: number; callback: () => void }>();
	return {
		now: () => now,
		setTimeout(callback: () => void, delayMs: number) {
			const id = nextId++;
			timers.set(id, { due: now + delayMs, callback });
			return id;
		},
		clearTimeout(handle: unknown) {
			timers.delete(handle as number);
		},
		advance(ms: number) {
			now += ms;
			for (;;) {
				const ready = [...timers.entries()]
					.filter(([, timer]) => timer.due <= now)
					.sort((left, right) => left[1].due - right[1].due)[0];
				if (!ready) break;
				timers.delete(ready[0]);
				ready[1].callback();
			}
		},
	} satisfies CrdtClientClock & { advance(ms: number): void };
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await settle();
	}
	throw new Error("condition not reached");
}
