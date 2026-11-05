import { describe, expect, test } from "bun:test";

import { RealtimeService } from "../../src/server/modules/core/integrated/realtime/service.js";
import type {
	RealtimeChangeEvent,
	RealtimeTopics,
} from "../../src/server/modules/core/integrated/realtime/types.js";

/**
 * A route's LIVE dependency anchors on scalar equalities over the collection's own stored
 * fields, so a relation field there is its stored foreign key. A collection topic's relation
 * WHERE stays conservative: its relation keys may traverse the relation.
 */
function serviceWith(relations: Record<string, Record<string, string>>) {
	const realtime = new RealtimeService({} as never, { pollIntervalMs: 0 });
	realtime.setSubscriptionContext({
		resolveCollectionRelationNames: (collection) =>
			new Set(Object.keys(relations[collection] ?? {})),
		resolveCollectionDependencies: (collection, fragment) =>
			new Set([
				collection,
				...Object.keys(fragment ?? {}).flatMap((key) => {
					const target = relations[collection]?.[key];
					return target ? [target] : [];
				}),
			]),
	});
	return realtime;
}

let seq = 0;
function bulk(
	resource: string,
	companies: Array<[string, string]>,
	count = companies.length,
): RealtimeChangeEvent {
	return {
		seq: ++seq,
		resourceType: "collection",
		resource,
		operation: "bulk_update",
		payload: {
			count,
			recordIds: companies.map((_, index) => `b${index}`),
			rows: companies.map(([before, after], index) => ({
				before: { id: `b${index}`, company: before },
				after: { id: `b${index}`, company: after },
			})),
		},
		createdAt: new Date(),
	};
}

function change(
	resource: string,
	before: Record<string, string> | null,
	after: Record<string, string> | null,
): RealtimeChangeEvent {
	return {
		seq: ++seq,
		resourceType: "collection",
		resource,
		operation: "update",
		payload: { before, after },
		createdAt: new Date(),
	};
}

function woken(topic: RealtimeTopics, events: RealtimeChangeEvent[]) {
	const realtime = serviceWith({ posts: { company: "companies" } });
	const seen: number[] = [];
	const unsubscribe = realtime.subscribe(
		(event) => seen.push(event.seq),
		topic,
	);
	for (const event of events)
		(realtime as unknown as { emit(e: RealtimeChangeEvent): void }).emit(event);
	unsubscribe();
	return events.map((event) => seen.includes(event.seq));
}

describe("route LIVE dependency routing", () => {
	const events = () => [
		change("posts", { id: "p1", company: "c2" }, { id: "p1", company: "c2" }),
		change("posts", { id: "p2", company: "c1" }, { id: "p2", company: "c1" }),
		change("posts", { id: "p3", company: "c2" }, { id: "p3", company: "c1" }),
		change("posts", null, null),
		change("companies", { id: "c1" }, { id: "c1" }),
		bulk("posts", [
			["c2", "c2"],
			["c3", "c3"],
		]),
		bulk("posts", [
			["c2", "c2"],
			["c2", "c1"],
		]),
		bulk("posts", [["c2", "c2"]], 2),
	];

	test("a stored-field dependency routes a relation field by its stored foreign key", () => {
		expect(
			woken(
				{
					resourceType: "collection",
					resource: "posts",
					where: { company: "c1" },
					storedFieldWhere: true,
				},
				events(),
			),
		).toEqual([false, true, true, true, false, false, true, true]);
	});

	test("a collection topic's relation WHERE stays conservative", () => {
		expect(
			woken(
				{
					resourceType: "collection",
					resource: "posts",
					where: { company: "c1" },
				},
				events(),
			),
		).toEqual([true, true, true, true, true, true, true, true]);
	});
});
