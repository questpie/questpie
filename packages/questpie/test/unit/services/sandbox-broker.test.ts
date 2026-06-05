/**
 * Sandbox bindings broker — SECURITY CORE tests.
 *
 * This is the default-deny capability enforcement for the UNTRUSTED mini-app
 * path (design §13/§14). The headline assertions are the OUT-OF-SCOPE
 * REJECTIONS: a guest may only touch the primitives its run's manifest declared.
 *
 * Covers two layers:
 *   1. `checkBindingCapability` — the pure policy function (globs, verbs,
 *      traversal rejection, malformed methods, default-deny on every axis).
 *   2. `SandboxBroker` — token mint/auth/expiry/revoke + per-call enforcement +
 *      dispatch to a bound target + structured errors (never throws).
 */
import { describe, expect, it } from "bun:test";

import type { ExecutorCapabilities } from "#questpie/server/modules/core/integrated/executor/adapter.js";
import {
	type BindingTarget,
	SandboxBroker,
} from "#questpie/server/modules/core/integrated/executor/bindings/broker.js";
import {
	checkBindingCapability,
	knowledgePathMatches,
	normalizeKnowledgePath,
} from "#questpie/server/modules/core/integrated/executor/bindings/capability-check.js";
import { parseBindingMethod } from "#questpie/server/modules/core/integrated/executor/bindings/protocol.js";

// ──────────────────────────────────────────────────────────────────────────
// parseBindingMethod — syntactic classification (no capabilities consulted).
// ──────────────────────────────────────────────────────────────────────────
describe("parseBindingMethod", () => {
	it("classifies the MVP surface", () => {
		expect(parseBindingMethod("knowledge.read")).toEqual({
			kind: "knowledge",
			op: "read",
		});
		expect(parseBindingMethod("collections.orders.find")).toEqual({
			kind: "collection",
			name: "orders",
			op: "find",
		});
		expect(parseBindingMethod("collections.orders.findOne")).toEqual({
			kind: "collection",
			name: "orders",
			op: "findOne",
		});
		expect(parseBindingMethod("globals.settings.get")).toEqual({
			kind: "global",
			name: "settings",
			op: "get",
		});
		expect(parseBindingMethod("services.postToSocial.run")).toEqual({
			kind: "service",
			name: "postToSocial",
			fn: "run",
		});
	});

	it("rejects malformed / smuggled method strings (returns null)", () => {
		for (const m of [
			"",
			"knowledge",
			"knowledge.read.extra",
			"collections.orders", // missing op
			"collections..find", // empty name
			"collections.orders.find.evil", // extra segment
			"collections.ord ers.find", // space in name
			"collections.../find", // traversal-ish name
			"nope.read",
			"globals.settings.delete", // not a global op
			"email.broadcast",
		]) {
			expect(parseBindingMethod(m)).toBeNull();
		}
	});
});

// ──────────────────────────────────────────────────────────────────────────
// normalizeKnowledgePath + glob matcher — the path-scoping primitives.
// ──────────────────────────────────────────────────────────────────────────
describe("normalizeKnowledgePath — escape rejection", () => {
	it("rejects absolute / traversal / NUL / backslash paths", () => {
		expect(normalizeKnowledgePath("/etc/passwd")).toBeNull();
		expect(normalizeKnowledgePath("company/apps/x/../../secret")).toBeNull();
		expect(normalizeKnowledgePath("..")).toBeNull();
		expect(normalizeKnowledgePath("a/../b")).toBeNull();
		expect(normalizeKnowledgePath("a/b\0c")).toBeNull();
		expect(normalizeKnowledgePath("a\\b")).toBeNull();
		expect(normalizeKnowledgePath("")).toBeNull();
		expect(normalizeKnowledgePath(123)).toBeNull();
	});

	it("normalizes safe paths (collapses //, strips leading ./)", () => {
		expect(normalizeKnowledgePath("company/apps/x/data/a.json")).toBe(
			"company/apps/x/data/a.json",
		);
		expect(normalizeKnowledgePath("./company//apps/x")).toBe("company/apps/x");
		// A literal "." mid-path is allowed (a dotfile-ish segment), only ".." is an escape.
		expect(normalizeKnowledgePath("company/.config")).toBe("company/.config");
	});
});

describe("knowledgePathMatches — glob semantics", () => {
	it("** matches across separators, * stays within a segment", () => {
		expect(
			knowledgePathMatches(
				"company/apps/x/data/a.json",
				"company/apps/x/data/**",
			),
		).toBe(true);
		expect(
			knowledgePathMatches(
				"company/apps/x/data/sub/a.json",
				"company/apps/x/data/**",
			),
		).toBe(true);
		// * does NOT cross '/': a nested path must not match a single-star glob.
		expect(
			knowledgePathMatches(
				"company/apps/x/data/sub/a",
				"company/apps/x/data/*",
			),
		).toBe(false);
		expect(
			knowledgePathMatches("company/apps/x/data/a", "company/apps/x/data/*"),
		).toBe(true);
	});

	it("is fully anchored (no partial prefix/suffix match)", () => {
		// A glob for app x must NOT match app y (the classic prefix-confusion bug).
		expect(
			knowledgePathMatches("company/apps/y/data/a", "company/apps/x/data/**"),
		).toBe(false);
		// Trailing escape: pattern is anchored at the end.
		expect(knowledgePathMatches("company/apps/x/data", "company/apps/x")).toBe(
			false,
		);
	});
});

// ──────────────────────────────────────────────────────────────────────────
// checkBindingCapability — default-deny policy per axis.
// ──────────────────────────────────────────────────────────────────────────
describe("checkBindingCapability — default-deny", () => {
	it("denies EVERYTHING when capabilities are empty/absent", () => {
		for (const caps of [undefined, {}, { net: [] }] as Array<
			ExecutorCapabilities | undefined
		>) {
			expect(
				checkBindingCapability("collections.orders.find", {}, caps).allowed,
			).toBe(false);
			expect(
				checkBindingCapability("knowledge.read", { path: "a/b" }, caps).allowed,
			).toBe(false);
			expect(checkBindingCapability("globals.s.get", {}, caps).allowed).toBe(
				false,
			);
			expect(checkBindingCapability("services.x.run", {}, caps).allowed).toBe(
				false,
			);
		}
	});

	it("denies an unrecognized method", () => {
		const caps: ExecutorCapabilities = {
			data: { collections: { orders: ["read"] } },
		};
		expect(checkBindingCapability("nope.read", {}, caps).allowed).toBe(false);
		expect(checkBindingCapability("collections.orders", {}, caps).allowed).toBe(
			false,
		);
	});

	it("denies prototype-chain names (__proto__/constructor) cleanly — never throws", () => {
		const caps: ExecutorCapabilities = {
			data: {
				collections: { orders: ["read"] },
				globals: { settings: ["read"] },
			},
		};
		for (const m of [
			"collections.__proto__.find",
			"collections.constructor.find",
			"globals.__proto__.get",
			"globals.constructor.get",
		]) {
			// Must DENY (default-deny), not throw a TypeError up the stack.
			let decision: { allowed: boolean } | undefined;
			expect(() => {
				decision = checkBindingCapability(m, {}, caps);
			}).not.toThrow();
			expect(decision?.allowed).toBe(false);
		}
	});
});

describe("checkBindingCapability — collections", () => {
	const caps: ExecutorCapabilities = {
		data: {
			collections: { orders: ["read"], posts: ["read", "create", "update"] },
		},
	};

	it("ALLOWS a read op for a granted collection", () => {
		expect(
			checkBindingCapability("collections.orders.find", {}, caps).allowed,
		).toBe(true);
		expect(
			checkBindingCapability("collections.orders.findOne", {}, caps).allowed,
		).toBe(true);
	});

	it("DENIES a collection NOT in scope (out-of-scope rejection)", () => {
		const d = checkBindingCapability("collections.secrets.find", {}, caps);
		expect(d.allowed).toBe(false);
		expect(d.reason).toContain("secrets");
	});

	it("DENIES a write op when only read is granted (verb mapping)", () => {
		const d = checkBindingCapability("collections.orders.create", {}, caps);
		expect(d.allowed).toBe(false);
		expect(d.reason).toContain("create");
	});

	it("ALLOWS create/update when granted, DENIES delete (not granted)", () => {
		expect(
			checkBindingCapability("collections.posts.create", {}, caps).allowed,
		).toBe(true);
		expect(
			checkBindingCapability("collections.posts.update", {}, caps).allowed,
		).toBe(true);
		expect(
			checkBindingCapability("collections.posts.delete", {}, caps).allowed,
		).toBe(false);
	});
});

describe("checkBindingCapability — knowledge", () => {
	const caps: ExecutorCapabilities = {
		knowledge: {
			read: ["company/apps/x/data/**"],
			write: ["company/apps/x/data/out/**"],
		},
	};

	it("ALLOWS a read within the read glob", () => {
		expect(
			checkBindingCapability(
				"knowledge.read",
				{ path: "company/apps/x/data/a.json" },
				caps,
			).allowed,
		).toBe(true);
	});

	it("DENIES a read OUTSIDE the read glob (out-of-scope rejection)", () => {
		const d = checkBindingCapability(
			"knowledge.read",
			{ path: "company/apps/y/data/a.json" },
			caps,
		);
		expect(d.allowed).toBe(false);
		expect(d.reason).toContain("outside read scope");
	});

	it("DENIES a path-traversal escape even if it 'looks' in-scope", () => {
		const d = checkBindingCapability(
			"knowledge.read",
			{ path: "company/apps/x/data/../../../secret" },
			caps,
		);
		expect(d.allowed).toBe(false);
		expect(d.reason).toMatch(/unsafe|missing/);
	});

	it("DENIES a write outside the write glob (read scope is wider — must not leak)", () => {
		// Path is within READ scope but NOT within WRITE scope → write denied.
		const d = checkBindingCapability(
			"knowledge.write",
			{ path: "company/apps/x/data/a.json", content: "x" },
			caps,
		);
		expect(d.allowed).toBe(false);
		expect(d.reason).toContain("outside write scope");
	});

	it("ALLOWS a write within the write glob", () => {
		expect(
			checkBindingCapability(
				"knowledge.write",
				{ path: "company/apps/x/data/out/result.json", content: "x" },
				caps,
			).allowed,
		).toBe(true);
	});

	it("list requires a read scope; a prefix must be in-scope", () => {
		expect(checkBindingCapability("knowledge.list", {}, caps).allowed).toBe(
			true,
		);
		expect(
			checkBindingCapability(
				"knowledge.list",
				{ path: "company/apps/x/data/sub" },
				caps,
			).allowed,
		).toBe(true);
		// A prefix outside the read scope is rejected (no cross-scope enumeration).
		expect(
			checkBindingCapability("knowledge.list", { path: "company/apps/y" }, caps)
				.allowed,
		).toBe(false);
		// No read scope at all → list denied.
		expect(
			checkBindingCapability("knowledge.list", {}, { knowledge: {} }).allowed,
		).toBe(false);
	});
});

describe("checkBindingCapability — services / jobs / workflows allowlists", () => {
	const caps: ExecutorCapabilities = {
		services: ["postToSocial"],
		jobs: ["sendDigest"],
		workflows: ["publishFlow"],
	};

	it("ALLOWS a name in the allowlist, DENIES one that is not", () => {
		expect(
			checkBindingCapability("services.postToSocial.run", {}, caps).allowed,
		).toBe(true);
		expect(
			checkBindingCapability("services.exfiltrate.run", {}, caps).allowed,
		).toBe(false);

		expect(
			checkBindingCapability("jobs.enqueue.sendDigest", {}, caps).allowed,
		).toBe(true);
		expect(
			checkBindingCapability("jobs.enqueue.dropTables", {}, caps).allowed,
		).toBe(false);

		expect(
			checkBindingCapability("workflows.trigger.publishFlow", {}, caps).allowed,
		).toBe(true);
		expect(
			checkBindingCapability("workflows.trigger.deleteAll", {}, caps).allowed,
		).toBe(false);
	});

	it("fails closed on email.send (no grant axis exists)", () => {
		expect(
			checkBindingCapability("email.send", {}, { services: ["x"] }).allowed,
		).toBe(false);
	});
});

// ──────────────────────────────────────────────────────────────────────────
// SandboxBroker — token auth + per-call enforcement + dispatch.
// ──────────────────────────────────────────────────────────────────────────

/** A fake bound target recording every dispatched call. */
function fakeTarget() {
	const calls: Array<{ method: string; args: unknown }> = [];
	const target: BindingTarget = {
		knowledge: {
			read: async (args) => {
				calls.push({ method: "knowledge.read", args });
				return { path: (args as { path: string }).path, body: "hello" };
			},
			list: async (args) => {
				calls.push({ method: "knowledge.list", args });
				return [{ path: "company/apps/x/data/a.json" }];
			},
		},
		collections: {
			orders: {
				find: async (args) => {
					calls.push({ method: "collections.orders.find", args });
					return { docs: [{ id: "o1" }] };
				},
				findOne: async (args) => {
					calls.push({ method: "collections.orders.findOne", args });
					return { id: "o1" };
				},
			},
		},
	};
	return { target, calls };
}

const SCOPE: ExecutorCapabilities = {
	data: { collections: { orders: ["read"] } },
	knowledge: { read: ["company/apps/x/data/**"] },
};

describe("SandboxBroker — token auth", () => {
	it("rejects an unknown / missing / empty token as unauthorized", async () => {
		const broker = new SandboxBroker();
		for (const tok of [undefined, null, "", "deadbeef"]) {
			const r = await broker.handleRpc(tok, "collections.orders.find", {});
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.code).toBe("unauthorized");
		}
	});

	it("mints an opaque token that authorizes in-scope calls, then revokes", async () => {
		const broker = new SandboxBroker();
		const { target } = fakeTarget();
		const minted = broker.mint({ capabilities: SCOPE, target });

		// Opaque: a long hex string, not a JSON-decodable capability blob.
		expect(minted.token).toMatch(/^[0-9a-f]{64}$/);
		expect(broker.size).toBe(1);

		const ok = await broker.handleRpc(
			minted.token,
			"collections.orders.find",
			{},
		);
		expect(ok.ok).toBe(true);

		minted.revoke();
		expect(broker.size).toBe(0);
		const after = await broker.handleRpc(
			minted.token,
			"collections.orders.find",
			{},
		);
		expect(after.ok).toBe(false);
		if (!after.ok) expect(after.error.code).toBe("unauthorized");
	});

	it("rejects an expired token", async () => {
		const broker = new SandboxBroker();
		const { target } = fakeTarget();
		const minted = broker.mint({ capabilities: SCOPE, target, ttlMs: -1 });
		const r = await broker.handleRpc(
			minted.token,
			"collections.orders.find",
			{},
		);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("unauthorized");
	});

	it("isolates tokens — one run's token cannot use another run's wider scope", async () => {
		const broker = new SandboxBroker();
		const a = fakeTarget();
		const b = fakeTarget();
		// Run A: only orders.read. Run B: a wider scope (posts too) — but A must
		// not be able to reach B's grants with A's token.
		const tokA = broker.mint({ capabilities: SCOPE, target: a.target });
		broker.mint({
			capabilities: {
				data: { collections: { orders: ["read"], posts: ["read", "create"] } },
			},
			target: b.target,
		});

		const r = await broker.handleRpc(tokA.token, "collections.posts.find", {});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("forbidden");
	});
});

describe("SandboxBroker — per-call enforcement + dispatch (THE security boundary)", () => {
	it("dispatches an IN-SCOPE call to the bound target and returns its value", async () => {
		const broker = new SandboxBroker();
		const { target, calls } = fakeTarget();
		const { token } = broker.mint({ capabilities: SCOPE, target });

		const find = await broker.handleRpc(token, "collections.orders.find", {
			where: { status: "open" },
		});
		expect(find).toEqual({ ok: true, value: { docs: [{ id: "o1" }] } });

		const read = await broker.handleRpc(token, "knowledge.read", {
			path: "company/apps/x/data/a.json",
		});
		expect(read).toEqual({
			ok: true,
			value: { path: "company/apps/x/data/a.json", body: "hello" },
		});

		expect(calls.map((c) => c.method)).toEqual([
			"collections.orders.find",
			"knowledge.read",
		]);
	});

	it("REJECTS an out-of-scope collection BEFORE dispatch (target never called)", async () => {
		const broker = new SandboxBroker();
		const { target, calls } = fakeTarget();
		const { token } = broker.mint({ capabilities: SCOPE, target });

		const r = await broker.handleRpc(token, "collections.secrets.find", {});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.code).toBe("forbidden");
			expect(r.error.message).toContain("secrets");
		}
		// Critical: the bound target was NEVER invoked for the denied call.
		expect(calls.length).toBe(0);
	});

	it("REJECTS an out-of-scope WRITE op (read-only collection)", async () => {
		const broker = new SandboxBroker();
		const { target } = fakeTarget();
		const { token } = broker.mint({ capabilities: SCOPE, target });
		const r = await broker.handleRpc(token, "collections.orders.create", {
			data: {},
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("forbidden");
	});

	it("REJECTS an out-of-scope knowledge path (and a traversal escape)", async () => {
		const broker = new SandboxBroker();
		const { target, calls } = fakeTarget();
		const { token } = broker.mint({ capabilities: SCOPE, target });

		const outside = await broker.handleRpc(token, "knowledge.read", {
			path: "company/apps/EVIL/data/a.json",
		});
		expect(outside.ok).toBe(false);
		if (!outside.ok) expect(outside.error.code).toBe("forbidden");

		const traversal = await broker.handleRpc(token, "knowledge.read", {
			path: "company/apps/x/data/../../../../etc/passwd",
		});
		expect(traversal.ok).toBe(false);
		if (!traversal.ok) expect(traversal.error.code).toBe("forbidden");

		expect(calls.length).toBe(0);
	});

	it("returns not_implemented for an in-scope method with no dispatch handler", async () => {
		const broker = new SandboxBroker();
		// Grant globals.read, but the target has no globals handler (MVP defers it).
		const { target } = fakeTarget();
		const { token } = broker.mint({
			capabilities: { data: { globals: { settings: ["read"] } } },
			target,
		});
		const r = await broker.handleRpc(token, "globals.settings.get", {});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("not_implemented");
	});

	it("denies a prototype-chain collection name as forbidden (no crash)", async () => {
		const broker = new SandboxBroker();
		const { target } = fakeTarget();
		const { token } = broker.mint({ capabilities: SCOPE, target });
		const r = await broker.handleRpc(token, "collections.__proto__.find", {});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("forbidden");
	});

	it("returns bad_method for a malformed method even with a valid token", async () => {
		const broker = new SandboxBroker();
		const { target } = fakeTarget();
		const { token } = broker.mint({ capabilities: SCOPE, target });
		const r = await broker.handleRpc(token, "collections.orders", {});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("bad_method");
	});

	it("surfaces a target throw as a structured execution_error (never throws)", async () => {
		const broker = new SandboxBroker();
		const target: BindingTarget = {
			collections: {
				orders: {
					find: async () => {
						throw new Error("db exploded");
					},
				},
			},
		};
		const { token } = broker.mint({ capabilities: SCOPE, target });
		const r = await broker.handleRpc(token, "collections.orders.find", {});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.code).toBe("execution_error");
			expect(r.error.message).toContain("db exploded");
		}
	});
});
