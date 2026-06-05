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
/** The app home (its writable data lives under `${PREFIX}data/`). */
const PREFIX = `company/apps/${APP}/`;
/** The guest-READ-ONLY `.app` bundle prefix (code/manifest/UI). */
const BUNDLE = `company/apps/${APP}.app/`;
/** The WRITABLE data prefix (OUTSIDE the bundle), == `${PREFIX}data/`. */
const DATA = `${PREFIX}data/`;

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

	it("clampReadPath confines reads to the .app bundle + the data subtree", () => {
		// data files are readable.
		expect(clampReadPath(APP, `${DATA}posts.json`)).toBe(`${DATA}posts.json`);
		// the app's own .app bundle (code/manifest/UI) IS readable (read-only).
		expect(clampReadPath(APP, `${BUNDLE}server.ts`)).toBe(`${BUNDLE}server.ts`);
		expect(clampReadPath(APP, `${BUNDLE}index.html`)).toBe(`${BUNDLE}index.html`);
		// each root itself is allowed (for listing).
		expect(clampReadPath(APP, `${BUNDLE.slice(0, -1)}`)).toBe(BUNDLE.slice(0, -1));
		expect(clampReadPath(APP, `${DATA.slice(0, -1)}`)).toBe(DATA.slice(0, -1));
		// the app HOME root (`company/apps/social/`) is NOT a read root — only the
		// .app bundle + the data subtree are (a stray file at the home root is OUT).
		expect(clampReadPath(APP, `${PREFIX.slice(0, -1)}`)).toBeNull();
		expect(clampReadPath(APP, `${PREFIX}stray.json`)).toBeNull();
		// another app, its .app bundle, or company-wide knowledge, are OUT.
		expect(clampReadPath(APP, "company/apps/other/data/x.json")).toBeNull();
		expect(clampReadPath(APP, "company/apps/other.app/server.ts")).toBeNull();
		expect(clampReadPath(APP, "company/secrets/x")).toBeNull();
		// a glob-ish escape never widens.
		expect(clampReadPath(APP, "..")).toBeNull();
	});

	it("clampWritePath confines writes to the data subtree AND bans the .app bundle", () => {
		expect(clampWritePath(APP, `${DATA}foo.json`)).toBe(`${DATA}foo.json`);
		// the .app bundle (code + the INLINE manifest) is NOT writable.
		expect(clampWritePath(APP, `${BUNDLE}server.ts`)).toBeNull();
		expect(clampWritePath(APP, `${BUNDLE}index.html`)).toBeNull();
		expect(clampWritePath(APP, `${BUNDLE.slice(0, -1)}`)).toBeNull();
		// the app HOME root (non-data) is NOT writable either — data subtree only.
		expect(clampWritePath(APP, `${PREFIX}stray.json`)).toBeNull();
		expect(clampWritePath(APP, `${DATA.slice(0, -1)}`)).toBeNull(); // the data dir itself
		// other apps' bundles/data + company knowledge are OUT.
		expect(clampWritePath(APP, "company/apps/other.app/server.ts")).toBeNull();
		expect(clampWritePath(APP, "company/apps/other/data/x.json")).toBeNull();
		expect(clampWritePath(APP, "company/secrets/x")).toBeNull();
	});

	// ── `.app/` write-ban bypass via mid-path `./` / `..` (the G1 normalize fix) ──
	it("clampWritePath rejects the .app bundle reached via a MID-PATH ./ or .. (normalize match)", () => {
		// The attack: a `./`/`..` mid-path could try to climb out of `data/` into the
		// sibling `.app` bundle. The clamp normalizes FIRST (exactly as Knowledge
		// stores) so the escape is collapsed and then rejected.
		expect(clampWritePath(APP, `${DATA}../../${APP}.app/server.ts`)).toBeNull();
		expect(clampWritePath(APP, `${DATA}./../../${APP}.app/x`)).toBeNull();
		// climbing to the app home root (out of data/) is rejected.
		expect(clampWritePath(APP, `${DATA}../stray.json`)).toBeNull();
		// a benign `./`-prefixed in-scope data path normalizes + is accepted.
		expect(clampWritePath(APP, `${PREFIX}data/./foo.json`)).toBe(`${DATA}foo.json`);
	});

	it("normalizeAppPath collapses `.`/`..` exactly like Knowledge's stored form", () => {
		// mid-path `.` collapses.
		expect(normalizeAppPath(`${DATA}./foo.json`)).toBe(`${DATA}foo.json`);
		// `..` that escapes the subtree is collapsed (then the clamp rejects it).
		expect(normalizeAppPath(`${DATA}../../other/x`)).toBe("company/apps/other/x");
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

	it("writing ANOTHER app's .app bundle is REJECTED (clamped)", async () => {
		const { knowledge, broker, token } = wire();
		const res = await broker.handleRpc(token, "files.write", {
			path: "company/apps/other.app/server.ts",
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

	it("writing its OWN .app bundle (code/inline manifest) is REJECTED (data-only)", async () => {
		const { knowledge, broker, token } = wire();
		// The self-escalation vector: a hostile guest rewriting its own server.ts
		// (which holds the INLINE manifest — the next run's capability source).
		for (const path of [`${BUNDLE}server.ts`, `${BUNDLE}index.html`]) {
			const res = await broker.handleRpc(token, "files.write", {
				path,
				body: "HOSTILE",
			});
			expect(res.ok).toBe(false);
		}
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

	it("`..` traversal + own .app bundle write are clamp-rejected before any system-mode call", async () => {
		const { knowledge, broker, token } = wire();
		const traversal = await broker.handleRpc(token, "files.read", {
			path: `${PREFIX}../other/x.json`,
		});
		expect(traversal.ok).toBe(false);
		const appWrite = await broker.handleRpc(token, "files.write", {
			path: `${BUNDLE}server.ts`,
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

// ───────── G4: NON-document_store collection writes (explicit-rule gate) ──────
//
// The §7 write boundary (Decision 8) re-enables guest collection writes — but a
// NON-`document_store` collection write is dispatched ONLY where the collection has
// its OWN explicit `.access().create/update/delete` rule (evaluated under the
// non-privileged app-principal). A collection that relies on the framework's
// rule-less `!!session` fallback gets NO write handler — the WS-2 CRITICAL: the
// synthesized app-principal satisfies `!!session`, so a bare pass-through would
// make a write-rule-less collection fully writable/deletable. The host wires the
// write ONLY when `collectionWriteRuleFor(name, op)` proves an explicit rule, so a
// rule-less collection's write fails closed (`not_implemented`) at the broker.
// All asserted through the REAL `SandboxBroker.handleRpc` chokepoint.

/** A write-rule resolver: report which (collection, op) pairs have explicit rules. */
function writeRules(
	map: Record<string, Array<"create" | "update" | "delete">>,
): (name: string, op: "create" | "update" | "delete") => boolean {
	return (name, op) => (map[name] ?? []).includes(op);
}
/** No collection declares any explicit write rule (the rule-less / fail-closed path). */
const noWriteRules = () => false;

describe("G4: a write-rule-less collection write is DENIED (the WS-2 critical)", () => {
	function wire(
		grants: Array<"read" | "create" | "update" | "delete">,
		writeRuleFor: (name: string, op: "create" | "update" | "delete") => boolean,
	) {
		const rec = recordingCollection([{ id: "p1" }]);
		const ctx = makeCtx({
			collections: { posts: rec.collection },
			// A REAL logged-in invoker → the synthesized principal is NOT even needed;
			// this is the user whose `!!session` the rule-less fallback would satisfy.
			session: { user: { id: "user_123" } },
		});
		const caps = { data: { collections: { posts: grants } } };
		const target = buildMiniAppBindingTarget(
			APP,
			ctx,
			caps,
			noRelations,
			writeRuleFor,
		);
		const broker = new SandboxBroker();
		const { token } = broker.mint({ capabilities: caps, target });
		return { rec, target, broker, token };
	}

	it("wires NO write handler for a collection with NO explicit write rule", () => {
		const { rec, target } = wire(
			["read", "create", "update", "delete"],
			noWriteRules,
		);
		const posts = target.collections!.posts!;
		// Reads ARE wired; writes stay unwired (→ broker not_implemented).
		expect(typeof posts.find).toBe("function");
		expect(posts.create).toBeUndefined();
		expect(posts.update).toBeUndefined();
		expect(posts.delete).toBeUndefined();
		expect(rec.calls).toHaveLength(0);
	});

	it("a GRANTED write to a rule-less collection returns not_implemented; the collection is NEVER written", async () => {
		// Capability check passes (the verb is granted) but there is no explicit
		// access rule, so the host wires no handler → fail closed. THIS is the WS-2
		// critical: without this the app-principal's `!!session` would let the write
		// through against a write-rule-less collection.
		const { rec, broker, token } = wire(
			["read", "create", "update", "delete"],
			noWriteRules,
		);
		const create = await broker.handleRpc(token, "collections.posts.create", {
			title: "hello",
		});
		expect(create.ok).toBe(false);
		expect(create.ok === false && create.error.code).toBe("not_implemented");

		const del = await broker.handleRpc(token, "collections.posts.delete", {
			where: { archived: true }, // the blast-radius vector
		});
		expect(del.ok).toBe(false);
		expect(del.ok === false && del.error.code).toBe("not_implemented");

		expect(rec.calls).toHaveLength(0);
	});

	it("FAILS CLOSED: a write verb NOT granted is forbidden BEFORE the rule check", async () => {
		// read-only grant → the capability check denies every write verb first.
		const { rec, broker, token } = wire(["read"], writeRules({ posts: ["create"] }));
		for (const op of ["create", "update", "delete"] as const) {
			const res = await broker.handleRpc(token, `collections.posts.${op}`, {
				data: {},
				where: {},
			});
			expect(res.ok).toBe(false);
			expect(res.ok === false && res.error.code).toBe("forbidden");
		}
		expect(rec.calls).toHaveLength(0);
	});
});

describe("G4: a write to a collection WITH an explicit rule IS dispatched (user-mode + G3)", () => {
	function wire(
		grants: Array<"read" | "create" | "update" | "delete">,
		writeRuleFor: (name: string, op: "create" | "update" | "delete") => boolean,
		relationFieldsFor: (name: string) => Set<string> | null = noRelations,
	) {
		const rec = recordingCollection([{ id: "p1" }]);
		const ctx = makeCtx({
			collections: { posts: rec.collection },
			session: { user: { id: "user_123" } },
		});
		const caps = { data: { collections: { posts: grants } } };
		const target = buildMiniAppBindingTarget(
			APP,
			ctx,
			caps,
			relationFieldsFor,
			writeRuleFor,
		);
		const broker = new SandboxBroker();
		const { token } = broker.mint({ capabilities: caps, target });
		return { rec, target, broker, token };
	}

	it("create dispatches under accessMode:'user' + the run's principal (so the rule actually gates it)", async () => {
		const { rec, broker, token } = wire(
			["create"],
			writeRules({ posts: ["create"] }),
		);
		const res = await broker.handleRpc(token, "collections.posts.create", {
			title: "hello",
		});
		expect(res.ok).toBe(true);
		expect(rec.calls).toHaveLength(1);
		const ctxArg = rec.calls[0]!.context as {
			accessMode?: string;
			session?: { user?: { id?: string } };
		};
		// The collection's OWN rule is evaluated under user-mode + the principal —
		// NEVER system (which would bypass the very rule that authorizes the write).
		expect(ctxArg.accessMode).toBe("user");
		expect(ctxArg.accessMode).not.toBe("system");
		expect(ctxArg.session?.user?.id).toBe("user_123");
	});

	it("update/delete reach the collection by-`where` when the op has an explicit rule", async () => {
		const { rec, broker, token } = wire(
			["update", "delete"],
			writeRules({ posts: ["update", "delete"] }),
		);
		const upd = await broker.handleRpc(token, "collections.posts.update", {
			where: { id: "p1" },
			data: { title: "x" },
		});
		expect(upd.ok).toBe(true);
		const del = await broker.handleRpc(token, "collections.posts.delete", {
			where: { id: "p1" },
		});
		expect(del.ok).toBe(true);
		expect(rec.calls.map((c) => c.method)).toEqual(["update", "delete"]);
	});

	it("only the ops WITH an explicit rule are wired (per-op granularity)", async () => {
		// create has an explicit rule; update/delete do NOT → only create dispatches.
		const { rec, broker, token } = wire(
			["create", "update", "delete"],
			writeRules({ posts: ["create"] }),
		);
		const create = await broker.handleRpc(token, "collections.posts.create", {
			title: "ok",
		});
		expect(create.ok).toBe(true);
		const update = await broker.handleRpc(token, "collections.posts.update", {
			where: { id: "p1" },
			data: {},
		});
		expect(update.ok === false && update.error.code).toBe("not_implemented");
		expect(rec.calls.map((c) => c.method)).toEqual(["create"]);
	});

	it("G3 write-side guard: a relation `where` on an explicit-rule update is REJECTED (oracle)", async () => {
		const { rec, broker, token } = wire(
			["update"],
			writeRules({ posts: ["update"] }),
			relations({ posts: ["author"] }),
		);
		const res = await broker.handleRpc(token, "collections.posts.update", {
			where: { author: { id: "secret-user" } },
			data: { title: "x" },
		});
		expect(res.ok).toBe(false);
		expect(res.ok === false && res.error.code).toBe("execution_error");
		// The relation-referencing write never reached the collection.
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

// ─────────────────── G4: document_store row-filter store-grant clamp ─────────
//
// `document_store` is the namespaced jsonb record store (Decision 8 + §7). The
// store-grant clamp (a ROW-FILTER mechanism, NOT the G1 string-prefix path clamp)
// confines every CRUD to the run's GRANTED stores (`capabilities.data.stores`):
//   READ   → inject `where.store ∈ grantedRead` (+ the G3 where/orderBy guard);
//   CREATE → row `store` MUST be granted `write`; stamp `createdByApp`; reject a
//            client-supplied `store`/`id`/`createdAt`/`createdByApp`;
//   UPDATE/DELETE → blast-radius-contain the `where` to granted stores; strip any
//            identity/`store` mutation from the patch.
// Dispatched accessMode:'system' — the clamp IS the authorization (mirrors G1).
// Cross-app sharing = the SAME store name granted on two apps. All asserted via
// the REAL `SandboxBroker.handleRpc` chokepoint against an in-memory store.

interface DocRow {
	id: string;
	store: string;
	key: string;
	data: unknown;
	createdByApp: string;
	createdAt: string;
}

/**
 * An in-memory `document_store` double modeling the real CRUD semantics the clamp
 * relies on: by-`where` find/update/delete keyed on a `store` filter (`{ in: [] }`
 * and a literal `store`), nested under an `AND` combinator (how the clamp wraps the
 * guest `where`). It records the CRUD context + args so the clamp can be asserted.
 */
function makeDocumentStore(seed: DocRow[] = []) {
	const rows: DocRow[] = [...seed];
	const calls: Array<{ method: string; args: unknown; context: unknown }> = [];
	let seq = 0;

	/** Resolve the effective store filter the clamp injected (the `{ in: [...] }`). */
	function allowedStores(where: unknown): string[] | null {
		// The clamp shape is `{ AND: [guestWhere, { store: { in: granted } }] }` OR,
		// when the guest passed no where, just `{ store: { in: granted } }`.
		const find = (w: unknown): string[] | null => {
			if (!w || typeof w !== "object") return null;
			const o = w as Record<string, unknown>;
			if (Array.isArray(o.AND)) {
				for (const part of o.AND) {
					const r = find(part);
					if (r) return r;
				}
			}
			const s = o.store as { in?: unknown } | string | undefined;
			if (s && typeof s === "object" && Array.isArray((s as { in?: unknown }).in)) {
				return (s as { in: string[] }).in;
			}
			return null;
		};
		return find(where);
	}
	/** A literal `store: "x"` the guest narrowed to (under AND), if any. */
	function literalStore(where: unknown): string | undefined {
		const find = (w: unknown): string | undefined => {
			if (!w || typeof w !== "object") return undefined;
			const o = w as Record<string, unknown>;
			if (Array.isArray(o.AND)) {
				for (const part of o.AND) {
					const r = find(part);
					if (r) return r;
				}
			}
			return typeof o.store === "string" ? o.store : undefined;
		};
		return find(where);
	}

	function matches(row: DocRow, where: unknown): boolean {
		const allowed = allowedStores(where);
		if (allowed && !allowed.includes(row.store)) return false;
		const lit = literalStore(where);
		if (lit !== undefined && row.store !== lit) return false;
		return true;
	}

	return {
		rows,
		calls,
		collection: {
			async find(args: unknown, context?: unknown) {
				calls.push({ method: "find", args, context });
				const where = (args as { where?: unknown })?.where;
				return { docs: rows.filter((r) => matches(r, where)) };
			},
			async findOne(args: unknown, context?: unknown) {
				calls.push({ method: "findOne", args, context });
				const where = (args as { where?: unknown })?.where;
				return rows.find((r) => matches(r, where)) ?? null;
			},
			async create(args: unknown, context?: unknown) {
				calls.push({ method: "create", args, context });
				const row = args as Omit<DocRow, "id" | "createdAt">;
				const created: DocRow = {
					id: `d${++seq}`,
					store: row.store,
					key: row.key,
					data: row.data,
					createdByApp: row.createdByApp,
					createdAt: new Date(0).toISOString(),
				};
				rows.push(created);
				return created;
			},
			async update(args: unknown, context?: unknown) {
				calls.push({ method: "update", args, context });
				const { where, data } = args as { where: unknown; data: Record<string, unknown> };
				const hit = rows.filter((r) => matches(r, where));
				for (const r of hit) Object.assign(r, data);
				return hit;
			},
			async delete(args: unknown, context?: unknown) {
				calls.push({ method: "delete", args, context });
				const { where } = args as { where: unknown };
				const before = rows.length;
				for (let i = rows.length - 1; i >= 0; i--) {
					if (matches(rows[i]!, where)) rows.splice(i, 1);
				}
				return { success: true, count: before - rows.length };
			},
		},
	};
}

const DS = "document_store";
/** Build a run whose target wires the document_store clamp for `stores` grants. */
function wireDocStore(
	stores: Record<string, Array<"read" | "write">>,
	seed: DocRow[] = [],
	appId = APP,
) {
	const ds = makeDocumentStore(seed);
	const ctx = makeCtx({
		collections: { document_store: ds.collection },
		session: { user: { id: "user_123" } },
	});
	const caps = { data: { stores } };
	// Pass a relation resolver + a write-rule resolver; neither should affect
	// document_store (it has its own dedicated accessor).
	const target = buildMiniAppBindingTarget(
		appId,
		ctx,
		caps,
		noRelations,
		noWriteRules,
	);
	const broker = new SandboxBroker();
	const { token } = broker.mint({ capabilities: caps, target });
	return { ds, broker, token };
}

describe("G4 document_store: READ is clamped to granted-read stores", () => {
	const seed: DocRow[] = [
		{ id: "a", store: "posts", key: "p1", data: { t: 1 }, createdByApp: APP, createdAt: "x" },
		{ id: "b", store: "posts", key: "p2", data: { t: 2 }, createdByApp: APP, createdAt: "x" },
		{ id: "c", store: "secrets", key: "s1", data: { t: 9 }, createdByApp: APP, createdAt: "x" },
	];

	it("find returns ONLY rows in a granted-read store; dispatches system-mode", async () => {
		const { ds, broker, token } = wireDocStore({ posts: ["read"] }, seed);
		const res = await broker.handleRpc(token, `collections.${DS}.find`, {});
		expect(res.ok).toBe(true);
		const docs = res.ok ? (res.value as { docs: DocRow[] }).docs : [];
		expect(docs.map((d) => d.id).sort()).toEqual(["a", "b"]);
		// the `secrets` store (NOT granted) never appears.
		expect(docs.some((d) => d.store === "secrets")).toBe(false);
		// dispatched accessMode:'system' (the clamp is the authorization).
		expect((ds.calls[0]!.context as { accessMode?: string }).accessMode).toBe(
			"system",
		);
	});

	it("a guest `where` targeting an UNGRANTED store yields nothing (AND with store∈granted)", async () => {
		const { broker, token } = wireDocStore({ posts: ["read"] }, seed);
		// The guest tries to read `secrets` directly — the injected store filter ANDs
		// it down to the empty intersection.
		const res = await broker.handleRpc(token, `collections.${DS}.find`, {
			where: { store: "secrets" },
		});
		expect(res.ok).toBe(true);
		expect(res.ok && (res.value as { docs: DocRow[] }).docs).toHaveLength(0);
	});

	it("write-only grant cannot READ (no read store) — denied", async () => {
		const { ds, broker, token } = wireDocStore({ posts: ["write"] }, seed);
		const res = await broker.handleRpc(token, `collections.${DS}.find`, {});
		expect(res.ok).toBe(false);
		expect(res.ok === false && res.error.code).toBe("forbidden"); // capability gate
		expect(ds.calls).toHaveLength(0);
	});

	it("rejects relation expansion via `with` (G3 still applies to document_store)", async () => {
		const { ds, broker, token } = wireDocStore({ posts: ["read"] }, seed);
		const res = await broker.handleRpc(token, `collections.${DS}.find`, {
			with: { author: true },
		});
		expect(res.ok).toBe(false);
		expect(ds.calls).toHaveLength(0);
	});
});

describe("G4 document_store: CREATE forces store + stamps provenance + rejects spoof", () => {
	it("create into a granted-write store stamps createdByApp and drops client meta", async () => {
		const { ds, broker, token } = wireDocStore({ posts: ["write"] });
		const res = await broker.handleRpc(token, `collections.${DS}.create`, {
			store: "posts",
			key: "k1",
			data: { hello: "world" },
			// spoof attempts — all must be DROPPED:
			id: "forged-pk",
			createdAt: "1970-01-01T00:00:00.000Z",
			createdByApp: "victim-app",
		});
		expect(res.ok).toBe(true);
		expect(ds.rows).toHaveLength(1);
		const row = ds.rows[0]!;
		expect(row.store).toBe("posts");
		expect(row.key).toBe("k1");
		expect(row.data).toEqual({ hello: "world" });
		// createdByApp is STAMPED to the writing app, NOT the client value.
		expect(row.createdByApp).toBe(APP);
		expect(row.createdByApp).not.toBe("victim-app");
		// the forged id never reached the insert payload.
		const created = ds.calls.find((c) => c.method === "create")!;
		expect((created.args as Record<string, unknown>).id).toBeUndefined();
		expect((created.args as Record<string, unknown>).createdAt).toBeUndefined();
	});

	it("create into an UNGRANTED store is REJECTED (store-spoof on write)", async () => {
		const { ds, broker, token } = wireDocStore({ posts: ["write"] });
		const res = await broker.handleRpc(token, `collections.${DS}.create`, {
			store: "secrets", // not granted
			key: "k1",
			data: {},
		});
		expect(res.ok).toBe(false);
		expect(res.ok === false && res.error.code).toBe("execution_error");
		expect(ds.rows).toHaveLength(0);
	});

	it("create with NO store is rejected (cannot infer a target namespace)", async () => {
		const { ds, broker, token } = wireDocStore({ posts: ["write"] });
		const res = await broker.handleRpc(token, `collections.${DS}.create`, {
			key: "k1",
			data: {},
		});
		expect(res.ok).toBe(false);
		expect(ds.rows).toHaveLength(0);
	});
});

describe("G4 document_store: UPDATE/DELETE blast-radius containment", () => {
	function seed(): DocRow[] {
		return [
			{ id: "a", store: "posts", key: "p1", data: { v: 1 }, createdByApp: APP, createdAt: "x" },
			{ id: "b", store: "drafts", key: "d1", data: { v: 1 }, createdByApp: APP, createdAt: "x" },
			{ id: "c", store: "secrets", key: "s1", data: { v: 1 }, createdByApp: "other", createdAt: "x" },
		];
	}

	it("a broad update (empty where) only touches GRANTED-write stores", async () => {
		const { ds, broker, token } = wireDocStore({ posts: ["write"] }, seed());
		// No where at all → the clamp confines it to `{ store: { in: ["posts"] } }`.
		// The patch sets the row's jsonb `data` field.
		const res = await broker.handleRpc(token, `collections.${DS}.update`, {
			data: { data: { v: 999 } },
		});
		expect(res.ok).toBe(true);
		// ONLY the posts row changed; drafts + secrets are untouched.
		expect(ds.rows.find((r) => r.id === "a")!.data).toEqual({ v: 999 });
		expect(ds.rows.find((r) => r.id === "b")!.data).toEqual({ v: 1 });
		expect(ds.rows.find((r) => r.id === "c")!.data).toEqual({ v: 1 });
	});

	it("a broad delete (where: {}) only removes GRANTED-write store rows", async () => {
		const { ds, broker, token } = wireDocStore({ posts: ["write"] }, seed());
		const res = await broker.handleRpc(token, `collections.${DS}.delete`, {
			where: {},
		});
		expect(res.ok).toBe(true);
		// posts row gone; drafts + secrets survive (blast-radius contained).
		expect(ds.rows.map((r) => r.id).sort()).toEqual(["b", "c"]);
	});

	it("an update patch CANNOT move a row across stores or forge identity", async () => {
		const { ds, broker, token } = wireDocStore({ posts: ["write"] }, seed());
		const res = await broker.handleRpc(token, `collections.${DS}.update`, {
			where: { key: "p1" },
			data: {
				data: { v: 2 }, // the only legit field
				store: "secrets", // cross-store move attempt — STRIPPED
				id: "forged", // identity forge — STRIPPED
				createdByApp: "thief", // provenance forge — STRIPPED
			},
		});
		expect(res.ok).toBe(true);
		const row = ds.rows.find((r) => r.key === "p1")!;
		expect(row.store).toBe("posts"); // NOT moved
		expect(row.id).toBe("a"); // NOT forged
		expect(row.createdByApp).toBe(APP); // NOT forged
		expect(row.data).toEqual({ v: 2 }); // the only legit field applied
		// the protected keys were stripped from the patch BEFORE it reached the CRUD.
		const updateArg = ds.calls.find((c) => c.method === "update")!.args as {
			data: Record<string, unknown>;
		};
		expect(updateArg.data.store).toBeUndefined();
		expect(updateArg.data.id).toBeUndefined();
		expect(updateArg.data.createdByApp).toBeUndefined();
		expect(updateArg.data.data).toEqual({ v: 2 });
	});

	it("delete targeting an UNGRANTED store deletes nothing (AND store∈granted)", async () => {
		const { ds, broker, token } = wireDocStore({ posts: ["write"] }, seed());
		const res = await broker.handleRpc(token, `collections.${DS}.delete`, {
			where: { store: "secrets" }, // not granted → empty intersection
		});
		expect(res.ok).toBe(true);
		expect(res.ok && (res.value as { count: number }).count).toBe(0);
		expect(ds.rows.some((r) => r.id === "c")).toBe(true);
	});
});

describe("G4 document_store: cross-app sharing via a shared store name", () => {
	it("app B granted a shared store READS rows app A created in it", async () => {
		// App A created the row in the `invoices` store; app B (analytics) is granted
		// `invoices:["read"]` — provenance (`createdByApp:"app-a"`) does NOT gate access.
		const seed: DocRow[] = [
			{ id: "i1", store: "invoices", key: "INV-1", data: { total: 100 }, createdByApp: "app-a", createdAt: "x" },
			{ id: "x1", store: "private-b", key: "p", data: {}, createdByApp: "app-b", createdAt: "x" },
		];
		const { broker, token } = wireDocStore({ invoices: ["read"] }, seed, "app-b");
		const res = await broker.handleRpc(token, `collections.${DS}.find`, {});
		expect(res.ok).toBe(true);
		const docs = res.ok ? (res.value as { docs: DocRow[] }).docs : [];
		expect(docs.map((d) => d.id)).toEqual(["i1"]); // sees the shared invoice…
		// …and NOT app-b's own private store (not granted on this run).
		expect(docs.some((d) => d.store === "private-b")).toBe(false);
	});

	it("a non-shared store remains invisible to an app that lacks the grant", async () => {
		const seed: DocRow[] = [
			{ id: "i1", store: "invoices", key: "INV-1", data: {}, createdByApp: "app-a", createdAt: "x" },
		];
		// app-b granted a DIFFERENT store → cannot read invoices.
		const { broker, token } = wireDocStore({ other: ["read"] }, seed, "app-b");
		const res = await broker.handleRpc(token, `collections.${DS}.find`, {
			where: { store: "invoices" },
		});
		expect(res.ok).toBe(true);
		expect(res.ok && (res.value as { docs: DocRow[] }).docs).toHaveLength(0);
	});
});
