import { SandboxBroker } from "questpie/executor";
import { describe, expect, it } from "vitest";

import {
	buildAppPrincipalSession,
	buildMiniAppBindingTarget,
	clampReadPath,
	clampWritePath,
	type MiniAppBindingCtx,
	MiniAppBindingError,
	normalizeAppPath,
} from "../apps/mini-app-bindings";

// ---------------------------------------------------------------------------
// Test doubles. We drive the HOST-SIDE enforcement (G1/G2/G3) through the SAME
// chokepoint the live system uses — the real `SandboxBroker.handleRpc` — with a
// fake `ctx`, so the proof exercises capability-check + dispatch end-to-end
// without a running server or DB. (The route itself is NOT smoke-tested here;
// see the task report.)
// ---------------------------------------------------------------------------

interface KnowledgeRow {
	id: string;
	path: string;
	title: string | null;
	body: string;
	contentType: string | null;
	metadata: Record<string, unknown> | null;
}

/** The access context the bindings thread into the knowledge primitives. */
interface KnowledgeCtxArg {
	accessMode?: "user" | "system";
}

/**
 * In-memory `knowledgeResource`-shaped service over an array of rows.
 *
 * It MODELS THE REAL ACCESS-CONTROL GATE the live `knowledgeResource` hits: its
 * underlying `collections.assets.*` calls run under the context it is handed,
 * and the shared `knowledge` collection has NO public `read`/`write` rule — so a
 * `user`-mode call (the run's invoker / synthesized app-principal) is DENIED,
 * while a `system`-mode call (the mini-app bindings, AFTER the G1 clamp) is
 * allowed. We reproduce that exactly: any non-`system` context → throw the same
 * "does not have permission" shape the LIVE e2e saw (`crud-generator.ts:469`).
 *
 * Every call also RECORDS the context arg so a test can assert the bindings now
 * dispatch knowledge under `accessMode:"system"` (the fix), not user-mode.
 */
function makeKnowledgeResource(seed: KnowledgeRow[] = []) {
	const rows: KnowledgeRow[] = [...seed];
	const ctxCalls: Array<{
		method: string;
		context: KnowledgeCtxArg | undefined;
	}> = [];
	let seq = 0;
	/** Mirror the live `knowledge` collection: deny anything but system-mode. */
	function enforce(method: string, context: KnowledgeCtxArg | undefined) {
		ctxCalls.push({ method, context });
		if (context?.accessMode !== "system") {
			throw new Error("User does not have permission to read records");
		}
	}
	return {
		rows,
		ctxCalls,
		service: {
			async readByPath(path: string, context?: KnowledgeCtxArg) {
				enforce("readByPath", context);
				return rows.find((r) => r.path === path) ?? null;
			},
			async writeByPath(
				input: {
					path: string;
					body: string;
					title?: string | null;
					contentType?: string | null;
					metadata?: Record<string, unknown> | null;
				},
				context?: KnowledgeCtxArg,
			) {
				enforce("writeByPath", context);
				const existing = rows.find((r) => r.path === input.path);
				if (existing) {
					existing.body = input.body;
					existing.metadata = input.metadata ?? existing.metadata;
					return existing;
				}
				const row: KnowledgeRow = {
					id: `k${++seq}`,
					path: input.path,
					title: input.title ?? null,
					body: input.body,
					contentType: input.contentType ?? null,
					metadata: input.metadata ?? null,
				};
				rows.push(row);
				return row;
			},
			async listByPrefix(prefix: string, context?: KnowledgeCtxArg) {
				enforce("listByPrefix", context);
				return rows
					.filter((r) => r.path.startsWith(prefix))
					.map((r) => ({
						path: r.path,
						title: r.title,
						contentType: r.contentType,
					}));
			},
		},
	};
}

/** A collection double that RECORDS the CRUD context it was called with. */
function recordingCollection(returnDocs: unknown[]) {
	const calls: Array<{ method: string; args: unknown; context: unknown }> = [];
	return {
		calls,
		collection: {
			async find(args: unknown, context?: unknown) {
				calls.push({ method: "find", args, context });
				return { docs: returnDocs };
			},
			async findOne(args: unknown, context?: unknown) {
				calls.push({ method: "findOne", args, context });
				return returnDocs[0] ?? null;
			},
			async create(args: unknown, context?: unknown) {
				calls.push({ method: "create", args, context });
				return { id: "new", ...(args as Record<string, unknown>) };
			},
			async update(args: unknown, context?: unknown) {
				calls.push({ method: "update", args, context });
				return [{ id: "p1", updated: true }];
			},
			async delete(args: unknown, context?: unknown) {
				calls.push({ method: "delete", args, context });
				return { success: true, count: 1 };
			},
		},
	};
}

function makeCtx(opts: {
	knowledge?: ReturnType<typeof makeKnowledgeResource>;
	collections?: MiniAppBindingCtx["collections"];
	session?: MiniAppBindingCtx["session"];
}): MiniAppBindingCtx {
	const knowledge = opts.knowledge ?? makeKnowledgeResource();
	return {
		collections: opts.collections ?? {},
		services: { knowledgeResource: knowledge.service },
		session: opts.session,
	};
}

const APP = "social";
const PREFIX = `company/apps/${APP}/`;

/**
 * Relation-field resolvers for the G3 `where`/`orderBy` guard. The LIVE runner
 * always supplies one (backed by runtime collection metadata); these mirror that.
 */
/** No collection has any relation field (scalar `where`/`orderBy` always allowed). */
const noRelations = () => new Set<string>();
/** Build a resolver from an explicit `{ collection: [relationField, …] }` map. */
function relations(
	map: Record<string, string[]>,
): (name: string) => Set<string> | null {
	return (name) => (name in map ? new Set(map[name]) : new Set<string>());
}
/** A resolver that ALWAYS fails to determine the relation set (fail-closed path). */
const unknownRelations = () => null;

// ───────────────────────────── path clamps (G1) ─────────────────────────────

describe("G1: knowledge path clamps", () => {
	it("normalizeAppPath rejects traversal / absolute / smuggling", () => {
		expect(normalizeAppPath("../x")).toBeNull();
		expect(normalizeAppPath("a/../../b")).toBeNull();
		expect(normalizeAppPath("/etc/passwd")).toBeNull();
		expect(normalizeAppPath("a\\b")).toBeNull();
		expect(normalizeAppPath("a\0b")).toBeNull();
		expect(normalizeAppPath("")).toBeNull();
		expect(normalizeAppPath("./data/x.json")).toBe("data/x.json");
		expect(normalizeAppPath("data//x.json")).toBe("data/x.json");
	});

	it("clampReadPath confines reads to the app subtree", () => {
		expect(clampReadPath(APP, `${PREFIX}data/posts.json`)).toBe(
			`${PREFIX}data/posts.json`,
		);
		// reads of the app's own _app/ ARE allowed (manifest/code is readable).
		expect(clampReadPath(APP, `${PREFIX}_app/manifest.json`)).toBe(
			`${PREFIX}_app/manifest.json`,
		);
		// the subtree root itself is allowed (for listing).
		expect(clampReadPath(APP, `${PREFIX.slice(0, -1)}`)).toBe(
			PREFIX.slice(0, -1),
		);
		// another app, or company-wide knowledge, are OUT.
		expect(clampReadPath(APP, "company/apps/other/data/x.json")).toBeNull();
		expect(clampReadPath(APP, "company/secrets/x")).toBeNull();
		// a glob-ish escape never widens.
		expect(clampReadPath(APP, "..")).toBeNull();
	});

	it("clampWritePath confines writes to the subtree AND forbids _app/", () => {
		expect(clampWritePath(APP, `${PREFIX}data/foo.json`)).toBe(
			`${PREFIX}data/foo.json`,
		);
		// _app/ (code + manifest) is NOT writable, even though it's in-subtree.
		expect(clampWritePath(APP, `${PREFIX}_app/manifest.json`)).toBeNull();
		expect(clampWritePath(APP, `${PREFIX}_app/server.ts`)).toBeNull();
		expect(clampWritePath(APP, `${PREFIX.slice(0, -1)}/_app`)).toBeNull();
		// other apps' _app/ + company knowledge are OUT.
		expect(
			clampWritePath(APP, "company/apps/other/_app/manifest.json"),
		).toBeNull();
		expect(clampWritePath(APP, "company/secrets/x")).toBeNull();
	});

	// ── `_app/` write-ban bypass via mid-path `./` / `..` (the G1 normalize fix) ──
	it("clampWritePath rejects _app/ reached via a MID-PATH ./ (normalize match)", () => {
		// The attack: `./` mid-path survived the OLD normalizer (leading-only strip)
		// so the `_app/` ban missed it, yet Knowledge `posix.normalize`s on write and
		// persisted under _app/. The clamp now normalizes identically → REJECT.
		expect(clampWritePath(APP, `${PREFIX}./_app/server.ts`)).toBeNull();
		expect(clampWritePath(APP, `${PREFIX}data/../_app/x`)).toBeNull();
		expect(
			clampWritePath(APP, `${PREFIX}data/./../_app/manifest.json`),
		).toBeNull();
		// direct _app/ is still rejected.
		expect(clampWritePath(APP, `${PREFIX}_app/x`)).toBeNull();
		// and a benign `./`-prefixed in-scope data path normalizes + is accepted.
		expect(clampWritePath(APP, `${PREFIX}./data/foo.json`)).toBe(
			`${PREFIX}data/foo.json`,
		);
	});

	it("normalizeAppPath collapses `.`/`..` exactly like Knowledge's stored form", () => {
		// mid-path `.` collapses (was the bypass).
		expect(normalizeAppPath(`${PREFIX}./_app/server.ts`)).toBe(
			`${PREFIX}_app/server.ts`,
		);
		// `..` that escapes the subtree is rejected outright.
		expect(normalizeAppPath(`${PREFIX}data/../../other/x`)).toBe(
			"company/apps/other/x",
		);
		// a pure escape is null.
		expect(normalizeAppPath("a/../../b")).toBeNull();
	});
});

// ───────────────────── appId charset (synthetic-principal) ──────────────────

describe("appId charset is constrained (no principal collision/injection)", () => {
	const ctx = () => makeCtx({});
	it("buildMiniAppBindingTarget rejects a malformed appId", () => {
		// uppercase, `:` (would collide with the `app:{id}` principal namespace),
		// `/` (path injection), empty, leading dash.
		for (const bad of ["Social", "a:b", "a/b", "", "-x", "app:admin", ".."]) {
			expect(() =>
				buildMiniAppBindingTarget(bad, ctx(), undefined, noRelations),
			).toThrow();
		}
	});
	it("accepts a normal slug appId", () => {
		expect(() =>
			buildMiniAppBindingTarget("social-app-1", ctx(), undefined, noRelations),
		).not.toThrow();
	});
});

// ───────────────────── G1 enforced through the real broker ──────────────────

describe("G1: broker dispatch is clamped to the tenant subtree", () => {
	/**
	 * The HOSTILE manifest: declares `knowledge.read/write:["**"]` — i.e. it tries
	 * to read+write ANY knowledge path. The HOST bound must clamp it regardless.
	 */
	const HOSTILE_CAPS = {
		files: { read: ["**"], write: ["**"] },
		data: { collections: { posts: ["read"] as Array<"read"> } },
	};

	function wire(seed: KnowledgeRow[] = []) {
		const knowledge = makeKnowledgeResource(seed);
		const ctx = makeCtx({ knowledge });
		const target = buildMiniAppBindingTarget(APP, ctx, HOSTILE_CAPS);
		const broker = new SandboxBroker();
		const { token } = broker.mint({ capabilities: HOSTILE_CAPS, target });
		return { knowledge, broker, token };
	}

	it("writing its OWN data/ file succeeds", async () => {
		const { knowledge, broker, token } = wire();
		const res = await broker.handleRpc(token, "files.write", {
			path: `${PREFIX}data/foo.json`,
			body: '{"ok":true}',
		});
		expect(res.ok).toBe(true);
		expect(
			knowledge.rows.some((r) => r.path === `${PREFIX}data/foo.json`),
		).toBe(true);
	});

	it("writing ANOTHER app's _app/manifest.json is REJECTED (clamped)", async () => {
		const { knowledge, broker, token } = wire();
		const res = await broker.handleRpc(token, "files.write", {
			path: "company/apps/other/_app/manifest.json",
			body: "HOSTILE",
		});
		expect(res.ok).toBe(false);
		// nothing was written.
		expect(knowledge.rows.length).toBe(0);
	});

	it("writing company-wide secrets is REJECTED (clamped)", async () => {
		const { knowledge, broker, token } = wire();
		const res = await broker.handleRpc(token, "files.write", {
			path: "company/secrets/x",
			body: "HOSTILE",
		});
		expect(res.ok).toBe(false);
		expect(knowledge.rows.length).toBe(0);
	});

	it("writing its OWN _app/ (code/manifest) is REJECTED (data-only)", async () => {
		const { knowledge, broker, token } = wire();
		const res = await broker.handleRpc(token, "files.write", {
			path: `${PREFIX}_app/manifest.json`,
			body: "HOSTILE",
		});
		expect(res.ok).toBe(false);
		expect(knowledge.rows.length).toBe(0);
	});

	it("reading ANOTHER app's data is REJECTED (clamped), own data works", async () => {
		const { broker, token } = wire([
			{
				id: "own",
				path: `${PREFIX}data/posts.json`,
				title: null,
				body: "[1,2]",
				contentType: "application/json",
				metadata: null,
			},
			{
				id: "other",
				path: "company/apps/other/data/secret.json",
				title: null,
				body: "TOPSECRET",
				contentType: "application/json",
				metadata: null,
			},
		]);

		const own = await broker.handleRpc(token, "files.read", {
			path: `${PREFIX}data/posts.json`,
		});
		expect(own.ok).toBe(true);
		expect(own.ok && (own.value as { body: string }).body).toBe("[1,2]");

		const other = await broker.handleRpc(token, "files.read", {
			path: "company/apps/other/data/secret.json",
		});
		expect(other.ok).toBe(false);
	});
});

// ───────── knowledge authorization model: clamp (G1) → system-mode ───────────
//
// The LIVE e2e bug: the knowledge primitive ran user-mode (inherited from the
// request ALS) and the shared `knowledge` collection's access rule DENIED the
// app's read/write of its OWN data ("does not have permission",
// crud-generator.ts:469). The fix: the bindings dispatch the file-as-DB
// primitive under `accessMode:"system"` AFTER the G1 clamp — the clamp IS the
// tenant authorization, so the collection rule must not additionally gate the
// app's own already-clamped data. The `makeKnowledgeResource` double here MODELS
// that gate (non-system → throw the same permission error), so these tests fail
// closed if the dispatch ever reverts to user-mode.

describe("knowledge: own-subtree authorized via the G1 clamp (system-mode dispatch)", () => {
	const CAPS = {
		files: { read: ["**"], write: ["**"] },
	};
	function wire(seed: KnowledgeRow[] = []) {
		const knowledge = makeKnowledgeResource(seed);
		const ctx = makeCtx({
			knowledge,
			// A REAL logged-in invoker is present (the named-endpoint case). Even so,
			// the invoker holds NO `read`/`write` on the shared `knowledge` collection
			// — only system-mode (post-clamp) may touch the app's own data.
			session: { user: { id: "user_123" } },
		});
		const target = buildMiniAppBindingTarget(APP, ctx, CAPS);
		const broker = new SandboxBroker();
		const { token } = broker.mint({ capabilities: CAPS, target });
		return { knowledge, broker, token };
	}

	it("read of OWN clamped path SUCCEEDS and dispatches accessMode:'system'", async () => {
		const { knowledge, broker, token } = wire([
			{
				id: "own",
				path: `${PREFIX}data/posts.json`,
				title: null,
				body: "[1,2]",
				contentType: "application/json",
				metadata: null,
			},
		]);
		const res = await broker.handleRpc(token, "files.read", {
			path: `${PREFIX}data/posts.json`,
		});
		expect(res.ok).toBe(true);
		expect(res.ok && (res.value as { body: string }).body).toBe("[1,2]");
		// the primitive ran under system-mode (NOT the user's denied principal).
		expect(knowledge.ctxCalls).toEqual([
			{ method: "readByPath", context: { accessMode: "system" } },
		]);
	});

	it("write of OWN clamped path PERSISTS under system-mode", async () => {
		const { knowledge, broker, token } = wire();
		const res = await broker.handleRpc(token, "files.write", {
			path: `${PREFIX}data/foo.json`,
			body: '{"ok":true}',
		});
		expect(res.ok).toBe(true);
		expect(
			knowledge.rows.some((r) => r.path === `${PREFIX}data/foo.json`),
		).toBe(true);
		expect(
			knowledge.ctxCalls.every((c) => c.context?.accessMode === "system"),
		).toBe(true);
	});

	it("list of OWN subtree SUCCEEDS under system-mode", async () => {
		const { knowledge, broker, token } = wire([
			{
				id: "own",
				path: `${PREFIX}data/a.json`,
				title: null,
				body: "1",
				contentType: "application/json",
				metadata: null,
			},
		]);
		const res = await broker.handleRpc(token, "files.list", {
			path: `${PREFIX}data`,
		});
		expect(res.ok).toBe(true);
		expect(res.ok && (res.value as unknown[]).length).toBe(1);
		expect(knowledge.ctxCalls).toEqual([
			{ method: "listByPrefix", context: { accessMode: "system" } },
		]);
	});

	it("OUT-OF-SCOPE read is rejected by the CLAMP and NEVER reaches the primitive", async () => {
		const { knowledge, broker, token } = wire();
		const res = await broker.handleRpc(token, "files.read", {
			path: "company/apps/other/data/secret.json",
		});
		expect(res.ok).toBe(false);
		// the clamp returned null → no system-mode call was ever made.
		expect(knowledge.ctxCalls).toHaveLength(0);
	});

	it("`..` traversal + own `_app/` write are clamp-rejected before any system-mode call", async () => {
		const { knowledge, broker, token } = wire();
		const traversal = await broker.handleRpc(token, "files.read", {
			path: `${PREFIX}../other/x.json`,
		});
		expect(traversal.ok).toBe(false);
		const appWrite = await broker.handleRpc(token, "files.write", {
			path: `${PREFIX}_app/manifest.json`,
			body: "HOSTILE",
		});
		expect(appWrite.ok).toBe(false);
		// neither out-of-scope path ever reached the (system-mode) primitive.
		expect(knowledge.ctxCalls).toHaveLength(0);
		expect(knowledge.rows).toHaveLength(0);
	});
});

// ─────────────────────── G2: non-privileged dispatch ────────────────────────

describe("G2: collections dispatch as user-mode with a principal", () => {
	it("buildAppPrincipalSession reuses a real session, never system", () => {
		const real = buildAppPrincipalSession(
			APP,
			makeCtx({ session: { user: { id: "user_123" } } }),
		);
		expect(real?.user.id).toBe("user_123");

		const synth = buildAppPrincipalSession(APP, makeCtx({}));
		expect(synth?.user.id).toBe(`app:${APP}`);
		// synthesized principal is flagged + namespaced (not a real resolvable user).
		expect(synth?.session.synthetic).toBe(true);
	});

	it("find() reaches the collection carrying accessMode:'user' + principal", async () => {
		const rec = recordingCollection([{ id: "p1", title: "hi" }]);
		const ctx = makeCtx({
			collections: { posts: rec.collection },
			session: { user: { id: "user_123" } },
		});
		const caps = {
			data: { collections: { posts: ["read"] as Array<"read"> } },
		};
		const target = buildMiniAppBindingTarget(APP, ctx, caps, noRelations);
		const broker = new SandboxBroker();
		const { token } = broker.mint({ capabilities: caps, target });

		const res = await broker.handleRpc(token, "collections.posts.find", {
			where: { title: "hi" },
		});
		expect(res.ok).toBe(true);

		// The dispatched CRUD context proves G2: user-mode + the run's principal.
		expect(rec.calls).toHaveLength(1);
		const ctxArg = rec.calls[0]!.context as {
			accessMode?: string;
			session?: { user?: { id?: string } };
		};
		expect(ctxArg.accessMode).toBe("user");
		expect(ctxArg.accessMode).not.toBe("system");
		expect(ctxArg.session?.user?.id).toBe("user_123");
	});

	it("synthesized app-principal is passed when the run has no session", async () => {
		const rec = recordingCollection([]);
		const ctx = makeCtx({ collections: { posts: rec.collection } });
		const caps = {
			data: { collections: { posts: ["read"] as Array<"read"> } },
		};
		const target = buildMiniAppBindingTarget(APP, ctx, caps, noRelations);
		const broker = new SandboxBroker();
		const { token } = broker.mint({ capabilities: caps, target });

		await broker.handleRpc(token, "collections.posts.findOne", {
			where: { id: "x" },
		});
		const ctxArg = rec.calls[0]!.context as {
			accessMode?: string;
			session?: { user?: { id?: string } };
		};
		expect(ctxArg.accessMode).toBe("user");
		expect(ctxArg.session?.user?.id).toBe(`app:${APP}`);
	});
});

// ───────────────────────────── G3: relation guard ──────────────────────────

describe("G3: relation expansion is denied", () => {
	function wire(
		relationFieldsFor: (name: string) => Set<string> | null = noRelations,
	) {
		const rec = recordingCollection([{ id: "p1" }]);
		const ctx = makeCtx({ collections: { posts: rec.collection } });
		const caps = {
			data: { collections: { posts: ["read"] as Array<"read"> } },
		};
		const target = buildMiniAppBindingTarget(APP, ctx, caps, relationFieldsFor);
		const broker = new SandboxBroker();
		const { token } = broker.mint({ capabilities: caps, target });
		return { rec, broker, token };
	}

	it("find({ with: ... }) is denied and never reaches the collection", async () => {
		const { rec, broker, token } = wire();
		const res = await broker.handleRpc(token, "collections.posts.find", {
			with: { author: true },
		});
		expect(res.ok).toBe(false);
		expect(res.ok === false && res.error.code).toBe("execution_error");
		// the underlying collection was NEVER called.
		expect(rec.calls).toHaveLength(0);
	});

	it("findOne({ populate: ... }) is denied", async () => {
		const { rec, broker, token } = wire();
		const res = await broker.handleRpc(token, "collections.posts.findOne", {
			populate: ["author"],
		});
		expect(res.ok).toBe(false);
		expect(rec.calls).toHaveLength(0);
	});

	it("a plain find (no relations) still works", async () => {
		const { rec, broker, token } = wire();
		const res = await broker.handleRpc(token, "collections.posts.find", {
			where: { id: "p1" },
		});
		expect(res.ok).toBe(true);
		expect(rec.calls).toHaveLength(1);
	});

	// ── relation `where`/`orderBy` ORACLE (the G3 fix) ──
	it("find({ where: { <relation> } }) is denied (EXISTS-subquery oracle)", async () => {
		const { rec, broker, token } = wire(relations({ posts: ["author"] }));
		const res = await broker.handleRpc(token, "collections.posts.find", {
			where: { author: { id: "secret-user" } },
		});
		expect(res.ok).toBe(false);
		expect(res.ok === false && res.error.code).toBe("execution_error");
		// the underlying collection (→ raw EXISTS subquery) was NEVER reached.
		expect(rec.calls).toHaveLength(0);
	});

	it("a relation named inside an AND/OR combinator is still denied", async () => {
		const { rec, broker, token } = wire(relations({ posts: ["author"] }));
		const res = await broker.handleRpc(token, "collections.posts.find", {
			where: { AND: [{ title: "hi" }, { author: { some: { id: "x" } } }] },
		});
		expect(res.ok).toBe(false);
		expect(rec.calls).toHaveLength(0);
	});

	it("find({ orderBy: { <relation> } }) is denied", async () => {
		const { rec, broker, token } = wire(relations({ posts: ["author"] }));
		const res = await broker.handleRpc(token, "collections.posts.find", {
			orderBy: { author: "asc" },
		});
		expect(res.ok).toBe(false);
		expect(rec.calls).toHaveLength(0);
	});

	it("find({ orderBy: [ { <relation> } ] }) (array form) is also denied", async () => {
		const { rec, broker, token } = wire(relations({ posts: ["author"] }));
		const res = await broker.handleRpc(token, "collections.posts.find", {
			orderBy: [{ title: "asc" }, { author: "desc" }],
		});
		expect(res.ok).toBe(false);
		expect(rec.calls).toHaveLength(0);
	});

	it("a scalar `where`/`orderBy` still works when relations exist", async () => {
		const { rec, broker, token } = wire(relations({ posts: ["author"] }));
		const res = await broker.handleRpc(token, "collections.posts.find", {
			where: { title: "hi" },
			orderBy: { createdAt: "desc" },
		});
		expect(res.ok).toBe(true);
		expect(rec.calls).toHaveLength(1);
	});

	it("FAILS CLOSED: an unresolved relation set rejects ANY where/orderBy ref", async () => {
		const { rec, broker, token } = wire(unknownRelations);
		const res = await broker.handleRpc(token, "collections.posts.find", {
			where: { title: "hi" },
		});
		expect(res.ok).toBe(false);
		expect(rec.calls).toHaveLength(0);

		// …but a no-arg / empty find (nothing to leak) still works.
		const ok = await broker.handleRpc(token, "collections.posts.find", {});
		expect(ok.ok).toBe(true);
	});

	it("the target throws a typed MiniAppBindingError on relation args (unit)", async () => {
		const rec = recordingCollection([]);
		const ctx = makeCtx({ collections: { posts: rec.collection } });
		const target = buildMiniAppBindingTarget(APP, ctx, undefined, noRelations);
		await expect(
			target.collections!.posts!.find!({ with: { x: true } }),
		).rejects.toBeInstanceOf(MiniAppBindingError);
	});
});

// ─────────────────── WRITE dispatch is DEFERRED (no §7 boundary) ─────────────
//
// Guest collection writes (`create|update|delete`) are NOT dispatched: there is
// no §7 tenant-write boundary yet (no `document_store`, no `store`-grant
// row-filter clamp, no force-stamp / reject-client-`id`/`app`/`createdAt`, no
// blast-radius containment). Shipping a bare write pass-through would make a
// granted, write-rule-less collection fully writable/deletable by the synthesized
// app-principal (the framework access fallback for an absent write rule is
// `!!session`, which the principal satisfies). So writes fail closed at BOTH
// layers, asserted here through the REAL `SandboxBroker.handleRpc` chokepoint:
//   1. the runner's target wires NO write handler (`target.collections.X.create`
//      is `undefined`), and
//   2. the broker returns `not_implemented` for a GRANTED write verb (and still
//      `forbidden` for an UNGRANTED one — the capability check fires first).
// The underlying collection is NEVER called for any write.
// See `.private/miniapps-v2-design.md` §7 + Decision 8.

describe("WRITE: guest collection writes are NOT dispatched (deferred §7 boundary)", () => {
	function wire(
		grants: Array<"read" | "create" | "update" | "delete">,
		relationFieldsFor: (name: string) => Set<string> | null = noRelations,
	) {
		const rec = recordingCollection([{ id: "p1" }]);
		const ctx = makeCtx({
			collections: { posts: rec.collection },
			session: { user: { id: "user_123" } },
		});
		const caps = { data: { collections: { posts: grants } } };
		const target = buildMiniAppBindingTarget(APP, ctx, caps, relationFieldsFor);
		const broker = new SandboxBroker();
		const { token } = broker.mint({ capabilities: caps, target });
		return { rec, target, broker, token };
	}

	it("the runner wires NO create/update/delete handler on the target", () => {
		const { rec, target } = wire(["read", "create", "update", "delete"]);
		const posts = target.collections!.posts!;
		// Reads ARE wired; writes are deliberately absent (broker → not_implemented).
		expect(typeof posts.find).toBe("function");
		expect(typeof posts.findOne).toBe("function");
		expect(posts.create).toBeUndefined();
		expect(posts.update).toBeUndefined();
		expect(posts.delete).toBeUndefined();
		expect(rec.calls).toHaveLength(0);
	});

	it("a GRANTED write verb returns not_implemented; the collection is NEVER written", async () => {
		// Full write grant — the capability check passes, but dispatch is deferred.
		const { rec, broker, token } = wire(["read", "create", "update", "delete"]);
		const create = await broker.handleRpc(token, "collections.posts.create", {
			title: "hello",
		});
		expect(create.ok).toBe(false);
		expect(create.ok === false && create.error.code).toBe("not_implemented");

		const update = await broker.handleRpc(token, "collections.posts.update", {
			where: { id: "p1" },
			data: { title: "x" },
		});
		expect(update.ok).toBe(false);
		expect(update.ok === false && update.error.code).toBe("not_implemented");

		const del = await broker.handleRpc(token, "collections.posts.delete", {
			where: { id: "p1" },
		});
		expect(del.ok).toBe(false);
		expect(del.ok === false && del.error.code).toBe("not_implemented");

		// No write ever reached the underlying collection.
		expect(rec.calls).toHaveLength(0);
	});

	it("a destructive broad-`where` delete (the blast-radius vector) is NOT dispatched", async () => {
		// The exact critical-issue vector: a granted delete with a broad scalar
		// `where` would, without the §7 clamp, delete arbitrary rows. It must fail
		// closed as not_implemented (no live delete primitive), collection untouched.
		const { rec, broker, token } = wire(["delete"]);
		const del = await broker.handleRpc(token, "collections.posts.delete", {
			where: { archived: true },
		});
		expect(del.ok).toBe(false);
		expect(del.ok === false && del.error.code).toBe("not_implemented");
		expect(rec.calls).toHaveLength(0);
	});

	it("FAILS CLOSED: a write verb NOT granted is forbidden BEFORE not_implemented", async () => {
		// read-only grant → the capability check denies every write verb first.
		const { rec, broker, token } = wire(["read"]);
		for (const op of ["create", "update", "delete"] as const) {
			const res = await broker.handleRpc(token, `collections.posts.${op}`, {
				data: {},
				where: {},
			});
			expect(res.ok).toBe(false);
			// forbidden (capability), NOT not_implemented — the check runs upstream.
			expect(res.ok === false && res.error.code).toBe("forbidden");
		}
		expect(rec.calls).toHaveLength(0);
	});

	it("client-supplied id/createdAt/app on a granted create cannot land (write not dispatched)", async () => {
		// The high-severity spoofing vector: a payload carrying `id`/`createdAt`/`app`.
		// With no write dispatch + no write handler, it never reaches the insert at
		// all — there is no path for the spoofed meta to be persisted.
		const { rec, broker, token } = wire(["create"]);
		const res = await broker.handleRpc(token, "collections.posts.create", {
			id: "forged-pk",
			createdAt: "1970-01-01T00:00:00.000Z",
			app: "victim-tenant",
			title: "hi",
		});
		expect(res.ok).toBe(false);
		expect(res.ok === false && res.error.code).toBe("not_implemented");
		expect(rec.calls).toHaveLength(0);
	});
});

// ───────────────── capability check still gates ungranted access ────────────

describe("defense in depth: broker capability check fires before the host bound", () => {
	it("an ungranted collection is forbidden before any dispatch", async () => {
		const rec = recordingCollection([]);
		const ctx = makeCtx({ collections: { posts: rec.collection } });
		// caps grant NOTHING.
		const caps = {};
		const target = buildMiniAppBindingTarget(APP, ctx, caps);
		const broker = new SandboxBroker();
		const { token } = broker.mint({ capabilities: caps, target });

		const res = await broker.handleRpc(token, "collections.posts.find", {});
		expect(res.ok).toBe(false);
		expect(res.ok === false && res.error.code).toBe("forbidden");
		expect(rec.calls).toHaveLength(0);
	});

	it("a knowledge.write WITHIN the host bound but OUTSIDE the manifest glob is forbidden", async () => {
		const knowledge = makeKnowledgeResource();
		const ctx = makeCtx({ knowledge });
		// manifest only allows writing under data/reports/, host bound allows all data/.
		const caps = {
			files: { write: [`${PREFIX}data/reports/**`] },
		};
		const target = buildMiniAppBindingTarget(APP, ctx, caps);
		const broker = new SandboxBroker();
		const { token } = broker.mint({ capabilities: caps, target });

		// in-bound but not in the manifest glob → broker forbids.
		const res = await broker.handleRpc(token, "files.write", {
			path: `${PREFIX}data/other.json`,
			body: "x",
		});
		expect(res.ok).toBe(false);
		expect(res.ok === false && res.error.code).toBe("forbidden");
		expect(knowledge.rows.length).toBe(0);

		// in the manifest glob AND in-bound → succeeds.
		const ok = await broker.handleRpc(token, "files.write", {
			path: `${PREFIX}data/reports/q1.json`,
			body: "x",
		});
		expect(ok.ok).toBe(true);
	});
});
