import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import appFsRoute from "../routes/apps/[appId]/fs/[...path]";
import {
	appDataPrefix,
	assertValidAppId,
	decodeStoredBody,
	encodeBodyForStorage,
	isTextContentType,
	resolveAppDataPath,
} from "../apps/app-fs";

// ---------------------------------------------------------------------------
// In-memory Knowledge double + a `knowledgeResource`-shaped service wrapper.
// Mirrors the real service's by-path methods against an array of rows so the
// route handler can be driven without booting the app.
// ---------------------------------------------------------------------------

interface Row {
	id: string;
	path: string;
	title: string | null;
	body: string;
	contentType: string | null;
	metadata: Record<string, unknown> | null;
}

function makeKnowledge() {
	const rows: Row[] = [];
	let seq = 0;
	const knowledge = {
		async findOne({ where }: { where: { path?: string } }) {
			return rows.find((r) => r.path === where.path) ?? null;
		},
		async find({
			where,
		}: {
			where: { path?: { startsWith?: string } };
			limit?: number;
			orderBy?: unknown;
		}) {
			const prefix = where.path?.startsWith ?? "";
			const docs = rows
				.filter((r) => r.path.startsWith(prefix))
				.sort((a, b) => a.path.localeCompare(b.path));
			return { docs };
		},
		async create(data: Partial<Row>) {
			const row: Row = {
				id: `k${++seq}`,
				path: data.path ?? "",
				title: data.title ?? null,
				body: data.body ?? "",
				contentType: data.contentType ?? null,
				metadata: (data.metadata as Record<string, unknown>) ?? null,
			};
			rows.push(row);
			return row;
		},
		async updateById({ id, data }: { id: string; data: Partial<Row> }) {
			const row = rows.find((r) => r.id === id);
			if (!row) throw new Error(`no row ${id}`);
			Object.assign(row, {
				path: data.path ?? row.path,
				title: data.title ?? row.title,
				body: data.body ?? row.body,
				contentType: data.contentType ?? row.contentType,
				metadata: (data.metadata as Record<string, unknown>) ?? row.metadata,
			});
			return row;
		},
	};
	return { rows, knowledge };
}

/** Build the `knowledgeResource` service surface over the knowledge double. */
function makeKnowledgeResource(knowledge: ReturnType<typeof makeKnowledge>["knowledge"]) {
	return {
		async readByPath(path: string) {
			const r = await knowledge.findOne({ where: { path } });
			if (!r) return null;
			return {
				id: r.id,
				path: r.path,
				title: r.title,
				body: r.body,
				contentType: r.contentType,
				metadata: r.metadata,
			};
		},
		async writeByPath(input: {
			path: string;
			body: string;
			contentType?: string | null;
			metadata?: Record<string, unknown> | null;
			title?: string | null;
		}) {
			const existing = await knowledge.findOne({ where: { path: input.path } });
			const data = {
				path: input.path,
				title: input.title ?? input.path.split("/").at(-1) ?? input.path,
				body: input.body,
				contentType: input.contentType ?? null,
				metadata: input.metadata ?? null,
			};
			const saved = existing
				? await knowledge.updateById({ id: existing.id, data })
				: await knowledge.create(data);
			return {
				id: saved.id,
				path: saved.path,
				title: saved.title,
				body: saved.body,
				contentType: saved.contentType,
				metadata: saved.metadata,
			};
		},
		async listByPrefix(prefix: string) {
			const { docs } = await knowledge.find({
				where: { path: { startsWith: prefix } },
			});
			return docs.map((d) => ({
				path: d.path,
				title: d.title,
				contentType: d.contentType,
			}));
		},
	};
}

/** Invoke the raw fs route handler with a synthetic ctx. */
function callRoute(
	knowledgeResource: ReturnType<typeof makeKnowledgeResource>,
	method: "GET" | "PUT",
	appId: string,
	path: string,
	opts: { body?: BodyInit; contentType?: string; query?: string } = {},
): Promise<Response> {
	const url = `https://app.test/api/apps/${appId}/fs/${path}${opts.query ?? ""}`;
	const headers: Record<string, string> = {};
	if (opts.contentType) headers["content-type"] = opts.contentType;
	const request = new Request(url, {
		method,
		headers,
		...(method === "PUT" ? { body: opts.body ?? "" } : {}),
	});
	const ctx = {
		services: { knowledgeResource },
		request,
		params: { appId, path },
	};
	// `appFsRoute` is a RawRouteDefinition; call its handler directly.
	return (appFsRoute as { handler: (c: unknown) => Promise<Response> }).handler(
		ctx,
	);
}

// ---------------------------------------------------------------------------
// Scope / path helpers (security core)
// ---------------------------------------------------------------------------

describe("app-fs scope enforcement", () => {
	it("builds the per-app data prefix", () => {
		expect(appDataPrefix("social")).toBe("company/apps/social/data/");
	});

	it("resolves a normal relative file path under the app data dir", () => {
		expect(resolveAppDataPath("social", "posts/draft.json")).toBe(
			"company/apps/social/data/posts/draft.json",
		);
	});

	it("treats an empty / dot relative path as the data root", () => {
		expect(resolveAppDataPath("social", "")).toBe("company/apps/social/data/");
		expect(resolveAppDataPath("social", ".")).toBe("company/apps/social/data/");
	});

	it("collapses redundant slashes", () => {
		expect(resolveAppDataPath("social", "a//b/c.csv")).toBe(
			"company/apps/social/data/a/b/c.csv",
		);
	});

	it.each([
		["../../other/x", "parent traversal out of data"],
		["../secret.json", "single parent traversal"],
		["..", "bare parent"],
		["a/../../escape", "mid-path escape above data"],
		["/etc/passwd", "absolute path re-rooted but harmless"],
	])("rejects scope-escaping path %j (%s)", (bad) => {
		// `/etc/passwd` is re-rooted under data/ (leading slash stripped) and is
		// therefore NOT a real escape — assert it stays scoped instead.
		if (bad === "/etc/passwd") {
			expect(resolveAppDataPath("social", bad)).toBe(
				"company/apps/social/data/etc/passwd",
			);
			return;
		}
		expect(() => resolveAppDataPath("social", bad)).toThrow();
	});

	it.each(["a/b", "..", ".", ""])(
		"rejects an invalid appId %j",
		(appId) => {
			expect(() => assertValidAppId(appId)).toThrow();
		},
	);
});

describe("app-fs format-agnostic encoding", () => {
	it("stores text content-types verbatim as utf8", () => {
		const enc = encodeBodyForStorage(
			new TextEncoder().encode("a,b,c\n1,2,3"),
			"text/csv",
		);
		expect(enc.encoding).toBe("utf8");
		expect(enc.body).toBe("a,b,c\n1,2,3");
	});

	it("base64-encodes binary content-types", () => {
		const bytes = new Uint8Array([0, 1, 2, 255, 254]);
		const enc = encodeBodyForStorage(bytes, "application/octet-stream");
		expect(enc.encoding).toBe("base64");
		expect(Buffer.from(enc.body, "base64")).toEqual(Buffer.from(bytes));
	});

	it("round-trips bytes through encode → decode for binary", () => {
		const bytes = new Uint8Array([10, 20, 0, 200, 5]);
		const enc = encodeBodyForStorage(bytes, "image/png");
		const decoded = decodeStoredBody(enc.body, { encoding: enc.encoding });
		expect(Buffer.from(decoded)).toEqual(Buffer.from(bytes));
	});

	it("classifies common formats correctly", () => {
		for (const ct of ["text/plain", "application/json", "text/csv", "image/svg+xml"]) {
			expect(isTextContentType(ct)).toBe(true);
		}
		for (const ct of ["application/octet-stream", "image/png", "application/zip"]) {
			expect(isTextContentType(ct)).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// Full route handler — round-trips, listing, scope rejection, cross-app.
// ---------------------------------------------------------------------------

describe("app-fs route handler", () => {
	function setup() {
		const { rows, knowledge } = makeKnowledge();
		const knowledgeResource = makeKnowledgeResource(knowledge);
		return { rows, knowledgeResource };
	}

	it("round-trips a CSV file (bytes + content-type) via PUT then GET", async () => {
		const { knowledgeResource } = setup();
		const csv = "name,score\nada,99\ngrace,100\n";

		const put = await callRoute(knowledgeResource, "PUT", "social", "scores.csv", {
			body: csv,
			contentType: "text/csv",
		});
		expect(put.status).toBe(201);

		const get = await callRoute(knowledgeResource, "GET", "social", "scores.csv");
		expect(get.status).toBe(200);
		expect(get.headers.get("content-type")).toBe("text/csv");
		expect(await get.text()).toBe(csv);
	});

	it("round-trips an arbitrary binary blob byte-for-byte", async () => {
		const { knowledgeResource } = setup();
		const blob = new Uint8Array([0, 1, 2, 3, 250, 255, 128, 64, 0, 7]);

		const put = await callRoute(knowledgeResource, "PUT", "social", "blob.bin", {
			body: blob,
			contentType: "application/octet-stream",
		});
		expect(put.status).toBe(201);

		const get = await callRoute(knowledgeResource, "GET", "social", "blob.bin");
		expect(get.headers.get("content-type")).toBe("application/octet-stream");
		const got = new Uint8Array(await get.arrayBuffer());
		expect(Array.from(got)).toEqual(Array.from(blob));
	});

	it("stores under the scoped app data path", async () => {
		const { rows, knowledgeResource } = setup();
		await callRoute(knowledgeResource, "PUT", "social", "a/b.json", {
			body: "{}",
			contentType: "application/json",
		});
		expect(rows[0]?.path).toBe("company/apps/social/data/a/b.json");
	});

	it("overwrites on a second PUT (no duplicate rows)", async () => {
		const { rows, knowledgeResource } = setup();
		await callRoute(knowledgeResource, "PUT", "social", "x.txt", {
			body: "one",
			contentType: "text/plain",
		});
		await callRoute(knowledgeResource, "PUT", "social", "x.txt", {
			body: "two",
			contentType: "text/plain",
		});
		expect(rows).toHaveLength(1);
		const get = await callRoute(knowledgeResource, "GET", "social", "x.txt");
		expect(await get.text()).toBe("two");
	});

	it("lists directory entries (?list and dir path)", async () => {
		const { knowledgeResource } = setup();
		await callRoute(knowledgeResource, "PUT", "social", "posts/a.json", {
			body: "1",
			contentType: "application/json",
		});
		await callRoute(knowledgeResource, "PUT", "social", "posts/b.json", {
			body: "2",
			contentType: "application/json",
		});
		await callRoute(knowledgeResource, "PUT", "social", "other.txt", {
			body: "z",
			contentType: "text/plain",
		});

		const listed = await callRoute(knowledgeResource, "GET", "social", "posts", {
			query: "?list",
		});
		const body = (await listed.json()) as {
			prefix: string;
			entries: { path: string }[];
		};
		expect(body.prefix).toBe("company/apps/social/data/posts/");
		expect(body.entries.map((e) => e.path).sort()).toEqual([
			"company/apps/social/data/posts/a.json",
			"company/apps/social/data/posts/b.json",
		]);
	});

	it("lists a directory on a bare GET (no ?list, no trailing slash)", async () => {
		const { knowledgeResource } = setup();
		await callRoute(knowledgeResource, "PUT", "social", "posts/a.json", {
			body: "1",
			contentType: "application/json",
		});
		const listed = await callRoute(knowledgeResource, "GET", "social", "posts");
		const body = (await listed.json()) as {
			prefix: string;
			entries: { path: string }[];
		};
		expect(body.prefix).toBe("company/apps/social/data/posts/");
		expect(body.entries.map((e) => e.path)).toEqual([
			"company/apps/social/data/posts/a.json",
		]);
	});

	it("lists the whole data root when path is empty", async () => {
		const { knowledgeResource } = setup();
		await callRoute(knowledgeResource, "PUT", "social", "root.json", {
			body: "1",
			contentType: "application/json",
		});
		const listed = await callRoute(knowledgeResource, "GET", "social", "");
		const body = (await listed.json()) as { entries: { path: string }[] };
		expect(body.entries.map((e) => e.path)).toEqual([
			"company/apps/social/data/root.json",
		]);
	});

	it("returns 404 for a missing file", async () => {
		const { knowledgeResource } = setup();
		await expect(
			callRoute(knowledgeResource, "GET", "social", "nope.json"),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects a scope-escaping GET (../../other/x)", async () => {
		const { knowledgeResource } = setup();
		await expect(
			callRoute(knowledgeResource, "GET", "social", "../../other/x"),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("rejects a scope-escaping PUT (../escape)", async () => {
		const { knowledgeResource } = setup();
		await expect(
			callRoute(knowledgeResource, "PUT", "social", "../escape", {
				body: "x",
				contentType: "text/plain",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("rejects an invalid appId in the route", async () => {
		const { knowledgeResource } = setup();
		await expect(
			callRoute(knowledgeResource, "GET", "..", "x.json"),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("denies cross-app reads: app B cannot see app A's data", async () => {
		const { knowledgeResource } = setup();
		// App A writes a file.
		await callRoute(knowledgeResource, "PUT", "appA", "secret.json", {
			body: '{"k":1}',
			contentType: "application/json",
		});
		// App B at the same relative path sees nothing (different scoped prefix).
		await expect(
			callRoute(knowledgeResource, "GET", "appB", "secret.json"),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		// And app B's listing of its own data root is empty.
		const listed = await callRoute(knowledgeResource, "GET", "appB", "");
		const body = (await listed.json()) as { entries: unknown[] };
		expect(body.entries).toEqual([]);
	});
});
