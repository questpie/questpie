import { expect, test } from "bun:test";

// A resume cursor advances progress; it does not change an active query identity.
import {
	RealtimeEdgeSession,
	type RealtimeEdgeBinding,
} from "../../src/server/modules/core/integrated/realtime/edge-session.js";
import type {
	RealtimeDesiredSubscription,
	RealtimeDesiredTopology,
} from "../../src/server/modules/core/integrated/realtime/topology-coordinator.js";

function query(sinceSeq?: number): RealtimeDesiredSubscription {
	return {
		kind: "query",
		id: "first",
		topic: {
			resourceType: "route",
			resource: "tasks/list",
			operation: "query",
			method: "POST",
			input: { companyId: "company", mine: true },
			params: {},
			locale: "sk",
		},
		...(sinceSeq === undefined ? {} : { sinceSeq }),
	};
}

function topology(
	revision: number,
	subscriptions: RealtimeDesiredSubscription[],
): RealtimeDesiredTopology {
	return { protocol: "questpie-realtime-topology", version: 2, revision, subscriptions };
}

function harness() {
	const events: string[] = [];
	const edge = new RealtimeEdgeSession(topology(0, []));
	let revision = 0;
	const apply = (subscriptions: RealtimeDesiredSubscription[], fail?: string) =>
		edge.apply(
			{
				topology: topology(++revision, subscriptions),
				ownerGeneration: 1,
				signal: new AbortController().signal,
			},
			async (subscription): Promise<RealtimeEdgeBinding> => {
				events.push(`bootstrap:${subscription.id}`);
				if (subscription.id === fail) throw new Error("Staging refused");
				return {
					activate: () => {
						events.push(`activate:${subscription.id}`);
					},
					close: () => {
						events.push(`close:${subscription.id}`);
					},
				};
			},
		);
	return { edge, events, apply };
}

test("adding a topic after cursor progress retains the active query and records its new cursor", async () => {
	const h = harness();
	await h.apply([query()]);
	h.events.length = 0;
	await h.apply([query(10), { ...query(), id: "second" }]);
	expect(h.events).toEqual(["bootstrap:second", "activate:second"]);
	expect(h.edge.topology.subscriptions[0]).toEqual(query(10));
	h.events.length = 0;
	await h.apply([query(10), { ...query(), id: "second" }]);
	expect(h.events).toEqual([]);
	await h.apply([query(9), { ...query(), id: "second" }]);
	expect(h.events).toEqual(["bootstrap:first", "activate:first", "close:first"]);
	await h.edge.close();
});

test("dropping an acknowledged cursor requests a fresh bootstrap", async () => {
	const h = harness();
	await h.apply([query()]);
	h.events.length = 0;
	await h.apply([query(0)]);
	expect(h.events).toEqual([]);
	await h.apply([query()]);
	expect(h.events).toEqual(["bootstrap:first", "activate:first", "close:first"]);
	await h.edge.close();
});

for (const [name, topic] of [
	["input", { input: { companyId: "other-company", mine: true } }],
	["params", { params: { space: "other-space" } }],
	["locale", { locale: "en" }],
	["resource", { resource: "home/attention" }],
] as const) {
	test(`changing query ${name} still replaces its binding`, async () => {
		const h = harness();
		const before = query(1);
		if (before.kind !== "query") throw new Error("Expected query");
		await h.apply([before]);
		h.events.length = 0;
		await h.apply([{ ...before, sinceSeq: 2, topic: { ...before.topic, ...topic } }]);
		expect(h.events).toEqual(["bootstrap:first", "activate:first", "close:first"]);
		await h.edge.close();
	});
}

test("failed graph admission does not commit a retained query's advanced cursor", async () => {
	const h = harness();
	await h.apply([query(5)]);
	await expect(h.apply([query(10), { ...query(), id: "rejected" }], "rejected")).rejects.toThrow(
		"Staging refused",
	);
	expect(h.edge.topology.subscriptions).toEqual([query(5)]);
	h.events.length = 0;
	await h.apply([query(7)]);
	expect(h.events).toEqual([]);
	await h.edge.close();
});

test("a new owner connection bootstraps and the closed owner cannot be reused", async () => {
	const previous = harness();
	await previous.apply([query(10)]);
	await previous.edge.close();
	await expect(previous.apply([query(11)])).rejects.toThrow("closed");
	const next = harness();
	await next.apply([query(11)]);
	expect(next.events).toEqual(["bootstrap:first", "activate:first"]);
	await next.edge.close();
});

test("channel replay cursor and CRDT binding changes keep their existing replacement contract", async () => {
	const h = harness();
	await h.apply([
		{ kind: "channel", id: "channel", channel: "presence", params: {}, lastEventId: "1" },
		{ kind: "crdt", id: "document", bindingId: "old" },
	]);
	h.events.length = 0;
	await h.apply([
		{ kind: "channel", id: "channel", channel: "presence", params: {}, lastEventId: "2" },
		{ kind: "crdt", id: "document", bindingId: "new" },
	]);
	expect(h.events).toEqual([
		"bootstrap:channel",
		"bootstrap:document",
		"activate:channel",
		"activate:document",
		"close:channel",
		"close:document",
	]);
	await h.edge.close();
});

test("canonical object key order does not change the active query identity", async () => {
	const h = harness();
	await h.apply([query(1)]);
	h.events.length = 0;
	await h.apply([
		{
			kind: "query",
			id: "first",
			sinceSeq: 2,
			topic: {
				locale: "sk",
				params: {},
				input: { mine: true, companyId: "company" },
				method: "POST",
				operation: "query",
				resource: "tasks/list",
				resourceType: "route",
			},
		},
	]);
	expect(h.events).toEqual([]);
	await h.edge.close();
});
