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

/** In-memory `knowledgeResource`-shaped service over an array of rows. */
function makeKnowledgeResource(seed: KnowledgeRow[] = []) {
	const rows: KnowledgeRow[] = [...seed];
	let seq = 0;
	return {
		rows,
		service: {
			async readByPath(path: string) {
				return rows.find((r) => r.path === path) ?? null;
			},
			async writeByPath(input: {
				path: string;
				body: string;
				title?: string | null;
				contentType?: string | null;
				metadata?: Record<string, unknown> | null;
			}) {
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
			async listByPrefix(prefix: string) {
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
});

// ───────────────────── G1 enforced through the real broker ──────────────────

describe("G1: broker dispatch is clamped to the tenant subtree", () => {
	/**
	 * The HOSTILE manifest: declares `knowledge.read/write:["**"]` — i.e. it tries
	 * to read+write ANY knowledge path. The HOST bound must clamp it regardless.
	 */
	const HOSTILE_CAPS = {
		knowledge: { read: ["**"], write: ["**"] },
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
		const res = await broker.handleRpc(token, "knowledge.write", {
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
		const res = await broker.handleRpc(token, "knowledge.write", {
			path: "company/apps/other/_app/manifest.json",
			body: "HOSTILE",
		});
		expect(res.ok).toBe(false);
		// nothing was written.
		expect(knowledge.rows.length).toBe(0);
	});

	it("writing company-wide secrets is REJECTED (clamped)", async () => {
		const { knowledge, broker, token } = wire();
		const res = await broker.handleRpc(token, "knowledge.write", {
			path: "company/secrets/x",
			body: "HOSTILE",
		});
		expect(res.ok).toBe(false);
		expect(knowledge.rows.length).toBe(0);
	});

	it("writing its OWN _app/ (code/manifest) is REJECTED (data-only)", async () => {
		const { knowledge, broker, token } = wire();
		const res = await broker.handleRpc(token, "knowledge.write", {
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

		const own = await broker.handleRpc(token, "knowledge.read", {
			path: `${PREFIX}data/posts.json`,
		});
		expect(own.ok).toBe(true);
		expect(own.ok && (own.value as { body: string }).body).toBe("[1,2]");

		const other = await broker.handleRpc(token, "knowledge.read", {
			path: "company/apps/other/data/secret.json",
		});
		expect(other.ok).toBe(false);
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
		const target = buildMiniAppBindingTarget(APP, ctx, caps);
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
		const target = buildMiniAppBindingTarget(APP, ctx, caps);
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
	function wire() {
		const rec = recordingCollection([{ id: "p1" }]);
		const ctx = makeCtx({ collections: { posts: rec.collection } });
		const caps = {
			data: { collections: { posts: ["read"] as Array<"read"> } },
		};
		const target = buildMiniAppBindingTarget(APP, ctx, caps);
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

	it("the target throws a typed MiniAppBindingError on relation args (unit)", async () => {
		const rec = recordingCollection([]);
		const ctx = makeCtx({ collections: { posts: rec.collection } });
		const target = buildMiniAppBindingTarget(APP, ctx);
		await expect(
			target.collections!.posts!.find!({ with: { x: true } }),
		).rejects.toBeInstanceOf(MiniAppBindingError);
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
			knowledge: { write: [`${PREFIX}data/reports/**`] },
		};
		const target = buildMiniAppBindingTarget(APP, ctx, caps);
		const broker = new SandboxBroker();
		const { token } = broker.mint({ capabilities: caps, target });

		// in-bound but not in the manifest glob → broker forbids.
		const res = await broker.handleRpc(token, "knowledge.write", {
			path: `${PREFIX}data/other.json`,
			body: "x",
		});
		expect(res.ok).toBe(false);
		expect(res.ok === false && res.error.code).toBe("forbidden");
		expect(knowledge.rows.length).toBe(0);

		// in the manifest glob AND in-bound → succeeds.
		const ok = await broker.handleRpc(token, "knowledge.write", {
			path: `${PREFIX}data/reports/q1.json`,
			body: "x",
		});
		expect(ok.ok).toBe(true);
	});
});
