/**
 * Tests: codegen file discovery
 *
 * Covers:
 * 1. `kebabToCamelCase` — key derivation
 * 2. `detectExportType` — export detection from file content
 * 3. `discoverFiles` — full filesystem scanning with fixture dirs
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	detectExportType,
	discoverFiles,
	kebabToCamelCase,
} from "../../src/cli/codegen/discover.js";

// ─────────────────────────────────────────────────────────────────────────────
// kebabToCamelCase
// ─────────────────────────────────────────────────────────────────────────────

describe("kebabToCamelCase", () => {
	it("strips .ts extension and keeps simple names unchanged", () => {
		expect(kebabToCamelCase("posts.ts")).toBe("posts");
		expect(kebabToCamelCase("users.ts")).toBe("users");
	});

	it("converts kebab-case to camelCase", () => {
		expect(kebabToCamelCase("send-newsletter.ts")).toBe("sendNewsletter");
		expect(kebabToCamelCase("site-settings.ts")).toBe("siteSettings");
		expect(kebabToCamelCase("get-active-barbers.ts")).toBe("getActiveBarbers");
		expect(kebabToCamelCase("blog-posts.ts")).toBe("blogPosts");
	});

	it("handles multiple consecutive dashes", () => {
		expect(kebabToCamelCase("a-b-c.ts")).toBe("aBC");
	});

	it("strips various extensions", () => {
		expect(kebabToCamelCase("posts.tsx")).toBe("posts");
		expect(kebabToCamelCase("posts.mts")).toBe("posts");
		expect(kebabToCamelCase("posts.js")).toBe("posts");
		expect(kebabToCamelCase("posts.jsx")).toBe("posts");
	});

	it("handles digits after dashes", () => {
		expect(kebabToCamelCase("001-init.ts")).toBe("001Init");
		expect(kebabToCamelCase("20240101-add-users.ts")).toBe("20240101AddUsers");
	});

	it("leaves names with no dashes unchanged (minus extension)", () => {
		expect(kebabToCamelCase("auth.ts")).toBe("auth");
		expect(kebabToCamelCase("modules.ts")).toBe("modules");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// detectExportType
// ─────────────────────────────────────────────────────────────────────────────

describe("detectExportType", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "questpie-detect-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	async function writeFixture(name: string, content: string): Promise<string> {
		const path = join(tmpDir, name);
		await writeFile(path, content, "utf-8");
		return path;
	}

	it("detects 'export default function'", async () => {
		const path = await writeFixture("a.ts", "export default function foo() {}");
		expect(await detectExportType(path)).toEqual({ type: "default" });
	});

	it("detects 'export default class'", async () => {
		const path = await writeFixture("a.ts", "export default class Foo {}");
		expect(await detectExportType(path)).toEqual({ type: "default" });
	});

	it("detects 'export default const/value'", async () => {
		const path = await writeFixture("a.ts", "const x = {};\nexport default x;");
		expect(await detectExportType(path)).toEqual({ type: "default" });
	});

	it("detects 're-export as default: export { X as default }'", async () => {
		const path = await writeFixture(
			"a.ts",
			"import { X } from './x';\nexport { X as default };",
		);
		expect(await detectExportType(path)).toEqual({ type: "default" });
	});

	it("detects named 'export const'", async () => {
		const path = await writeFixture("a.ts", "export const posts = collection('posts');");
		const result = await detectExportType(path);
		expect(result.type).toBe("named");
		expect(result.namedExportName).toBe("posts");
	});

	it("detects named 'export function'", async () => {
		const path = await writeFixture("a.ts", "export function getUsers() {}");
		const result = await detectExportType(path);
		expect(result.type).toBe("named");
		expect(result.namedExportName).toBe("getUsers");
	});

	it("detects named 'export class'", async () => {
		const path = await writeFixture("a.ts", "export class MyService {}");
		const result = await detectExportType(path);
		expect(result.type).toBe("named");
		expect(result.namedExportName).toBe("MyService");
	});

	it("detects named re-export: 'export { foo }'", async () => {
		const path = await writeFixture("a.ts", "import { foo } from './foo';\nexport { foo };");
		const result = await detectExportType(path);
		expect(result.type).toBe("named");
		expect(result.namedExportName).toBe("foo");
	});

	it("returns 'unknown' for files with no exports", async () => {
		const path = await writeFixture("a.ts", "const x = 1; // no export");
		expect(await detectExportType(path)).toEqual({ type: "unknown" });
	});

	it("returns 'unknown' for non-existent files", async () => {
		const result = await detectExportType(join(tmpDir, "does-not-exist.ts"));
		expect(result).toEqual({ type: "unknown" });
	});

	it("prefers default over named when both present", async () => {
		const path = await writeFixture(
			"a.ts",
			"export const foo = 1;\nexport default foo;",
		);
		// default export check happens first
		expect(await detectExportType(path)).toEqual({ type: "default" });
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// discoverFiles — fixture-based
// ─────────────────────────────────────────────────────────────────────────────

describe("discoverFiles", () => {
	let rootDir: string;
	let outDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "questpie-root-"));
		outDir = join(rootDir, ".generated");
		await mkdir(outDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});

	async function write(relPath: string, content = "export default {};"): Promise<void> {
		const full = join(rootDir, relPath);
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, content, "utf-8");
	}

	// ── Empty project ──────────────────────────────────────────────────────────

	it("returns empty maps for an empty directory", async () => {
		const result = await discoverFiles(rootDir, outDir);
		expect(result.collections.size).toBe(0);
		expect(result.globals.size).toBe(0);
		expect(result.jobs.size).toBe(0);
		expect(result.functions.size).toBe(0);
		expect(result.routes.size).toBe(0);
		expect(result.messages.size).toBe(0);
		expect(result.services.size).toBe(0);
		expect(result.emails.size).toBe(0);
		expect(result.migrations.size).toBe(0);
		expect(result.seeds.size).toBe(0);
		expect(result.auth).toBeNull();
		expect(result.singles.size).toBe(0);
		expect(result.custom.size).toBe(0);
	});

	// ── Collections ───────────────────────────────────────────────────────────

	it("discovers collections with camelCase keys", async () => {
		await write("collections/posts.ts", "export const posts = {};");
		await write("collections/blog-posts.ts", "export const blogPosts = {};");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.collections.size).toBe(2);
		expect(result.collections.has("posts")).toBe(true);
		expect(result.collections.has("blogPosts")).toBe(true);
	});

	it("sets correct varName and importPath for collections", async () => {
		await write("collections/posts.ts", "export const posts = {};");

		const result = await discoverFiles(rootDir, outDir);
		const file = result.collections.get("posts")!;
		expect(file.varName).toBe("_coll_posts");
		expect(file.importPath).toBe("../collections/posts");
		expect(file.exportType).toBe("named");
		expect(file.namedExportName).toBe("posts");
	});

	it("ignores index.ts in collections", async () => {
		await write("collections/index.ts", "export * from './posts';");
		await write("collections/posts.ts", "export const posts = {};");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.collections.size).toBe(1);
		expect(result.collections.has("posts")).toBe(true);
	});

	it("ignores private files starting with _ in collections", async () => {
		await write("collections/_utils.ts", "export const util = {};");
		await write("collections/posts.ts", "export const posts = {};");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.collections.size).toBe(1);
		expect(result.collections.has("posts")).toBe(true);
	});

	// ── Globals ───────────────────────────────────────────────────────────────

	it("discovers globals", async () => {
		await write("globals/site-settings.ts", "export const siteSettings = {};");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.globals.size).toBe(1);
		const file = result.globals.get("siteSettings")!;
		expect(file.varName).toBe("_glob_siteSettings");
	});

	// ── Jobs ──────────────────────────────────────────────────────────────────

	it("discovers jobs", async () => {
		await write("jobs/send-emails.ts");
		await write("jobs/cleanup.ts");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.jobs.size).toBe(2);
		expect(result.jobs.has("sendEmails")).toBe(true);
		expect(result.jobs.has("cleanup")).toBe(true);
	});

	// ── Functions (recursive) ─────────────────────────────────────────────────

	it("discovers flat functions with simple keys", async () => {
		await write("functions/get-users.ts");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.functions.has("getUsers")).toBe(true);
	});

	it("discovers nested functions with dot-separated keys", async () => {
		await write("functions/admin/get-stats.ts");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.functions.has("admin.getStats")).toBe(true);

		const file = result.functions.get("admin.getStats")!;
		// varName replaces dots with underscores
		expect(file.varName).toBe("_fn_admin_getStats");
	});

	// ── Migrations ────────────────────────────────────────────────────────────

	it("discovers migrations", async () => {
		await write("migrations/001-init.ts");
		await write("migrations/002-add-users.ts");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.migrations.size).toBe(2);
		expect(result.migrations.has("001Init")).toBe(true);
		expect(result.migrations.has("002AddUsers")).toBe(true);

		const file = result.migrations.get("001Init")!;
		expect(file.varName).toBe("_mig_001Init");
	});

	// ── Seeds ─────────────────────────────────────────────────────────────────

	it("discovers seeds", async () => {
		await write("seeds/demo-data.ts");
		await write("seeds/site-settings.ts");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.seeds.size).toBe(2);
		expect(result.seeds.has("demoData")).toBe(true);
		expect(result.seeds.has("siteSettings")).toBe(true);

		const file = result.seeds.get("demoData")!;
		expect(file.varName).toBe("_seed_demoData");
	});

	// ── Auth ──────────────────────────────────────────────────────────────────

	it("discovers auth.ts as a single file", async () => {
		await write("auth.ts", "export default {};");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.auth).not.toBeNull();
		expect(result.auth!.key).toBe("auth");
		expect(result.auth!.varName).toBe("_auth");
		expect(result.auth!.exportType).toBe("default");
	});

	it("does not treat auth.ts as a collection/job/etc.", async () => {
		await write("auth.ts", "export default {};");
		await write("collections/posts.ts", "export const posts = {};");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.collections.size).toBe(1);
		expect(result.auth).not.toBeNull();
	});

	// ── Singles (modules, locale, hooks, access, context) ────────────────────

	it("discovers modules.ts as a single", async () => {
		await write("modules.ts", "export default [];");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.singles.has("modules")).toBe(true);
		const file = result.singles.get("modules")!;
		expect(file.varName).toBe("_modules");
		expect(file.exportType).toBe("default");
	});

	it("discovers locale.ts as a single", async () => {
		await write("locale.ts", "export default {};");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.singles.has("locale")).toBe(true);
	});

	it("discovers context.ts as contextResolver single", async () => {
		await write("context.ts", "export default {};");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.singles.has("contextResolver")).toBe(true);
	});

	it("discovers access.ts as defaultAccess single", async () => {
		await write("access.ts", "export default {};");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.singles.has("defaultAccess")).toBe(true);
	});

	// ── Feature layout ────────────────────────────────────────────────────────

	it("discovers collections from features/ layout", async () => {
		await write("features/blog/collections/articles.ts", "export const articles = {};");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.collections.has("articles")).toBe(true);
	});

	it("merges by-type and by-feature layout collections", async () => {
		await write("collections/posts.ts", "export const posts = {};");
		await write("features/blog/collections/articles.ts", "export const articles = {};");

		const result = await discoverFiles(rootDir, outDir);
		expect(result.collections.size).toBe(2);
		expect(result.collections.has("posts")).toBe(true);
		expect(result.collections.has("articles")).toBe(true);
	});

	// ── Conflict detection ────────────────────────────────────────────────────

	it("throws on duplicate keys from by-type and by-feature layout", async () => {
		await write("collections/posts.ts", "export const posts = {};");
		await write("features/blog/collections/posts.ts", "export const posts = {};");

		await expect(discoverFiles(rootDir, outDir)).rejects.toThrow(
			/duplicate collections key "posts"/,
		);
	});

	// ── Plugin discovery ──────────────────────────────────────────────────────

	it("discovers plugin directory pattern (e.g. blocks/*.ts)", async () => {
		await write("blocks/hero.ts", "export const hero = {};");
		await write("blocks/cta.ts", "export const cta = {};");
		await write("modules.ts", "export default [];");

		const result = await discoverFiles(rootDir, outDir, [
			{
				name: "test-plugin",
				discover: { blocks: "blocks/*.ts" },
			},
		]);

		expect(result.custom.has("blocks")).toBe(true);
		const blocks = result.custom.get("blocks")!;
		expect(blocks.has("hero")).toBe(true);
		expect(blocks.has("cta")).toBe(true);
	});

	it("discovers plugin single-file pattern (e.g. sidebar.ts)", async () => {
		await write("sidebar.ts", "export default [];");

		const result = await discoverFiles(rootDir, outDir, [
			{
				name: "test-plugin",
				discover: { sidebar: "sidebar.ts" },
			},
		]);

		expect(result.singles.has("sidebar")).toBe(true);
		const file = result.singles.get("sidebar")!;
		expect(file.key).toBe("sidebar");
		expect(file.varName).toBe("_sidebar");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// discoverFiles — mergeStrategy: "spread"
// ─────────────────────────────────────────────────────────────────────────────

describe("discoverFiles — mergeStrategy spread", () => {
	let rootDir: string;
	let outDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "questpie-spread-"));
		outDir = join(rootDir, ".generated");
		await mkdir(outDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});

	async function write(relPath: string, content = "export default [];"): Promise<void> {
		const full = join(rootDir, relPath);
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, content, "utf-8");
	}

	const spreadPlugin = {
		name: "admin",
		discover: {
			sidebar: { pattern: "sidebar.ts", mergeStrategy: "spread" as const },
		},
	};

	it("goes to spreads map, not singles map, when mergeStrategy is spread", async () => {
		await write("sidebar.ts");

		const result = await discoverFiles(rootDir, outDir, [spreadPlugin]);

		expect(result.singles.has("sidebar")).toBe(false);
		expect(result.spreads.has("sidebar")).toBe(true);
	});

	it("collects only root file when no features dir exists", async () => {
		await write("sidebar.ts");

		const result = await discoverFiles(rootDir, outDir, [spreadPlugin]);
		const files = result.spreads.get("sidebar")!;

		expect(files).toHaveLength(1);
		expect(files[0].varName).toBe("_sidebar_root");
		expect(files[0].importPath).toBe("../sidebar");
	});

	it("collects root + feature files in order (root first, features alphabetically)", async () => {
		await write("sidebar.ts");
		await write("features/audit/sidebar.ts");
		await write("features/admin/sidebar.ts");

		const result = await discoverFiles(rootDir, outDir, [spreadPlugin]);
		const files = result.spreads.get("sidebar")!;

		expect(files).toHaveLength(3);
		expect(files[0].varName).toBe("_sidebar_root");  // root first
		expect(files[1].varName).toBe("_sidebar_admin"); // alphabetical: admin < audit
		expect(files[2].varName).toBe("_sidebar_audit");
	});

	it("collects feature files only when no root file exists", async () => {
		await write("features/admin/sidebar.ts");
		await write("features/audit/sidebar.ts");

		const result = await discoverFiles(rootDir, outDir, [spreadPlugin]);
		const files = result.spreads.get("sidebar")!;

		expect(files).toHaveLength(2);
		expect(files[0].varName).toBe("_sidebar_admin");
		expect(files[1].varName).toBe("_sidebar_audit");
	});

	it("produces empty spreads map when no files match", async () => {
		const result = await discoverFiles(rootDir, outDir, [spreadPlugin]);

		expect(result.spreads.has("sidebar")).toBe(false);
	});

	it("camelCases feature names in varName", async () => {
		await write("features/blog-section/sidebar.ts");

		const result = await discoverFiles(rootDir, outDir, [spreadPlugin]);
		const files = result.spreads.get("sidebar")!;

		expect(files[0].varName).toBe("_sidebar_blogSection");
	});

	it("supports multiple spread keys from the same plugin", async () => {
		const multiPlugin = {
			name: "admin",
			discover: {
				sidebar: { pattern: "sidebar.ts", mergeStrategy: "spread" as const },
				dashboard: { pattern: "dashboard.ts", mergeStrategy: "spread" as const },
			},
		};
		await write("sidebar.ts");
		await write("features/admin/sidebar.ts");
		await write("dashboard.ts");

		const result = await discoverFiles(rootDir, outDir, [multiPlugin]);

		expect(result.spreads.get("sidebar")).toHaveLength(2);
		expect(result.spreads.get("dashboard")).toHaveLength(1);
	});

	it("importPath is relative from outDir to the spread file", async () => {
		await write("features/admin/sidebar.ts");

		const result = await discoverFiles(rootDir, outDir, [spreadPlugin]);
		const [file] = result.spreads.get("sidebar")!;

		expect(file.importPath).toBe("../features/admin/sidebar");
	});
});
