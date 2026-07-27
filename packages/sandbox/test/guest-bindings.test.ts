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
		await q.collections.posts.update({
			where: { id: "p1" },
			data: { title: "x" },
		});
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

describe("guest custom tools: separate discovery and call methods", () => {
	it("maps only list/call under the tools namespace", async () => {
		const { calls, hostCall } = recorder();
		const guest = buildGuestBindings(hostCall);

		await guest.tools.list();
		await guest.tools.call("reports.generate", { period: "week" });

		expect(calls).toEqual([
			{ method: "tools.list", args: {} },
			{
				method: "tools.call",
				args: {
					name: "reports.generate",
					arguments: { period: "week" },
				},
			},
		]);
		expect("app" in guest).toBe(false);
		expect("db" in guest).toBe(false);
		expect("token" in guest.tools).toBe(false);
	});
});

describe("store.<name> sugar → collections.document_store.<op> with store injected", () => {
	it("create injects a top-level `store` (the row field)", async () => {
		const { calls, hostCall } = recorder();
		const q = buildGuestBindings(hostCall);

		await q.store.posts.create({ key: "k1", data: { v: 1 } });

		expect(calls).toHaveLength(1);
		expect(calls[0]!.method).toBe("collections.document_store.create");
		expect(calls[0]!.args).toEqual({
			key: "k1",
			data: { v: 1 },
			store: "posts",
		});
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

		await q.store.posts.update({
			where: { key: "k1" },
			data: { data: { v: 2 } },
		});

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

describe("guest files: dotted method names + args forwarding", () => {
	it("maps read/write/list to dotted methods", async () => {
		const { calls, hostCall } = recorder();
		const q = buildGuestBindings(hostCall);

		await q.files.read({ path: "company/data/note.md" });
		await q.files.write({ path: "company/out/x.md", content: "hi" });
		await q.files.list({ path: "company/data" });

		expect(calls.map((c) => c.method)).toEqual([
			"files.read",
			"files.write",
			"files.list",
		]);
	});

	it("read forwards its args verbatim to hostCall", async () => {
		const { calls, hostCall } = recorder();
		const q = buildGuestBindings(hostCall);

		const args = { path: "company/data/note.md", scope: { kind: "company" } };
		await q.files.read(args);

		expect(calls).toHaveLength(1);
		expect(calls[0]!.method).toBe("files.read");
		expect(calls[0]!.args).toEqual(args);
	});

	it("write forwards its full payload verbatim to hostCall", async () => {
		const { calls, hostCall } = recorder();
		const q = buildGuestBindings(hostCall);

		const args = {
			path: "company/out/report.md",
			content: "# hi",
			title: "Report",
			mime_type: "text/markdown",
		};
		await q.files.write(args);

		expect(calls).toHaveLength(1);
		expect(calls[0]!.method).toBe("files.write");
		expect(calls[0]!.args).toEqual(args);
	});

	it("list forwards its args verbatim when provided", async () => {
		const { calls, hostCall } = recorder();
		const q = buildGuestBindings(hostCall);

		const args = { path: "company/data", scope: { kind: "company" } };
		await q.files.list(args);

		expect(calls).toHaveLength(1);
		expect(calls[0]!.method).toBe("files.list");
		expect(calls[0]!.args).toEqual(args);
	});

	it("list with undefined args falls back to {}", async () => {
		const { calls, hostCall } = recorder();
		const q = buildGuestBindings(hostCall);

		// exercise the no-arg call → the `args ?? {}` fallback (list's arg is optional).
		await q.files.list();

		expect(calls).toHaveLength(1);
		expect(calls[0]!.method).toBe("files.list");
		expect(calls[0]!.args).toEqual({});
	});
});

describe("error propagation: a rejecting hostCall rejects the proxied call", () => {
	/** A hostCall that always rejects — mirrors a host-side default-deny. */
	function rejector(err: unknown) {
		const calls: Array<{ method: string; args: unknown }> = [];
		const hostCall = async (method: string, args: unknown) => {
			calls.push({ method, args });
			throw err;
		};
		return { calls, hostCall };
	}

	it("files.read rejects with the host error", async () => {
		const denied = new Error("denied: files.read");
		const { hostCall } = rejector(denied);
		const q = buildGuestBindings(hostCall);

		await expect(q.files.read({ path: "secret/x" })).rejects.toBe(denied);
	});

	it("files.write rejects with the host error", async () => {
		const denied = new Error("denied: files.write");
		const { hostCall } = rejector(denied);
		const q = buildGuestBindings(hostCall);

		await expect(
			q.files.write({ path: "secret/x", content: "x" }),
		).rejects.toBe(denied);
	});

	it("collections.<name>.find rejects with the host error (out-of-scope deny)", async () => {
		const denied = new Error("denied: collection not granted");
		const { calls, hostCall } = rejector(denied);
		const q = buildGuestBindings(hostCall);

		await expect(q.collections.secrets.find({ where: { a: 1 } })).rejects.toBe(
			denied,
		);
		// the deny happens host-side: the proxy still forwarded the call.
		expect(calls[0]!.method).toBe("collections.secrets.find");
	});

	it("store.<name>.create rejects with the host error (ungranted store)", async () => {
		const denied = new Error("denied: store not granted");
		const { hostCall } = rejector(denied);
		const q = buildGuestBindings(hostCall);

		await expect(
			q.store.posts.create({ key: "k1", data: { v: 1 } }),
		).rejects.toBe(denied);
	});
});
