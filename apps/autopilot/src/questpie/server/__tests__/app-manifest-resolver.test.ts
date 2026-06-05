import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
	appPathPrefix,
	AppResolutionError,
	type AppResolverCollections,
	type KnowledgeRecordLike,
	resolveApp,
} from "../apps/app-resolver";
import { scanExports } from "../apps/export-scan";
import { parseAppManifest } from "../apps/manifest";

/** In-memory Knowledge double: `find` filters seeded rows by path prefix. */
function knowledgeDouble(rows: KnowledgeRecordLike[]): AppResolverCollections {
	return {
		knowledge: {
			async find({ where }) {
				const prefix = where.path.startsWith;
				return {
					docs: rows.filter(
						(r) => typeof r.path === "string" && r.path.startsWith(prefix),
					),
				};
			},
		},
	};
}

const VALID_MANIFEST = {
	name: "Social Scheduler",
	entry: "server.ts",
	capabilities: {
		net: ["esm.sh", "api.x.com"],
		import: ["esm.sh"],
		data: {
			collections: { posts: ["read", "create", "update"], orders: ["read"] },
			globals: { settings: ["read"] },
		},
		knowledge: {
			read: ["company/apps/social/data/**"],
			write: ["company/apps/social/data/**"],
		},
		services: ["postToSocial"],
		jobs: ["sendDigest"],
		workflows: ["publishFlow"],
		timeoutMs: 15000,
		memoryMb: 128,
	},
} as const;

describe("app manifest schema", () => {
	it("parses a valid manifest (with data/services scopes) into a typed object", () => {
		const parsed = parseAppManifest(JSON.stringify(VALID_MANIFEST));

		expect(parsed.name).toBe("Social Scheduler");
		expect(parsed.entry).toBe("server.ts");
		expect(parsed.capabilities.net).toEqual(["esm.sh", "api.x.com"]);
		expect(parsed.capabilities.data?.collections?.posts).toEqual([
			"read",
			"create",
			"update",
		]);
		expect(parsed.capabilities.data?.globals?.settings).toEqual(["read"]);
		expect(parsed.capabilities.services).toEqual(["postToSocial"]);
		expect(parsed.capabilities.timeoutMs).toBe(15000);
	});

	it("accepts a minimal manifest (capabilities only, no entry/name)", () => {
		const parsed = parseAppManifest({ capabilities: {} });
		expect(parsed.capabilities).toEqual({});
		expect(parsed.entry).toBeUndefined();
	});

	it("parses an already-parsed object (not only a JSON string)", () => {
		const parsed = parseAppManifest(VALID_MANIFEST);
		expect(parsed.capabilities.jobs).toEqual(["sendDigest"]);
	});

	it("rejects a manifest missing capabilities (zod error)", () => {
		expect(() => parseAppManifest({ name: "x" })).toThrow(z.ZodError);
	});

	it("rejects an unknown data verb (zod error)", () => {
		expect(() =>
			parseAppManifest({
				capabilities: { data: { collections: { posts: ["destroy"] } } },
			}),
		).toThrow(z.ZodError);
	});

	it("rejects unknown top-level keys (strict)", () => {
		expect(() =>
			parseAppManifest({ capabilities: {}, endpoints: ["x"] }),
		).toThrow(z.ZodError);
	});

	it("rejects an entry with a parent-directory traversal segment (zod error)", () => {
		expect(() =>
			parseAppManifest({ capabilities: {}, entry: "../data/x.json" }),
		).toThrow(z.ZodError);
	});

	it("rejects an absolute entry path (zod error)", () => {
		expect(() =>
			parseAppManifest({ capabilities: {}, entry: "/etc/passwd" }),
		).toThrow(z.ZodError);
	});

	it("accepts a valid relative entry within _app/", () => {
		const parsed = parseAppManifest({
			capabilities: {},
			entry: "handlers/server.ts",
		});
		expect(parsed.entry).toBe("handlers/server.ts");
	});
});

describe("export scan", () => {
	it("detects export default and named declaration exports", () => {
		const src = [
			"export default function handler(req) { return new Response('ok'); }",
			"export const cron = () => {};",
			"export async function webhook(req) {}",
			"const internal = 1;",
		].join("\n");
		const scanned = scanExports(src);
		expect(scanned.hasDefault).toBe(true);
		expect(scanned.named.sort()).toEqual(["cron", "webhook"]);
	});

	it("detects export-clause names with renames and default-as", () => {
		const src = [
			"function a() {}",
			"function b() {}",
			"const c = 1;",
			"export { a, b as webhook, c as default };",
		].join("\n");
		const scanned = scanExports(src);
		expect(scanned.hasDefault).toBe(true);
		expect(scanned.named.sort()).toEqual(["a", "webhook"]);
	});
});

describe("resolveApp", () => {
	function seedApp(appId: string, manifest: unknown, entrySource: string) {
		const prefix = appPathPrefix(appId);
		return knowledgeDouble([
			{ path: `${prefix}_app/manifest.json`, body: JSON.stringify(manifest) },
			{ path: `${prefix}_app/server.ts`, body: entrySource },
			// Noise: a data file + an unrelated app, to prove prefix scoping.
			{ path: `${prefix}data/posts.json`, body: "[]" },
			{ path: "company/apps/other/_app/manifest.json", body: "{}" },
		]);
	}

	it("resolves capabilities + inferred endpoint/cron surface from the entry exports", async () => {
		const entry = [
			"export default function handler(req) { return new Response('ok'); }",
			"export const cron = async () => { /* nightly */ };",
			"export function webhook(req) { return new Response('hook'); }",
		].join("\n");
		const collections = seedApp("social", VALID_MANIFEST, entry);

		const resolved = await resolveApp("social", collections);

		expect(resolved.appId).toBe("social");
		expect(resolved.pathPrefix).toBe("company/apps/social/");
		expect(resolved.entryPath).toBe("company/apps/social/_app/server.ts");
		expect(resolved.capabilities.services).toEqual(["postToSocial"]);

		// `export default` => default HTTP endpoint; `webhook` => named endpoint.
		const endpointNames = resolved.endpoints.map((e) => e.name).sort();
		expect(endpointNames).toEqual(["default", "webhook"]);
		expect(resolved.endpoints.find((e) => e.name === "default")?.isDefault).toBe(
			true,
		);
		// `cron`-named export => scheduled.
		expect(resolved.crons.map((c) => c.name)).toEqual(["cron"]);
	});

	it("uses the default entry (server.ts) when the manifest omits entry", async () => {
		const collections = seedApp(
			"noentry",
			{ capabilities: {} },
			"export default () => new Response('ok');",
		);
		const resolved = await resolveApp("noentry", collections);
		expect(resolved.entryPath).toBe("company/apps/noentry/_app/server.ts");
		expect(resolved.endpoints).toEqual([{ name: "default", isDefault: true }]);
		expect(resolved.crons).toEqual([]);
	});

	it("throws AppResolutionError when the manifest is missing", async () => {
		const collections = knowledgeDouble([
			{ path: "company/apps/ghost/_app/server.ts", body: "export default 1;" },
		]);
		await expect(resolveApp("ghost", collections)).rejects.toBeInstanceOf(
			AppResolutionError,
		);
	});

	it("throws AppResolutionError when the entry is missing", async () => {
		const collections = knowledgeDouble([
			{
				path: "company/apps/noent/_app/manifest.json",
				body: JSON.stringify({ capabilities: {}, entry: "server.ts" }),
			},
		]);
		await expect(resolveApp("noent", collections)).rejects.toBeInstanceOf(
			AppResolutionError,
		);
	});

	it("propagates a zod error for an invalid manifest in the tree", async () => {
		const collections = knowledgeDouble([
			{ path: "company/apps/bad/_app/manifest.json", body: "{}" },
			{ path: "company/apps/bad/_app/server.ts", body: "export default 1;" },
		]);
		await expect(resolveApp("bad", collections)).rejects.toBeInstanceOf(
			z.ZodError,
		);
	});

	it("rejects an appId containing a path separator", async () => {
		await expect(
			resolveApp("a/b", knowledgeDouble([])),
		).rejects.toBeInstanceOf(AppResolutionError);
	});

	it("rejects an appId with a parent-directory traversal segment", async () => {
		await expect(
			resolveApp("../foo", knowledgeDouble([])),
		).rejects.toBeInstanceOf(AppResolutionError);
	});

	it("rejects an appId that is a bare current-directory segment", async () => {
		await expect(
			resolveApp(".", knowledgeDouble([])),
		).rejects.toBeInstanceOf(AppResolutionError);
	});
});
