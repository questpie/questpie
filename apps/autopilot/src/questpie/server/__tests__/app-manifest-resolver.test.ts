import { describe, expect, it } from "vitest";
import { z } from "zod";

import { scanServerModule } from "../apps/actions-scan";
import {
	appBundlePrefix,
	appDataPrefix,
	AppResolutionError,
	type AppResolverCollections,
	type KnowledgeRecordLike,
	RESERVED_ACTION_NAMES,
	resolveApp,
} from "../apps/app-resolver";
import { scanExports } from "../apps/export-scan";
import {
	InlineManifestError,
	parseAppManifest,
	parseInlineManifest,
} from "../apps/manifest";

/** In-memory `assets` double: `find` filters seeded rows by path prefix. */
function knowledgeDouble(rows: KnowledgeRecordLike[]): AppResolverCollections {
	return {
		assets: {
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

/**
 * A canonical valid `.app` `server.ts`: an inline `manifest`, an opt-in `actions`
 * registry (`status`, `listPosts`), a `defineAction` with an input schema, a cron
 * export, and a non-registered internal helper.
 */
function validServer(appId: string): string {
	const bundle = appBundlePrefix(appId);
	const data = appDataPrefix(appId);
	return [
		`import { defineAction } from "questpie/miniapp";`,
		`import { z } from "zod";`,
		`export const manifest = {`,
		`  name: "Social Scheduler",`,
		`  capabilities: {`,
		`    net: ["esm.sh", "api.x.com"],`,
		`    import: ["esm.sh"],`,
		`    data: { collections: { posts: ["read", "create", "update"], orders: ["read"] }, globals: { settings: ["read"] } },`,
		`    files: { read: ["${bundle}**", "${data}**"], write: ["${data}**"] },`,
		`    services: ["postToSocial"], jobs: ["sendDigest"], workflows: ["publishFlow"],`,
		`    timeoutMs: 15000, memoryMb: 128,`,
		`  },`,
		`};`,
		`const status = defineAction({ input: z.object({ text: z.string() }), handler: async () => ({ ok: true }) });`,
		`const listPosts = defineAction({ handler: async () => ({ posts: [] }) });`,
		`function internalHelper() { return 1; }`,
		`export const cron = async () => { /* nightly */ };`,
		`export const actions = { status, listPosts };`,
	].join("\n");
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
		files: {
			read: ["company/apps/social.app/**", "company/apps/social/data/**"],
			write: ["company/apps/social/data/**"],
		},
		services: ["postToSocial"],
		jobs: ["sendDigest"],
		workflows: ["publishFlow"],
		timeoutMs: 15000,
		memoryMb: 128,
	},
} as const;

describe("app manifest schema (legacy JSON path)", () => {
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
		expect(parsed.capabilities.services).toEqual(["postToSocial"]);
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
});

describe("parseInlineManifest (the v2 inline source path)", () => {
	it("extracts + validates an inline `export const manifest` object literal", () => {
		const manifest = parseInlineManifest(validServer("social"));
		expect(manifest.name).toBe("Social Scheduler");
		expect(manifest.capabilities.net).toEqual(["esm.sh", "api.x.com"]);
		expect(manifest.capabilities.data?.collections?.posts).toEqual([
			"read",
			"create",
			"update",
		]);
		expect(manifest.capabilities.timeoutMs).toBe(15000);
	});

	it("accepts a minimal inline manifest (capabilities only)", () => {
		const manifest = parseInlineManifest(
			`export const manifest = { capabilities: {} }; export const actions = {};`,
		);
		expect(manifest.capabilities).toEqual({});
	});

	it("throws InlineManifestError when there is no `export const manifest`", () => {
		expect(() =>
			parseInlineManifest(`export const actions = {};`),
		).toThrow(InlineManifestError);
	});

	it("throws InlineManifestError when manifest is not an object literal", () => {
		expect(() =>
			parseInlineManifest(`export const manifest = buildManifest();`),
		).toThrow(InlineManifestError);
	});

	it("rejects a non-literal value inside the manifest (no eval, fail closed)", () => {
		expect(() =>
			parseInlineManifest(
				`const hosts = ["a.com"]; export const manifest = { capabilities: { net: hosts } };`,
			),
		).toThrow(InlineManifestError);
	});

	it("rejects a prototype-pollution key in the manifest literal", () => {
		expect(() =>
			parseInlineManifest(
				`export const manifest = { "__proto__": { polluted: 1 }, capabilities: {} };`,
			),
		).toThrow(InlineManifestError);
	});

	it("propagates a zod error for a structurally-invalid inline manifest", () => {
		expect(() =>
			parseInlineManifest(
				`export const manifest = { capabilities: { data: { collections: { p: ["destroy"] } } } };`,
			),
		).toThrow(z.ZodError);
	});
});

describe("scanServerModule (static AST actions registry)", () => {
	it("reads the opt-in actions keys + the defineAction input-schema signal", () => {
		const scanned = scanServerModule(validServer("social"));
		expect(scanned.hasManifestExport).toBe(true);
		expect(scanned.hasActionsExport).toBe(true);
		expect(scanned.actionsIsLiteral).toBe(true);
		expect(scanned.actionKeys.sort()).toEqual(["listPosts", "status"]);
		// `status` was declared with an input schema; `listPosts` was not.
		expect(scanned.defineActionInputByVar.status).toBe(true);
		expect(scanned.defineActionInputByVar.listPosts).toBe(false);
	});

	it("reads string-literal keys and flags spread/computed (fail-closed signals)", () => {
		const spread = scanServerModule(`export const actions = { ...base, a };`);
		expect(spread.hadSpread).toBe(true);
		const computed = scanServerModule(
			`const k = "x"; export const actions = { [k]: a };`,
		);
		expect(computed.hadComputed).toBe(true);
		const literal = scanServerModule(`export const actions = { "with-dash": a };`);
		expect(literal.actionKeys).toEqual(["with-dash"]);
	});

	it("flags a non-object-literal `actions` (not statically knowable)", () => {
		const scanned = scanServerModule(`export const actions = makeActions();`);
		expect(scanned.hasActionsExport).toBe(true);
		expect(scanned.actionsIsLiteral).toBe(false);
	});

	it("detects export default (reserved — never an HTTP action)", () => {
		const scanned = scanServerModule(
			`export default function(){}; export const actions = {};`,
		);
		expect(scanned.hasDefault).toBe(true);
	});
});

describe("resolveApp (the .app bundle + inline manifest + opt-in actions)", () => {
	function seedApp(appId: string, server: string) {
		const bundle = appBundlePrefix(appId);
		const data = appDataPrefix(appId);
		return knowledgeDouble([
			{ path: `${bundle}server.ts`, body: server },
			{ path: `${bundle}index.html`, body: "<!doctype html>" },
			// Noise: writable data + an unrelated app, to prove prefix scoping.
			{ path: `${data}queue.json`, body: "[]" },
			{ path: "company/apps/other.app/server.ts", body: "export const manifest={capabilities:{}}; export const actions={};" },
		]);
	}

	it("resolves caps + the opt-in action surface + cron from the inline source", async () => {
		const resolved = await resolveApp("social", seedApp("social", validServer("social")));

		expect(resolved.appId).toBe("social");
		expect(resolved.pathPrefix).toBe("company/apps/social.app/");
		expect(resolved.entryPath).toBe("company/apps/social.app/server.ts");
		expect(resolved.capabilities.services).toEqual(["postToSocial"]);

		// The HTTP surface is ONLY the opt-in registry keys (NOT every export).
		const actionNames = resolved.endpoints.map((e) => e.name).sort();
		expect(actionNames).toEqual(["listPosts", "status"]);
		// `default` is never exposed; `internalHelper`/`cron` are NOT actions.
		expect(actionNames).not.toContain("default");
		expect(actionNames).not.toContain("internalHelper");
		expect(actionNames).not.toContain("cron");
		// the input-schema signal is carried through.
		expect(resolved.endpoints.find((e) => e.name === "status")?.hasInputSchema).toBe(true);
		// cron is inferred by name.
		expect(resolved.crons.map((c) => c.name)).toEqual(["cron"]);
	});

	it("a non-registered exported function is NOT in the HTTP surface", async () => {
		const server = [
			`export const manifest = { capabilities: {} };`,
			`export function notRegistered() { return 1; }`,
			`const ping = () => ({ pong: true });`,
			`export const actions = { ping };`,
		].join("\n");
		const resolved = await resolveApp("app1", seedApp("app1", server));
		expect(resolved.endpoints.map((e) => e.name)).toEqual(["ping"]);
		expect(resolved.endpoints.map((e) => e.name)).not.toContain("notRegistered");
	});

	it("FAILS CLOSED: a reserved name in the actions registry is rejected", async () => {
		for (const reserved of [...RESERVED_ACTION_NAMES]) {
			const server = [
				`export const manifest = { capabilities: {} };`,
				`const h = () => ({});`,
				`export const actions = { "${reserved}": h };`,
			].join("\n");
			await expect(
				resolveApp("rsv", seedApp("rsv", server)),
			).rejects.toBeInstanceOf(AppResolutionError);
		}
	});

	it("FAILS CLOSED: a spread in the actions registry is rejected", async () => {
		const server = [
			`export const manifest = { capabilities: {} };`,
			`export const actions = { ...stolen, a };`,
		].join("\n");
		await expect(
			resolveApp("spr", seedApp("spr", server)),
		).rejects.toBeInstanceOf(AppResolutionError);
	});

	it("FAILS CLOSED: a non-literal actions value is rejected", async () => {
		const server = [
			`export const manifest = { capabilities: {} };`,
			`export const actions = buildActions();`,
		].join("\n");
		await expect(
			resolveApp("dyn", seedApp("dyn", server)),
		).rejects.toBeInstanceOf(AppResolutionError);
	});

	it("FAILS CLOSED: a computed action key is rejected", async () => {
		const server = [
			`export const manifest = { capabilities: {} };`,
			`const k = "ping"; const h = () => ({});`,
			`export const actions = { [k]: h };`,
		].join("\n");
		await expect(
			resolveApp("cmp", seedApp("cmp", server)),
		).rejects.toBeInstanceOf(AppResolutionError);
	});

	it("FAILS CLOSED: a name that is BOTH an action and a cron export is rejected", async () => {
		const server = [
			`export const manifest = { capabilities: {} };`,
			`export const cronJob = async () => {};`,
			`export const actions = { cronJob };`,
		].join("\n");
		await expect(
			resolveApp("dual", seedApp("dual", server)),
		).rejects.toBeInstanceOf(AppResolutionError);
	});

	it("throws AppResolutionError when there is no `.app` bundle", async () => {
		await expect(
			resolveApp("ghost", knowledgeDouble([])),
		).rejects.toBeInstanceOf(AppResolutionError);
	});

	it("throws AppResolutionError when the bundle has no server.ts", async () => {
		const collections = knowledgeDouble([
			{ path: "company/apps/noentry.app/index.html", body: "<!doctype html>" },
		]);
		await expect(resolveApp("noentry", collections)).rejects.toBeInstanceOf(
			AppResolutionError,
		);
	});

	it("throws AppResolutionError when the actions registry is absent entirely", async () => {
		const server = `export const manifest = { capabilities: {} };`;
		await expect(
			resolveApp("noact", seedApp("noact", server)),
		).rejects.toBeInstanceOf(AppResolutionError);
	});

	it("throws InlineManifestError when the server has no inline manifest", async () => {
		const server = `export const actions = {};`;
		await expect(
			resolveApp("nomani", seedApp("nomani", server)),
		).rejects.toBeInstanceOf(InlineManifestError);
	});

	it("propagates a zod error for a structurally-invalid inline manifest", async () => {
		const server = [
			`export const manifest = { capabilities: { data: { collections: { p: ["destroy"] } } } };`,
			`export const actions = {};`,
		].join("\n");
		await expect(
			resolveApp("badmani", seedApp("badmani", server)),
		).rejects.toBeInstanceOf(z.ZodError);
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

	it("honors a manifest `entry` override within the bundle", async () => {
		const appId = "ovr";
		const bundle = appBundlePrefix(appId);
		const server = [
			`export const manifest = { entry: "handlers/main.ts", capabilities: {} };`,
			`const ping = () => ({});`,
			`export const actions = { ping };`,
		].join("\n");
		// Both server.ts (the manifest source) AND the override carry the same
		// inline manifest + actions (the resolver re-extracts from the override).
		const collections = knowledgeDouble([
			{ path: `${bundle}server.ts`, body: server },
			{ path: `${bundle}handlers/main.ts`, body: server },
		]);
		const resolved = await resolveApp(appId, collections);
		expect(resolved.entryPath).toBe(`${bundle}handlers/main.ts`);
		expect(resolved.endpoints.map((e) => e.name)).toEqual(["ping"]);
	});
});

// The export classifier still drives CRON inference by name (HTTP is opt-in).
describe("export scan (cron classifier source)", () => {
	it("still detects named declaration exports for cron inference", () => {
		const src = [
			"export const cron = () => {};",
			"export async function cronDigest(req) {}",
			"const internal = 1;",
		].join("\n");
		const scanned = scanExports(src);
		expect(scanned.named.sort()).toEqual(["cron", "cronDigest"]);
	});
});
