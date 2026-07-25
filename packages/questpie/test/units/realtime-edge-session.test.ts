import { expect, test } from "bun:test";

import {
	RealtimeBindingOutputGate,
	RealtimeEdgeSession,
	type RealtimeEdgeBinding,
} from "../../src/server/modules/core/integrated/realtime/edge-session.js";
import type {
	RealtimeDesiredSubscription,
	RealtimeDesiredTopology,
} from "../../src/server/modules/core/integrated/realtime/topology-coordinator.js";
import type {
	ClientSink,
	DeliveryClass,
} from "../../src/server/modules/core/integrated/realtime/transport.js";

function topology(
	revision: number,
	subscriptions: RealtimeDesiredSubscription[],
): RealtimeDesiredTopology {
	return {
		protocol: "questpie-realtime-topology",
		version: 2,
		revision,
		subscriptions,
	};
}

function query(id: string, resource = id): RealtimeDesiredSubscription {
	return {
		kind: "query",
		id,
		topic: { resourceType: "collection", resource },
	};
}

function binding(id: string, events: string[]): RealtimeEdgeBinding {
	return {
		activate: () => events.push(`activate:${id}`),
		close: () => events.push(`close:${id}`),
	};
}

test("realtime edge session stages all bindings before one atomic swap", async () => {
	const events: string[] = [];
	const edge = new RealtimeEdgeSession(
		topology(0, [query("old")]),
		new Map([
			[
				"old",
				{
					subscription: query("old"),
					binding: binding("old", events),
				},
			],
		]),
	);

	let releaseSecond!: () => void;
	let markSecondStarted!: () => void;
	const secondStaged = new Promise<void>((resolve) => {
		releaseSecond = resolve;
	});
	const secondStarted = new Promise<void>((resolve) => {
		markSecondStarted = resolve;
	});
	const applying = edge.apply(
		{
			topology: topology(1, [query("next-a"), query("next-b")]),
			ownerGeneration: 7,
			signal: new AbortController().signal,
		},
		async (subscription) => {
			events.push(`stage:${subscription.id}`);
			if (subscription.id === "next-b") {
				markSecondStarted();
				await secondStaged;
			}
			return binding(subscription.id, events);
		},
	);

	await secondStarted;
	expect(edge.has("old")).toBe(true);
	expect(edge.has("next-a")).toBe(false);
	expect(events).toEqual(["stage:next-a", "stage:next-b"]);

	releaseSecond();
	await applying;

	expect(edge.has("old")).toBe(false);
	expect(edge.has("next-a")).toBe(true);
	expect(edge.has("next-b")).toBe(true);
	expect(edge.topology.revision).toBe(1);
	expect(events).toEqual([
		"stage:next-a",
		"stage:next-b",
		"activate:next-a",
		"activate:next-b",
		"close:old",
	]);
});

test("realtime edge session rolls back every staged binding on failure", async () => {
	const events: string[] = [];
	const oldSubscription = query("old");
	const edge = new RealtimeEdgeSession(
		topology(0, [oldSubscription]),
		new Map([
			[
				"old",
				{
					subscription: oldSubscription,
					binding: binding("old", events),
				},
			],
		]),
	);

	await expect(
		edge.apply(
			{
				topology: topology(1, [query("next-a"), query("next-b")]),
				ownerGeneration: 7,
				signal: new AbortController().signal,
			},
			async (subscription) => {
				if (subscription.id === "next-b") throw new Error("stage failed");
				return binding(subscription.id, events);
			},
		),
	).rejects.toThrow("stage failed");

	expect(edge.topology.revision).toBe(0);
	expect(edge.has("old")).toBe(true);
	expect(edge.has("next-a")).toBe(false);
	expect(events).toEqual(["close:next-a"]);
});

test("realtime edge session rejects an asynchronously broken staged binding before swap", async () => {
	const events: string[] = [];
	const oldSubscription = query("old");
	const edge = new RealtimeEdgeSession(
		topology(0, [oldSubscription]),
		new Map([
			[
				"old",
				{
					subscription: oldSubscription,
					binding: binding("old", events),
				},
			],
		]),
	);

	await expect(
		edge.apply(
			{
				topology: topology(1, [query("next-a"), query("next-b")]),
				ownerGeneration: 7,
				signal: new AbortController().signal,
			},
			async (subscription) => ({
				...binding(subscription.id, events),
				...(subscription.id === "next-a"
					? {
							assertReady: () => {
								throw new Error("candidate bootstrap failed");
							},
						}
					: {}),
			}),
		),
	).rejects.toThrow("candidate bootstrap failed");

	expect(edge.topology.revision).toBe(0);
	expect(edge.has("old")).toBe(true);
	expect(edge.has("next-a")).toBe(false);
	expect(events).toEqual(["close:next-a", "close:next-b"]);
});

test("realtime edge session reuses unchanged bindings and fences late staging", async () => {
	const events: string[] = [];
	const oldSubscription = query("same");
	const edge = new RealtimeEdgeSession(
		topology(0, [oldSubscription]),
		new Map([
			[
				"same",
				{
					subscription: oldSubscription,
					binding: binding("same", events),
				},
			],
		]),
	);
	const owner = new AbortController();

	await edge.apply(
		{
			topology: topology(1, [oldSubscription]),
			ownerGeneration: 3,
			signal: owner.signal,
		},
		async () => {
			throw new Error("unchanged binding must not be staged");
		},
	);
	expect(edge.topology.revision).toBe(1);
	expect(events).toEqual([]);

	await expect(
		edge.apply(
			{
				topology: topology(2, [query("late")]),
				ownerGeneration: 3,
				signal: owner.signal,
			},
			async (subscription) => {
				owner.abort();
				return binding(subscription.id, events);
			},
		),
	).rejects.toThrow("Realtime owner is fenced");

	expect(edge.topology.revision).toBe(1);
	expect(edge.has("same")).toBe(true);
	expect(edge.has("late")).toBe(false);
	expect(events).toEqual(["close:late"]);
});

test("binding output gate stays silent until activation and preserves delivery classes", async () => {
	const writes: Array<{ text: string; delivery: DeliveryClass }> = [];
	const sink: ClientSink = {
		sessionId: "session",
		write: async (frame, delivery) => {
			writes.push({ text: new TextDecoder().decode(frame), delivery });
			return { status: "accepted", bufferedBytes: 0 };
		},
		close: async () => {},
	};
	const errors: unknown[] = [];
	const gate = new RealtimeBindingOutputGate(sink, {
		maximumOrderedEvents: 4,
		maximumBufferedBytes: 100,
		onError: (error) => errors.push(error),
	});
	const encode = (value: string) => new TextEncoder().encode(value);

	await gate.write(encode("old snapshot"), "latest-snapshot");
	await gate.write(encode("new snapshot"), "latest-snapshot");
	await gate.write(encode("delta 1"), "row-delta");
	await gate.write(encode("delta 2"), "row-delta");
	expect(writes).toEqual([]);

	gate.activate();
	await gate.write(encode("delta 3"), "row-delta");

	expect(writes).toEqual([
		{ text: "new snapshot", delivery: "latest-snapshot" },
		{ text: "delta 1", delivery: "row-delta" },
		{ text: "delta 2", delivery: "row-delta" },
		{ text: "delta 3", delivery: "row-delta" },
	]);
	expect(errors).toEqual([]);
});

test("binding output gate bounds staged ordered output and discards rollback", async () => {
	const writes: string[] = [];
	const sink: ClientSink = {
		sessionId: "session",
		write: async (frame) => {
			writes.push(new TextDecoder().decode(frame));
			return { status: "accepted", bufferedBytes: 0 };
		},
		close: async () => {},
	};
	const gate = new RealtimeBindingOutputGate(sink, {
		maximumOrderedEvents: 1,
		maximumBufferedBytes: 100,
		onError: () => {},
	});
	const encode = (value: string) => new TextEncoder().encode(value);

	await gate.write(encode("kept only if activated"), "ordered-channel-event");
	await expect(
		gate.write(encode("overflow"), "ordered-channel-event"),
	).rejects.toThrow("event buffer overflow");
	await gate.dispose();
	gate.activate();

	expect(writes).toEqual([]);
});
