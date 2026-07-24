import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

import { createYjsTextEngine } from "../src/exports/index.js";

describe("Yjs text engine", () => {
	it("converges reordered, duplicated, and offline Y.Text updates", async () => {
		const engine = createYjsTextEngine();
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
		const engine = createYjsTextEngine();
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
});

function updateFrom(state: Uint8Array, mutate: (text: Y.Text) => void) {
	const document = new Y.Doc();
	Y.applyUpdate(document, state);
	mutate(document.getText("text"));
	return Y.encodeStateAsUpdate(document, Y.encodeStateVectorFromUpdate(state));
}
