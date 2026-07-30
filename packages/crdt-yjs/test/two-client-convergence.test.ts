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
 * The harness previously acknowledged an append and discarded it, so a second
 * client pulling afterwards still saw the original text. It now merges each
 * committed update into the stored snapshot with the same engine, which is what
 * makes the concurrent cases below meaningful rather than vacuous.
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

/** Reads the field, or undefined while the document is mid-resync. */
const titleOf = (document: unknown): string | undefined => {
	try {
		return (
			document as { fields: { title: { text: { value(): string } } } }
		).fields.title.text.value();
	} catch {
		// A document briefly leaves the ready state while it re-bootstraps after
		// a dirty hint; reading then throws NOT_READY, which is correct.
		return undefined;
	}
};

/** Both readable AND equal - undefined === undefined must not count as agreement. */
const agree = (a: unknown, b: unknown): boolean => {
	const left = titleOf(a);
	return left !== undefined && left === titleOf(b);
};

const editTitle = (
	document: unknown,
	operations: Array<{ type: "insert"; index: number; value: string }>,
) =>
	(
		document as { fields: { title: { text: { apply(ops: unknown[]): void } } } }
	).fields.title.text.apply(operations);

/**
 * Appends are sent asynchronously, so a dirty hint fired immediately after the
 * local edits arrives before the server has seen them and nothing converges.
 * Wait for both appends (opcode 0x02) to reach the harness first.
 */
async function waitForAppends(
	server: { sent: ReadonlyArray<{ opcode: number }> },
	count: number,
) {
	await waitUntil(
		() => server.sent.filter((frame) => frame.opcode === 0x02).length >= count,
	);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error("timed out waiting for the clients to converge");
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

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

	it("converges concurrent edits at different offsets", async () => {
		const server = harness();
		const alice = server.createDocument();
		const bob = server.createDocument();

		await alice.connect({ mode: "edit" });
		await bob.connect({ mode: "edit" });

		// Both edit before either has seen the other's change - the case a
		// last-write-wins field would silently lose.
		editTitle(alice, [{ type: "insert", index: 5, value: " v2" }]);
		editTitle(bob, [{ type: "insert", index: 0, value: "The " }]);

		await waitForAppends(server, 2);
		server.dirty("visible");
		await waitUntil(() => agree(alice, bob));

		const merged = titleOf(alice)!;
		expect(merged).toContain("The ");
		expect(merged).toContain(" v2");
		expect(merged).toContain("Draft");

		await alice.close();
		await bob.close();
	});

	it("converges concurrent inserts at the SAME offset", async () => {
		const server = harness();
		const alice = server.createDocument();
		const bob = server.createDocument();

		await alice.connect({ mode: "edit" });
		await bob.connect({ mode: "edit" });

		// The genuinely hard case: two inserts at the identical position. A CRDT
		// must pick a deterministic order rather than interleave or drop one.
		editTitle(alice, [{ type: "insert", index: 0, value: "AAA" }]);
		editTitle(bob, [{ type: "insert", index: 0, value: "BBB" }]);

		await waitForAppends(server, 2);
		server.dirty("visible");
		await waitUntil(() => agree(alice, bob));

		const merged = titleOf(alice)!;
		// Contiguous, not interleaved character by character.
		expect(merged).toMatch(/(AAABBB|BBBAAA)/);

		await alice.close();
		await bob.close();
	});
});
