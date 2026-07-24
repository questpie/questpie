import { describe, expect, it } from "bun:test";

import { stageCrdtAggregateBundle } from "questpie/crdt";
import * as Y from "yjs";

import { yjsClientEngine } from "../src/exports/client.js";
import { yjsServerEngine } from "../src/exports/server.js";

describe("Yjs text engine", () => {
	it("converges reordered, duplicated, and offline Y.Text updates", async () => {
		const engine = serverEngine();
		const initial = await engine.create({
			value: "hello",
			basis: { fieldEpoch: 0n, fieldCursor: 0n },
		});
		const first = updateFrom(initial.state, (text) => text.insert(5, " world"));
		const second = updateFrom(initial.state, (text) => text.insert(0, "Say "));
		const merged = Y.mergeUpdates([second, first, second]);
		const candidate = await engine.stage({ replica: initial, update: merged });
		const committed = await engine.commit({
			candidate,
			current: initial,
			assignedFieldCursor: 1n,
		});

		expect(engine.project(committed)).toBe("Say hello world");
		const proof = await engine.proof(initial);
		const diff = await engine.diff({ replica: committed, proof });
		expect(diff.kind).toBe("snapshot");
		if (diff.kind === "snapshot") {
			const restored = await engine.restore({
				snapshot: diff.snapshot,
				basis: committed.basis,
			});
			expect(engine.project(restored)).toBe("Say hello world");
		}
	});

	it("rejects documents with anything except one named Y.Text root", async () => {
		const engine = serverEngine();
		const initial = await engine.create({
			value: "",
			basis: { fieldEpoch: 0n, fieldCursor: 0n },
		});
		const document = new Y.Doc();
		Y.applyUpdate(document, initial.state);
		document.getMap("other").set("key", "value");
		const update = Y.encodeStateAsUpdate(document);

		await expect(engine.stage({ replica: initial, update })).rejects.toThrow(
			"one named text root",
		);
	});

	it("rejects malformed proofs, updates, dependencies, and hard limits", async () => {
		const engine = serverEngine();
		const initial = await engine.create({
			value: "safe",
			basis: { fieldEpoch: 0n, fieldCursor: 0n },
		});

		await expect(
			engine.diff({ replica: initial, proof: new Uint8Array([255]) }),
		).rejects.toThrow("invalid Yjs state vector");
		await expect(
			engine.stage({
				replica: initial,
				update: new Uint8Array([255]),
			}),
		).rejects.toThrow("invalid Yjs update");
		const valid = updateFrom(initial.state, (text) => text.insert(4, "!"));
		await expect(
			engine.stage({
				replica: initial,
				update: valid,
				limits: { maxUpdateBytes: valid.byteLength - 1 },
			}),
		).rejects.toThrow("exceeds candidate limit");

		const source = new Y.Doc();
		const sourceText = source.getText("text");
		sourceText.insert(0, "a");
		const dependencyVector = Y.encodeStateVector(source);
		sourceText.insert(1, "b");
		const dependencyOnly = Y.encodeStateAsUpdate(source, dependencyVector);
		await expect(
			engine.stage({ replica: initial, update: dependencyOnly }),
		).rejects.toThrow("unresolved dependencies");

		const manyStructs = Y.mergeUpdates(
			Array.from({ length: 4 }, (_, index) => {
				const document = new Y.Doc();
				document.getText("text").insert(0, String(index));
				return Y.encodeStateAsUpdate(document);
			}),
		);
		await expect(
			engine.stage({
				replica: initial,
				update: manyStructs,
				limits: { maxOperations: 1 },
			}),
		).rejects.toThrow("operation limit");
	});

	it("terminates an untrusted stage operation at its deadline", async () => {
		const normal = serverEngine();
		const initial = await normal.create({
			value: "safe",
			basis: { fieldEpoch: 0n, fieldCursor: 0n },
		});
		const update = updateFrom(initial.state, (text) => text.insert(4, "!"));
		const bounded = yjsServerEngine({ operationTimeoutMs: 1 });

		await expect(bounded.stage({ replica: initial, update })).rejects.toThrow(
			"timed out",
		);
	});

	it("rejects overflow instead of growing an unbounded worker queue", async () => {
		const normal = serverEngine();
		const initial = await normal.create({
			value: "safe",
			basis: { fieldEpoch: 0n, fieldCursor: 0n },
		});
		const update = updateFrom(initial.state, (text) => text.insert(4, "!"));
		const bounded = yjsServerEngine({
			operationTimeoutMs: 1,
			maximumActiveWorkers: 1,
			maximumPendingJobs: 1,
		});
		const outcomes = await Promise.allSettled(
			Array.from({ length: 3 }, () =>
				bounded.stage({ replica: initial, update }),
			),
		);

		expect(
			outcomes.some(
				(outcome) =>
					outcome.status === "rejected" &&
					outcome.reason instanceof Error &&
					outcome.reason.message === "Yjs worker queue is full",
			),
		).toBe(true);
	});

	it("keeps aggregate stage capability in the parent realm", async () => {
		const engine = serverEngine();
		const initial = await engine.create({
			value: "hello",
			basis: { fieldEpoch: 0n, fieldCursor: 0n },
		});
		const staged = await stageCrdtAggregateBundle({
			aggregateEpoch: 1n,
			submittedSchemaVersion: 1,
			canonicalSchemaVersion: 1,
			parts: [
				{
					fieldSlot: 1,
					engine,
					replica: initial,
					update: updateFrom(initial.state, (text) => text.insert(5, "!")),
				},
			],
		});

		expect(staged.parts[0]?.candidate.projection).toBe("hello!");
	});

	it("keeps the client engine worker-free", async () => {
		const engine = yjsClientEngine();
		const replica = await engine.create({
			value: "client",
			basis: { fieldEpoch: 0n, fieldCursor: 0n },
		});
		expect(engine.project(replica)).toBe("client");
	});

	it("preserves emoji, ZWJ, combining marks, and RTL scalar text", async () => {
		const engine = yjsClientEngine();
		const value = "👩‍💻 cafe\u0301 مرحبا";
		const replica = await engine.create({
			value,
			basis: { fieldEpoch: 0n, fieldCursor: 0n },
		});
		expect(engine.project(replica)).toBe(value);
		await expect(
			engine.create({
				value: "bad\0value",
				basis: { fieldEpoch: 0n, fieldCursor: 0n },
			}),
		).rejects.toThrow("invalid Yjs text projection");
		await expect(
			engine.create({
				value: "bad\uD800",
				basis: { fieldEpoch: 0n, fieldCursor: 0n },
			}),
		).rejects.toThrow("invalid Yjs text projection");
	});
});

function updateFrom(state: Uint8Array, mutate: (text: Y.Text) => void) {
	const document = new Y.Doc();
	Y.applyUpdate(document, state);
	mutate(document.getText("text"));
	return Y.encodeStateAsUpdate(document, Y.encodeStateVectorFromUpdate(state));
}

function serverEngine() {
	return yjsServerEngine({ operationTimeoutMs: 5_000 });
}
