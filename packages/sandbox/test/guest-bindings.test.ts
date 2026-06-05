import { describe, expect, it } from "bun:test";

import { buildGuestBindings } from "../src/guest-bindings.js";

// ──────────────────────────────────────────────────────────────────────────
// The guest bindings proxy is pure wire-shaping over an injected `hostCall`.
// Security is ENTIRELY host-side (the broker + the mini-app bindings clamp); these
// tests only lock the method-name + args mapping, including the §7 write surface
// (`collections.<name>.create|update|delete`) and the `store.<name>` sugar that
// maps to `collections.document_store.<op>` with `store` injected.
// ──────────────────────────────────────────────────────────────────────────

/** Capture every `hostCall(method, args)` the proxy makes. */
function recorder() {
	const calls: Array<{ method: string; args: unknown }> = [];
	const hostCall = async (method: string, args: unknown) => {
		calls.push({ method, args });
		return { ok: true };
	};
	return { calls, hostCall };
}

describe("guest collections: read + write method names", () => {
	it("maps find/findOne/create/update/delete to dotted methods", async () => {
		const { calls, hostCall } = recorder();
		const q = buildGuestBindings(hostCall);

		await q.collections.posts.find({ where: { a: 1 } });
		await q.collections.posts.findOne({ where: { id: "p1" } });
		await q.collections.posts.create({ title: "hi" });
		await q.collections.posts.update({ where: { id: "p1" }, data: { title: "x" } });
		await q.collections.posts.delete({ where: { id: "p1" } });

		expect(calls.map((c) => c.method)).toEqual([
			"collections.posts.find",
			"collections.posts.findOne",
			"collections.posts.create",
			"collections.posts.update",
			"collections.posts.delete",
		]);
		expect(calls[2]!.args).toEqual({ title: "hi" });
	});
});

describe("store.<name> sugar → collections.document_store.<op> with store injected", () => {
	it("create injects a top-level `store` (the row field)", async () => {
		const { calls, hostCall } = recorder();
		const q = buildGuestBindings(hostCall);

		await q.store.posts.create({ key: "k1", data: { v: 1 } });

		expect(calls).toHaveLength(1);
		expect(calls[0]!.method).toBe("collections.document_store.create");
		expect(calls[0]!.args).toEqual({ key: "k1", data: { v: 1 }, store: "posts" });
	});

	it("find/findOne/delete inject `where.store` (scoping to the one store)", async () => {
		const { calls, hostCall } = recorder();
		const q = buildGuestBindings(hostCall);

		await q.store.posts.find();
		await q.store.posts.find({ where: { key: "k1" } });
		await q.store.posts.delete({ where: { key: "k1" } });

		expect(calls[0]!.args).toEqual({ where: { store: "posts" } });
		// an existing guest `where` is preserved AND scoped to the store.
		expect(calls[1]!.args).toEqual({ where: { key: "k1", store: "posts" } });
		expect(calls[2]!.method).toBe("collections.document_store.delete");
		expect(calls[2]!.args).toEqual({ where: { key: "k1", store: "posts" } });
	});

	it("update injects `where.store` and forwards the patch", async () => {
		const { calls, hostCall } = recorder();
		const q = buildGuestBindings(hostCall);

		await q.store.posts.update({ where: { key: "k1" }, data: { data: { v: 2 } } });

		expect(calls[0]!.method).toBe("collections.document_store.update");
		expect(calls[0]!.args).toEqual({
			where: { key: "k1", store: "posts" },
			data: { data: { v: 2 } },
		});
	});

	it("two different store names resolve independently", async () => {
		const { calls, hostCall } = recorder();
		const q = buildGuestBindings(hostCall);
		await q.store.invoices.find();
		await q.store.drafts.find();
		expect(calls[0]!.args).toEqual({ where: { store: "invoices" } });
		expect(calls[1]!.args).toEqual({ where: { store: "drafts" } });
	});
});
