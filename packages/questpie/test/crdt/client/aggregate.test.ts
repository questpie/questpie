import { describe, expect, it } from "bun:test";

import { createClientSetSnapshot } from "../../../src/client/crdt/set-engine.js";
import {
	CrdtAnchorError,
	CrdtMutationError,
} from "../../../src/client/crdt/types.js";
import { CrdtExchangeHarness } from "./http-harness.js";

const AGGREGATE_FIELDS = [
	{ key: "title", fieldSlot: 1, format: "text", value: "Draft" },
	{ key: "tags", fieldSlot: 2, format: "set", value: [] },
	{ key: "content", fieldSlot: 3, format: "text", value: "Body" },
] as const;

describe("CRDT aggregate transactions over typed exchange", () => {
	it("enforces the deterministic set element ceiling", () => {
		expect(() =>
			createClientSetSnapshot(
				Array.from({ length: 10_001 }, (_, index) => `tag-${index}`),
			),
		).toThrow(new CrdtMutationError("INVALID_OPERATION"));
	});

	it("opens through one shared realtime capability and installs a verified pull", async () => {
		const harness = new CrdtExchangeHarness({ fields: AGGREGATE_FIELDS });
		const document = harness.createDocument();

		await document.connect({ mode: "edit" });

		expect(document.getSnapshot()).toEqual({
			status: "ready",
			fieldGrants: { title: "edit", tags: "edit", content: "edit" },
			fieldSyncing: [],
			pendingUpdates: 0,
		});
		expect((document.fields.title as any).text.value()).toBe("Draft");
		expect((document.fields.tags as any).set.values()).toEqual([]);
		expect((document.fields.content as any).text.value()).toBe("Body");
		expect(harness.opened).toHaveLength(1);
		expect(harness.registrations).toHaveLength(1);
		expect(harness.sent.map((frame) => frame.opcode)).toContain(0x01);
	});

	it("creates and resolves a durable range on a readable text field", async () => {
		const harness = new CrdtExchangeHarness({ fields: AGGREGATE_FIELDS });
		const document = harness.createDocument();
		await document.connect({ mode: "view" });

		const anchor = (document.fields.content as any).anchors.create({
			kind: "range",
			start: 0,
			end: 4,
		});

		expect(typeof anchor).toBe("string");
		expect(anchor.length).toBeLessThanOrEqual(2_048);
		expect((document.fields.content as any).anchors.resolve(anchor)).toEqual({
			status: "resolved",
			kind: "range",
			start: 0,
			end: 4,
		});
	});

	it("rejects anchor creation from an unacknowledged local text state", async () => {
		const harness = new CrdtExchangeHarness({
			fields: AGGREGATE_FIELDS,
			autoAcknowledge: false,
		});
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		(document.fields.content as any).text.apply([
			{ type: "insert", index: 4, value: " pending" },
		]);

		expect(() =>
			(document.fields.content as any).anchors.create({
				kind: "point",
				offset: 4,
			}),
		).toThrow(new CrdtAnchorError("UNACKNOWLEDGED_STATE"));
	});

	it("rejects anchor creation inside an active aggregate transaction", async () => {
		const harness = new CrdtExchangeHarness({ fields: AGGREGATE_FIELDS });
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });

		expect(() =>
			document.transaction(({ fields }: any) => {
				fields.content.anchors.create({ kind: "point", offset: 2 });
			}),
		).toThrow(new CrdtAnchorError("UNACKNOWLEDGED_STATE"));
	});

	it("rejects anchor creation while a refreshed field basis is syncing", async () => {
		const harness = new CrdtExchangeHarness({ fields: AGGREGATE_FIELDS });
		const document = harness.createDocument();
		await document.connect({ mode: "view" });
		harness.setText(3, "Remote body", 1n);
		let releasePull: (() => void) | undefined;
		harness.responseOverride = (request, response) =>
			request.opcode === 0x01
				? new Promise((resolve) => {
						releasePull = () => resolve(response);
					})
				: response;

		harness.dirty("visible");
		await waitUntil(() => document.getSnapshot().status === "synchronizing");
		expect(() =>
			(document.fields.content as any).anchors.create({
				kind: "point",
				offset: 2,
			}),
		).toThrow(new CrdtAnchorError("UNACKNOWLEDGED_STATE"));
		harness.responseOverride = undefined;
		releasePull?.();
		await waitUntil(() => document.getSnapshot().status === "ready");
	});

	it("detaches malformed and cross-boundary anchor tokens without disclosure", async () => {
		const firstHarness = new CrdtExchangeHarness({
			fields: AGGREGATE_FIELDS,
			incarnationKey: "00000000-0000-4000-8000-000000000030",
		});
		const secondHarness = new CrdtExchangeHarness({
			fields: AGGREGATE_FIELDS.map((field) =>
				field.key === "content" ? { ...field, fieldEpoch: 2n } : field,
			),
			incarnationKey: "00000000-0000-4000-8000-000000000031",
		});
		const first = firstHarness.createDocument();
		const second = secondHarness.createDocument();
		await first.connect({ mode: "view" });
		await second.connect({ mode: "view" });
		const anchor = (first.fields.content as any).anchors.create({
			kind: "point",
			offset: 2,
		});

		expect((first.fields.title as any).anchors.resolve(anchor)).toEqual({
			status: "detached",
		});
		expect((second.fields.content as any).anchors.resolve(anchor)).toEqual({
			status: "detached",
		});
		for (const token of [
			"",
			"not-an-anchor",
			anchor.replace("qpa1_", "qpa2_"),
			`${anchor}A`,
			`qpa1_${"A".repeat(2_044)}`,
		]) {
			expect((first.fields.content as any).anchors.resolve(token)).toEqual({
				status: "detached",
			});
		}
	});

	it("publishes title, tags, and content as one sorted all-or-nothing append", async () => {
		const harness = new CrdtExchangeHarness({ fields: AGGREGATE_FIELDS });
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		const beforeRevision = document.replicaRevision;

		document.transaction(({ fields }: any) => {
			fields.content.text.apply([{ type: "insert", index: 4, value: " text" }]);
			fields.tags.set.add("news");
			fields.title.text.apply([{ type: "insert", index: 5, value: " title" }]);
		});

		await waitUntil(() => harness.sent.some((frame) => frame.opcode === 0x02));
		const append = harness.sent.find((frame) => frame.opcode === 0x02);
		expect(append?.opcode).toBe(0x02);
		if (append?.opcode !== 0x02) throw new Error("missing append");
		expect(append.payload.parts.map((part) => part.fieldSlot)).toEqual([
			1, 2, 3,
		]);
		expect((document.fields.title as any).text.value()).toBe("Draft title");
		expect((document.fields.tags as any).set.values()).toEqual(["news"]);
		expect((document.fields.content as any).text.value()).toBe("Body text");
		expect(document.replicaRevision).toBe(beforeRevision + 3);
		await waitUntil(
			() =>
				document.getSnapshot().status === "ready" &&
				document.getSnapshot().pendingUpdates === 0,
		);
	});

	it("keeps later durable bundle bases immutable after an earlier receipt", async () => {
		const harness = new CrdtExchangeHarness({ autoAcknowledge: false });
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		(document.fields.title as any).text.apply([
			{ type: "insert", index: 5, value: "!" },
		]);
		(document.fields.title as any).text.apply([
			{ type: "insert", index: 6, value: "?" },
		]);
		await waitUntil(
			() => harness.sent.filter((frame) => frame.opcode === 0x02).length === 1,
		);
		await harness.releaseNextAppend();
		await waitUntil(
			() => harness.sent.filter((frame) => frame.opcode === 0x02).length === 2,
		);
		const appends = harness.sent.filter(
			(frame) => frame.opcode === 0x02,
		) as Extract<(typeof harness.sent)[number], { opcode: 0x02 }>[];

		expect(appends[0]!.payload.parts[0]!.baseFieldCursor).toBe(0n);
		expect(appends[1]!.payload.parts[0]!.baseFieldCursor).toBe(0n);
		await harness.releaseNextAppend();
		await waitUntil(() => document.getSnapshot().pendingUpdates === 0);
	});

	it("rolls back thrown, async, nested, invalid, and queue-overflow transactions", async () => {
		const harness = new CrdtExchangeHarness({
			fields: AGGREGATE_FIELDS,
			autoAcknowledge: false,
			maxPendingUpdates: 1,
		});
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });

		expect(() =>
			document.transaction(({ fields }: any) => {
				fields.title.text.apply([{ type: "insert", index: 0, value: "x" }]);
				throw new Error("rollback");
			}),
		).toThrow("rollback");
		expect((document.fields.title as any).text.value()).toBe("Draft");

		expect(() => document.transaction((async () => undefined) as any)).toThrow(
			new CrdtMutationError("ASYNC_TRANSACTION"),
		);
		expect(() =>
			document.transaction(() => {
				try {
					document.transaction(() => undefined);
				} catch {}
			}),
		).toThrow(new CrdtMutationError("NESTED_TRANSACTION"));
		expect(() =>
			document.transaction(({ fields }: any) => {
				fields.title.text.apply([{ type: "insert", index: 0, value: "x" }]);
				fields.content.text.apply([{ type: "delete", index: 999, length: 1 }]);
			}),
		).toThrow(new CrdtMutationError("INVALID_OPERATION"));
		expect((document.fields.title as any).text.value()).toBe("Draft");

		(document.fields.title as any).text.apply([
			{ type: "insert", index: 5, value: "!" },
		]);
		expect(() =>
			(document.fields.content as any).text.apply([
				{ type: "insert", index: 4, value: "!" },
			]),
		).toThrow(new CrdtMutationError("QUEUE_LIMIT"));
		expect(document.getSnapshot()).toEqual({
			status: "recovery-required",
			reason: "queue_limit",
			pendingUpdates: 1,
		});
	});

	it("swaps a multi-field dirty pull atomically after full digest verification", async () => {
		const harness = new CrdtExchangeHarness({ fields: AGGREGATE_FIELDS });
		const document = harness.createDocument();
		await document.connect({ mode: "view" });
		const observed: Array<[string, string]> = [];
		document.subscribe(() => {
			if (document.getSnapshot().status !== "ready") return;
			observed.push([
				(document.fields.title as any).text.value(),
				(document.fields.content as any).text.value(),
			]);
		});
		const beforeRevision = document.replicaRevision;
		harness.setText(1, "Remote title", 1n);
		harness.setText(3, "Remote body", 1n);

		harness.dirty("visible");
		await waitUntil(
			() =>
				document.getSnapshot().status === "ready" &&
				(document.fields.title as any).text.value() === "Remote title",
		);

		expect((document.fields.content as any).text.value()).toBe("Remote body");
		expect(document.replicaRevision).toBe(beforeRevision + 1);
		expect(observed).toEqual([["Remote title", "Remote body"]]);
	});

	it("keeps the installed basis untouched when a pull artifact digest is forged", async () => {
		const harness = new CrdtExchangeHarness({ fields: AGGREGATE_FIELDS });
		const document = harness.createDocument();
		await document.connect({ mode: "view" });
		harness.setText(1, "Untrusted", 1n);
		harness.responseOverride = (request, response) => {
			if (request.opcode !== 0x01 || response.opcode !== 0x81) return response;
			return {
				...response,
				payload: {
					...response.payload,
					artifactDigest: new Uint8Array(32).fill(0xff),
				},
			};
		};

		harness.dirty("visible");
		await waitUntil(() => document.getSnapshot().status === "offline");

		expect((document.fields.title as any).text.value()).toBe("Draft");
		expect((document.fields.content as any).text.value()).toBe("Body");
	});

	it("rejects a continuation page that makes no byte progress", async () => {
		const harness = new CrdtExchangeHarness({ fields: AGGREGATE_FIELDS });
		const document = harness.createDocument();
		await document.connect({ mode: "view" });
		harness.setText(1, "Untrusted continuation", 1n);
		let page = 0;
		harness.responseOverride = (request, response) => {
			if (request.opcode !== 0x01 || response.opcode !== 0x81) return response;
			page++;
			return {
				...response,
				payload: {
					...response.payload,
					complete: false,
					continuation: page === 1 ? "page-a" : "page-b",
					chunks: page === 1 ? response.payload.chunks : [],
				},
			};
		};

		harness.dirty("visible");
		await waitUntil(() => document.getSnapshot().status === "offline");

		expect(page).toBe(2);
		expect((document.fields.title as any).text.value()).toBe("Draft");
		expect((document.fields.content as any).text.value()).toBe("Body");
	});

	it("reapplies a just-created in-memory pending update across an immediate dirty pull", async () => {
		const harness = new CrdtExchangeHarness({
			autoAcknowledge: false,
		});
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		(document.fields.title as any).text.apply([
			{ type: "insert", index: 5, value: "!" },
		]);

		harness.dirty("visible");
		await waitUntil(
			() => harness.sent.filter((frame) => frame.opcode === 0x02).length === 1,
		);
		expect(document.getSnapshot().status).toBe("synchronizing");
		await harness.releaseNextAppend();
		await waitUntil(
			() =>
				document.getSnapshot().status === "ready" &&
				harness.sent.filter((frame) => frame.opcode === 0x01).length === 2,
		);

		expect((document.fields.title as any).text.value()).toBe("Draft!");
		expect(document.getSnapshot()).toMatchObject({
			status: "ready",
			pendingUpdates: 0,
		});
	});
});

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error("condition not reached");
}
