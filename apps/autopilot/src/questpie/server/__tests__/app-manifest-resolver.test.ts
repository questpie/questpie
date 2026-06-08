import { Buffer } from "node:buffer";
import { createServer, type Server } from "node:http";

import { classifyIpLiteral, SandboxBroker } from "questpie/executor";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

// ──────────────────────────────────────────────────────────────────────────
// S5 — declarative per-app HTTP allowlist (manifest `net` → run scope → broker).
//
// Proves the FULL declarative chain end-to-end, purely from manifest DATA (no
// per-app code, no hardcoded host list): an inline `export const manifest`
// declares a `net` allowlist → `resolveApp` derives `capabilities.net` → the
// SAME `SandboxBroker.mint({ capabilities })` the route/cron use → `handleRpc`
// enforces it default-deny on `http.fetch`. An in-list host is permitted (it is
// dispatched through the SSRF-safe host fetch and reaches a loopback origin); an
// out-of-list host is DENIED (`forbidden`) and the host fetch never runs.
//
// This closes the gap the sibling broker test left open: `broker-http-fetch.test`
// constructs `{ net: [...] }` BY HAND, whereas here the allowlist is SOURCED from
// the declared manifest — the declarative wiring is what S5 verifies.
// ──────────────────────────────────────────────────────────────────────────
describe("S5: manifest `net` allowlist flows to the broker (declarative, end-to-end)", () => {
	// A loopback origin standing in for the allowlisted PUBLIC host. The injected
	// resolver maps the allowlisted hostnames onto it and the injected validator
	// permits 127.0.0.1 — exactly as the sibling broker test drives the OK path —
	// so the in-list call exercises the real dispatch without real DNS/network.
	let origin: Server;
	let port = 0;
	beforeAll(async () => {
		origin = createServer((_req, res) => {
			res.writeHead(200, { "content-type": "text/plain" });
			res.end("egress-ok");
		});
		await new Promise<void>((r) => origin.listen(0, "127.0.0.1", r));
		port = (origin.address() as { port: number }).port;
	});
	afterAll(() => origin.close());

	/**
	 * Seed a `.app` whose inline manifest declares the given `net` allowlist (the
	 * ONLY app-specific input — everything else is identical boilerplate).
	 */
	function seedNetApp(appId: string, net: string[] | undefined): AppResolverCollections {
		const bundle = appBundlePrefix(appId);
		const netLine =
			net === undefined
				? `    /* no net */`
				: `    net: ${JSON.stringify(net)},`;
		const server = [
			`export const manifest = {`,
			`  capabilities: {`,
			netLine,
			`  },`,
			`};`,
			`async function run(){ return 1; }`,
			`export const actions = { run };`,
		].join("\n");
		return knowledgeDouble([{ path: `${bundle}server.ts`, body: server }]);
	}

	/**
	 * Mint a per-run token from the manifest-DERIVED capabilities (the same mint
	 * the route/cron perform) with a host-fetch target that maps the allowlisted
	 * hostnames onto the loopback origin (so an in-scope call can actually return).
	 */
	function mintFromManifest(
		broker: SandboxBroker,
		capabilities: { net?: string[] },
		hostToIp: Record<string, string[]>,
	) {
		return broker.mint({
			capabilities,
			target: {
				http: {
					fetchOptions: {
						resolve: async (h: string) => {
							if (h in hostToIp) return hostToIp[h]!;
							throw new Error(`NXDOMAIN: ${h}`);
						},
						// Permit loopback ONLY for these tests (production never overrides
						// the validator → the real SSRF policy runs). A non-loopback ip
						// still goes through the real `classifyIpLiteral`.
						validateIp: (ip) =>
							ip === "127.0.0.1" ? { ok: true } : classifyIpLiteral(ip),
					},
				},
			},
		});
	}

	it("PERMITS an in-allowlist host (exact + wildcard) sourced from the manifest", async () => {
		const resolved = await resolveApp(
			"netapp",
			seedNetApp("netapp", [`api.allowed.test:${port}`, "*.allowed.test"]),
		);
		// The allowlist came from the DECLARED manifest, not hand-built caps.
		expect(resolved.capabilities.net).toEqual([
			`api.allowed.test:${port}`,
			"*.allowed.test",
		]);

		const broker = new SandboxBroker();
		const { token } = mintFromManifest(broker, resolved.capabilities, {
			"api.allowed.test": ["127.0.0.1"],
			"cdn.allowed.test": ["127.0.0.1"],
		});

		// Exact in-list host → allowed → dispatched through the SSRF host fetch → 200.
		const exact = await broker.handleRpc(token, "http.fetch", {
			url: `http://api.allowed.test:${port}/`,
		});
		expect(exact.ok).toBe(true);
		if (exact.ok) {
			const v = exact.value as { status: number; bodyBase64: string };
			expect(v.status).toBe(200);
			expect(Buffer.from(v.bodyBase64, "base64").toString()).toBe("egress-ok");
		}

		// A subdomain matched by the manifest's `*.allowed.test` wildcard → allowed.
		const wild = await broker.handleRpc(token, "http.fetch", {
			url: `http://cdn.allowed.test:${port}/`,
		});
		expect(wild.ok).toBe(true);
	});

	it("DENIES an out-of-allowlist host as `forbidden` (host fetch never runs)", async () => {
		const resolved = await resolveApp(
			"netapp2",
			seedNetApp("netapp2", ["api.allowed.test"]),
		);
		const broker = new SandboxBroker();
		// The target WOULD resolve evil.test to the loopback origin, but the manifest
		// allowlist check runs FIRST and forbids it before any fetch is attempted.
		const { token } = mintFromManifest(broker, resolved.capabilities, {
			"evil.test": ["127.0.0.1"],
		});

		const denied = await broker.handleRpc(token, "http.fetch", {
			url: "https://evil.test/steal",
		});
		expect(denied.ok).toBe(false);
		if (!denied.ok) {
			expect(denied.error.code).toBe("forbidden");
			expect(denied.error.message).toContain("not in the net allowlist");
		}
	});

	it("DEFAULT-DENY: a manifest with NO `net` axis forbids all egress", async () => {
		const resolved = await resolveApp("netapp3", seedNetApp("netapp3", undefined));
		// The manifest declared no `net` → the derived capability has none.
		expect(resolved.capabilities.net).toBeUndefined();

		const broker = new SandboxBroker();
		const { token } = mintFromManifest(broker, resolved.capabilities, {
			"api.allowed.test": ["127.0.0.1"],
		});
		const denied = await broker.handleRpc(token, "http.fetch", {
			url: "https://api.allowed.test/x",
		});
		expect(denied.ok).toBe(false);
		if (!denied.ok) expect(denied.error.code).toBe("forbidden");
	});
});
