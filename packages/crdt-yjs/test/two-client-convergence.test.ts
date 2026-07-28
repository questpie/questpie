import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

import { CrdtExchangeHarness } from "../../questpie/test/crdt/client/http-harness.js";
import { yjsClientEngine } from "../src/exports/client.js";

/**
 * Two client documents against one server, driven by the REAL Yjs engine.
 *
 * Everything else in the CRDT suite tests one side or the other:
 * `text-engine.test.ts` proves the Yjs engine converges reordered and duplicated
 * updates, and the client tests in `questpie/test/crdt/client` drive the
 * document state machine against a toy text engine. This is the first test where
 * the real engine and the real client document meet.
 *
 * Scope note, deliberately narrow: this covers two clients opening the same
 * document and reading consistent state. Asserting that CONCURRENT EDITS
 * converge additionally needs the harness to relay one client's committed
 * append to the other, which it does not currently do - see the board task
 * `crdt-harness-cannot-relay-between-two-clients`.
 */

/** Seed a Yjs document with the initial text and encode it as a snapshot. */
function yjsSnapshot(value: string): Uint8Array {
	const document = new Y.Doc();
	// Must match TEXT_ROOT in the client engine, or restore() yields empty text.
	document.getText("text").insert(0, value);
	return new Uint8Array(Y.encodeStateAsUpdate(document));
}

function harness() {
	return new CrdtExchangeHarness({
		fields: [
			{
				key: "title",
				fieldSlot: 1,
				format: "text",
				value: "Draft",
				snapshot: yjsSnapshot("Draft"),
			},
		],
		textEngine: yjsClientEngine(),
	});
}

const titleOf = (document: unknown): string =>
	(
		document as { fields: { title: { text: { value(): string } } } }
	).fields.title.text.value();

describe("two clients on one collaborative document", () => {
	it("both read the server state through the real Yjs engine", async () => {
		const server = harness();
		const alice = server.createDocument();
		const bob = server.createDocument();

		await alice.connect({ mode: "edit" });
		await bob.connect({ mode: "edit" });

		// Reading "Draft" here is not trivial: the snapshot is a real Yjs update
		// decoded by the real engine, and the client rejects any manifest whose
		// engineId or formatVersion does not match its own engine.
		expect(titleOf(alice)).toBe("Draft");
		expect(titleOf(bob)).toBe("Draft");

		await alice.close();
		await bob.close();
	});
});
