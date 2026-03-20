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
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DiscoverFilesOptions } from "../../src/cli/codegen/discover.js";
import {
	detectExportType,
	detectExportTypeFromContent,
	detectFactoryExports,
	discoverFiles,
	kebabToCamelCase,
} from "../../src/cli/codegen/discover.js";
import {
	coreCodegenPlugin,
	resolveTargetGraph,
} from "../../src/cli/codegen/index.js";

/**
 * Helper: resolve the core server target and return DiscoverFilesOptions.
 * Most tests need core categories (collections, globals, etc.) to be declared.
 */
function coreDiscoverOptions(): DiscoverFilesOptions {
	const graph = resolveTargetGraph([coreCodegenPlugin()]);
	const target = graph.get("server")!;
	return { categories: target.categories, discover: target.discover };
}

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

	it("preserves underscores (snake_case passes through unchanged)", () => {
		// Underscores are intentionally NOT converted to camelCase.
		// Collection/global names use snake_case (PostgreSQL convention)
		// and the name is the canonical runtime identifier used by relation
		// references (through, f.relation target, sidebar config).
		expect(kebabToCamelCase("admin_preferences.ts")).toBe("admin_preferences");
		expect(kebabToCamelCase("admin_saved_views.ts")).toBe("admin_saved_views");
		expect(kebabToCamelCase("admin_locks.ts")).toBe("admin_locks");
		expect(kebabToCamelCase("admin_audit_log.ts")).toBe("admin_audit_log");
	});

	it("converts hyphens but preserves underscores in mixed names", () => {
		expect(kebabToCamelCase("my_cool-thing.ts")).toBe("my_coolThing");
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
		const path = await writeFixture(
			"a.ts",
			"export const posts = collection('posts');",
		);
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
		const path = await writeFixture(
			"a.ts",
			"import { foo } from './foo';\nexport { foo };",
		);
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

	async function write(
		relPath: string,
		content = "export default {};",
	): Promise<void> {
		const full = join(rootDir, relPath);
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, content, "utf-8");
	}

	/** Helper to get a category map from the result */
	function cat(
		result: Awaited<ReturnType<typeof discoverFiles>>,
		name: string,
	) {
		return result.categories.get(name) ?? new Map();
	}

	// ── Empty project ──────────────────────────────────────────────────────────

	it("returns empty maps for an empty directory", async () => {
		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		// All core categories exist but are empty
		expect(cat(result, "collections").size).toBe(0);
		expect(cat(result, "globals").size).toBe(0);
		expect(cat(result, "jobs").size).toBe(0);
		expect(cat(result, "routes").size).toBe(0);
		expect(cat(result, "messages").size).toBe(0);
		expect(cat(result, "services").size).toBe(0);
		expect(cat(result, "emails").size).toBe(0);
		expect(cat(result, "migrations").size).toBe(0);
		expect(cat(result, "seeds").size).toBe(0);
		expect(result.singles.size).toBe(0);
	});

	// ── Collections ───────────────────────────────────────────────────────────

	it("discovers collections with camelCase keys", async () => {
		await write(
			"collections/posts.ts",
			"export const posts = collection('posts');",
		);
		await write(
			"collections/blog-posts.ts",
			"export const blogPosts = collection('blog-posts');",
		);

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const collections = cat(result, "collections");
		expect(collections.size).toBe(2);
		expect(collections.has("posts")).toBe(true);
		expect(collections.has("blogPosts")).toBe(true);
	});

	it("sets correct varName and importPath for collections", async () => {
		await write(
			"collections/posts.ts",
			"export const posts = collection('posts');",
		);

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const file = cat(result, "collections").get("posts")!;
		expect(file.varName).toBe("_coll_posts");
		expect(file.importPath).toBe("../collections/posts");
		expect(file.exportType).toBe("named");
		expect(file.namedExportName).toBe("posts");
	});

	it("ignores index.ts in collections", async () => {
		await write("collections/index.ts", "export * from './posts';");
		await write(
			"collections/posts.ts",
			"export const posts = collection('posts');",
		);

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const collections = cat(result, "collections");
		expect(collections.size).toBe(1);
		expect(collections.has("posts")).toBe(true);
	});

	it("ignores private files starting with _ in collections", async () => {
		await write("collections/_utils.ts", "export const util = {};");
		await write(
			"collections/posts.ts",
			"export const posts = collection('posts');",
		);

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const collections = cat(result, "collections");
		expect(collections.size).toBe(1);
		expect(collections.has("posts")).toBe(true);
	});

	// ── Globals ───────────────────────────────────────────────────────────────

	it("discovers globals", async () => {
		await write(
			"globals/site-settings.ts",
			"export const siteSettings = global('site-settings');",
		);

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const globals = cat(result, "globals");
		expect(globals.size).toBe(1);
		const file = globals.get("siteSettings")!;
		expect(file.varName).toBe("_glob_siteSettings");
	});

	// ── Jobs ──────────────────────────────────────────────────────────────────

	it("discovers jobs", async () => {
		await write("jobs/send-emails.ts");
		await write("jobs/cleanup.ts");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const jobs = cat(result, "jobs");
		expect(jobs.size).toBe(2);
		expect(jobs.has("sendEmails")).toBe(true);
		expect(jobs.has("cleanup")).toBe(true);
	});

	// ── Routes ────────────────────────────────────────────────────────────────

	it("discovers routes dir files under routes category", async () => {
		await write("routes/get-users.ts");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		expect(cat(result, "routes").has("getUsers")).toBe(true);
	});

	it("discovers functions dir files under routes category", async () => {
		await write("functions/get-stats.ts");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		expect(cat(result, "routes").has("getStats")).toBe(true);
	});

	it("merges routes and functions into a single routes category", async () => {
		await write("routes/webhook.ts");
		await write("functions/get-stats.ts");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const routes = cat(result, "routes");
		expect(routes.has("webhook")).toBe(true);
		expect(routes.has("getStats")).toBe(true);
	});

	it("discovers nested routes with slash-separated camelCase keys", async () => {
		await write("routes/admin/get-stats.ts");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const routes = cat(result, "routes");
		expect(routes.has("admin/getStats")).toBe(true);

		const file = routes.get("admin/getStats")!;
		expect(file.varName).toBe("_route_admin_getStats");
	});

	// ── Migrations ────────────────────────────────────────────────────────────

	it("discovers migrations", async () => {
		await write("migrations/001-init.ts");
		await write("migrations/002-add-users.ts");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const migrations = cat(result, "migrations");
		expect(migrations.size).toBe(2);
		expect(migrations.has("001Init")).toBe(true);
		expect(migrations.has("002AddUsers")).toBe(true);

		const file = migrations.get("001Init")!;
		expect(file.varName).toBe("_mig_001Init");
	});

	// ── Seeds ─────────────────────────────────────────────────────────────────

	it("discovers seeds", async () => {
		await write("seeds/demo-data.ts");
		await write("seeds/site-settings.ts");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const seeds = cat(result, "seeds");
		expect(seeds.size).toBe(2);
		expect(seeds.has("demoData")).toBe(true);
		expect(seeds.has("siteSettings")).toBe(true);

		const file = seeds.get("demoData")!;
		expect(file.varName).toBe("_seed_demoData");
	});

	// ── Auth ──────────────────────────────────────────────────────────────────

	it("discovers config/auth.ts as authConfig single file", async () => {
		await write("config/auth.ts", "export default {};");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const authSingle = result.singles.get("authConfig");
		expect(authSingle).not.toBeUndefined();
		expect(authSingle!.key).toBe("authConfig");
		expect(authSingle!.varName).toBe("_authConfig");
		expect(authSingle!.exportType).toBe("default");
	});

	it("does not treat config/auth.ts as a collection/job/etc.", async () => {
		await write("config/auth.ts", "export default {};");
		await write(
			"collections/posts.ts",
			"export const posts = collection('posts');",
		);

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		expect(cat(result, "collections").size).toBe(1);
		expect(result.singles.has("authConfig")).toBe(true);
	});

	// ── Singles (modules, locale, hooks, access, context) ────────────────────

	it("discovers modules.ts as a single", async () => {
		await write("modules.ts", "export default [];");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		expect(result.singles.has("modules")).toBe(true);
		const file = result.singles.get("modules")!;
		expect(file.varName).toBe("_modules");
		expect(file.exportType).toBe("default");
	});

	it("discovers config/app.ts as appConfig single with destructure", async () => {
		await write("config/app.ts", "export default {};");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		expect(result.singles.has("appConfig")).toBe(true);
		const file = result.singles.get("appConfig")!;
		expect(file.destructure).toBeDefined();
		expect(file.destructure!.locale).toBe("locale");
		expect(file.destructure!.access).toBe("defaultAccess");
	});

	// ── Feature layout ────────────────────────────────────────────────────────

	it("discovers collections from features/ layout", async () => {
		await write(
			"features/blog/collections/articles.ts",
			"export const articles = collection('articles');",
		);

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		expect(cat(result, "collections").has("articles")).toBe(true);
	});

	it("merges by-type and by-feature layout collections", async () => {
		await write(
			"collections/posts.ts",
			"export const posts = collection('posts');",
		);
		await write(
			"features/blog/collections/articles.ts",
			"export const articles = collection('articles');",
		);

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const collections = cat(result, "collections");
		expect(collections.size).toBe(2);
		expect(collections.has("posts")).toBe(true);
		expect(collections.has("articles")).toBe(true);
	});

	// ── Conflict detection ────────────────────────────────────────────────────

	it("throws on duplicate keys from by-type and by-feature layout", async () => {
		await write(
			"collections/posts.ts",
			"export const posts = collection('posts');",
		);
		await write(
			"features/blog/collections/posts.ts",
			"export const posts = collection('posts');",
		);

		await expect(
			discoverFiles(rootDir, outDir, coreDiscoverOptions()),
		).rejects.toThrow(/duplicate collections key "posts"/);
	});

	it("throws clear error for route name collision between routes and functions", async () => {
		await write("routes/get-stats.ts");
		await write("functions/get-stats.ts");

		await expect(
			discoverFiles(rootDir, outDir, coreDiscoverOptions()),
		).rejects.toThrow(
			/Route name collision: 'get-stats' found in both functions\/ and routes\//,
		);
	});

	// ── Plugin discovery ──────────────────────────────────────────────────────

	it("discovers plugin directory pattern (e.g. blocks/*.ts)", async () => {
		await write("blocks/hero.ts", "export const hero = {};");
		await write("blocks/cta.ts", "export const cta = {};");
		await write("modules.ts", "export default [];");

		const result = await discoverFiles(rootDir, outDir, {
			discover: { blocks: "blocks/*.ts" },
		});

		// Plugin directory patterns go into categories
		expect(result.categories.has("blocks")).toBe(true);
		const blocks = result.categories.get("blocks")!;
		expect(blocks.has("hero")).toBe(true);
		expect(blocks.has("cta")).toBe(true);
	});

	it("discovers plugin single-file pattern (e.g. sidebar.ts)", async () => {
		await write("sidebar.ts", "export default [];");

		const result = await discoverFiles(rootDir, outDir, {
			discover: { sidebar: "sidebar.ts" },
		});

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

	async function write(
		relPath: string,
		content = "export default [];",
	): Promise<void> {
		const full = join(rootDir, relPath);
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, content, "utf-8");
	}

	const spreadOpts: DiscoverFilesOptions = {
		discover: {
			sidebar: { pattern: "sidebar.ts", mergeStrategy: "spread" as const },
		},
	};

	it("goes to spreads map, not singles map, when mergeStrategy is spread", async () => {
		await write("sidebar.ts");

		const result = await discoverFiles(rootDir, outDir, spreadOpts);

		expect(result.singles.has("sidebar")).toBe(false);
		expect(result.spreads.has("sidebar")).toBe(true);
	});

	it("collects only root file when no features dir exists", async () => {
		await write("sidebar.ts");

		const result = await discoverFiles(rootDir, outDir, spreadOpts);
		const files = result.spreads.get("sidebar")!;

		expect(files).toHaveLength(1);
		expect(files[0].varName).toBe("_sidebar_root");
		expect(files[0].importPath).toBe("../sidebar");
	});

	it("collects root + feature files in order (root first, features alphabetically)", async () => {
		await write("sidebar.ts");
		await write("features/audit/sidebar.ts");
		await write("features/admin/sidebar.ts");

		const result = await discoverFiles(rootDir, outDir, spreadOpts);
		const files = result.spreads.get("sidebar")!;

		expect(files).toHaveLength(3);
		expect(files[0].varName).toBe("_sidebar_root"); // root first
		expect(files[1].varName).toBe("_sidebar_admin"); // alphabetical: admin < audit
		expect(files[2].varName).toBe("_sidebar_audit");
	});

	it("collects feature files only when no root file exists", async () => {
		await write("features/admin/sidebar.ts");
		await write("features/audit/sidebar.ts");

		const result = await discoverFiles(rootDir, outDir, spreadOpts);
		const files = result.spreads.get("sidebar")!;

		expect(files).toHaveLength(2);
		expect(files[0].varName).toBe("_sidebar_admin");
		expect(files[1].varName).toBe("_sidebar_audit");
	});

	it("produces empty spreads map when no files match", async () => {
		const result = await discoverFiles(rootDir, outDir, spreadOpts);

		expect(result.spreads.has("sidebar")).toBe(false);
	});

	it("camelCases feature names in varName", async () => {
		await write("features/blog-section/sidebar.ts");

		const result = await discoverFiles(rootDir, outDir, spreadOpts);
		const files = result.spreads.get("sidebar")!;

		expect(files[0].varName).toBe("_sidebar_blogSection");
	});

	it("supports multiple spread keys from the same discover options", async () => {
		const multiOpts: DiscoverFilesOptions = {
			discover: {
				sidebar: { pattern: "sidebar.ts", mergeStrategy: "spread" as const },
				dashboard: {
					pattern: "dashboard.ts",
					mergeStrategy: "spread" as const,
				},
			},
		};
		await write("sidebar.ts");
		await write("features/admin/sidebar.ts");
		await write("dashboard.ts");

		const result = await discoverFiles(rootDir, outDir, multiOpts);

		expect(result.spreads.get("sidebar")).toHaveLength(2);
		expect(result.spreads.get("dashboard")).toHaveLength(1);
	});

	it("importPath is relative from outDir to the spread file", async () => {
		await write("features/admin/sidebar.ts");

		const result = await discoverFiles(rootDir, outDir, spreadOpts);
		const [file] = result.spreads.get("sidebar")!;

		expect(file.importPath).toBe("../features/admin/sidebar");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// detectFactoryExports — unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("detectFactoryExports", () => {
	it("detects a single exported factory call", () => {
		const matches = detectFactoryExports(`export const hero = block("hero");`, [
			"block",
		]);
		expect(matches).toHaveLength(1);
		expect(matches[0].exportName).toBe("hero");
		expect(matches[0].factoryName).toBe("block");
		expect(matches[0].entityKey).toBe("hero");
		expect(matches[0].isDefault).toBe(false);
	});

	it("detects multiple exported factory calls", () => {
		const matches = detectFactoryExports(
			`export const hero = block("hero");\nexport const cta = block("cta");`,
			["block"],
		);
		expect(matches).toHaveLength(2);
		expect(matches[0].exportName).toBe("hero");
		expect(matches[1].exportName).toBe("cta");
	});

	it("extracts entity key from factory string argument", () => {
		const matches = detectFactoryExports(
			`export const x = block("hero-banner");`,
			["block"],
		);
		expect(matches[0].entityKey).toBe("hero-banner");
	});

	it("returns null entityKey when factory arg is not a string literal", () => {
		const matches = detectFactoryExports(
			`export const heroBlock = block(dynamicVar);`,
			["block"],
		);
		expect(matches[0].entityKey).toBeNull();
		expect(matches[0].exportName).toBe("heroBlock");
	});

	it("detects inline default factory export", () => {
		const matches = detectFactoryExports(`export default block("hero");`, [
			"block",
		]);
		expect(matches).toHaveLength(1);
		expect(matches[0].isDefault).toBe(true);
		expect(matches[0].entityKey).toBe("hero");
	});

	it("detects inline default factory without string arg", () => {
		const matches = detectFactoryExports(`export default block(dynamicVar);`, [
			"block",
		]);
		expect(matches).toHaveLength(1);
		expect(matches[0].isDefault).toBe(true);
		expect(matches[0].entityKey).toBeNull();
	});

	it("returns empty for files with no factory calls", () => {
		const matches = detectFactoryExports(
			`export const helper = () => {};\nexport type Foo = string;`,
			["block"],
		);
		expect(matches).toHaveLength(0);
	});

	it("detects re-export pattern: export { X }", () => {
		const matches = detectFactoryExports(
			`const hero = block("hero");\nexport { hero };`,
			["block"],
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].exportName).toBe("hero");
		expect(matches[0].entityKey).toBe("hero");
		expect(matches[0].isDefault).toBe(false);
	});

	it("detects aliased re-export: export { X as Y }", () => {
		const matches = detectFactoryExports(
			`const hero = block("hero");\nexport { hero as myHero };`,
			["block"],
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].exportName).toBe("myHero");
		expect(matches[0].entityKey).toBe("hero");
	});

	it("detects default re-export of factory variable", () => {
		const matches = detectFactoryExports(
			`const hero = block("hero");\nexport default hero;\n`,
			["block"],
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].isDefault).toBe(true);
		expect(matches[0].exportName).toBe("hero");
		expect(matches[0].entityKey).toBe("hero");
	});

	it("handles generic type parameters on factory", () => {
		const matches = detectFactoryExports(
			`export const posts = collection<PostConfig>("posts");`,
			["collection"],
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].entityKey).toBe("posts");
	});

	it("matches multiple factory function names", () => {
		const matches = detectFactoryExports(
			`export const a = view("list");\nexport const b = listView("grid");`,
			["view", "listView"],
		);
		expect(matches).toHaveLength(2);
		expect(matches[0].factoryName).toBe("view");
		expect(matches[1].factoryName).toBe("listView");
	});

	it("returns empty when factoryFunctions is empty", () => {
		const matches = detectFactoryExports(
			`export const hero = block("hero");`,
			[],
		);
		expect(matches).toHaveLength(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// detectExportTypeFromContent — backward compatibility
// ─────────────────────────────────────────────────────────────────────────────

describe("detectExportTypeFromContent", () => {
	it("detects default export", () => {
		expect(detectExportTypeFromContent("export default {};")).toEqual({
			type: "default",
		});
	});

	it("detects export { X as default }", () => {
		expect(detectExportTypeFromContent("export { X as default };")).toEqual({
			type: "default",
		});
	});

	it("detects named const export", () => {
		const result = detectExportTypeFromContent(
			"export const posts = collection('posts');",
		);
		expect(result.type).toBe("named");
		expect(result.namedExportName).toBe("posts");
	});

	it("detects bundle export (object literal)", () => {
		const result = detectExportTypeFromContent(
			"export const fns = {\n  fn1,\n  fn2,\n};",
		);
		expect(result.type).toBe("named");
		expect(result.namedExportName).toBe("fns");
		expect(result.isBundle).toBe(true);
	});

	it("does not mark function call as bundle", () => {
		const result = detectExportTypeFromContent(
			"export const x = collection('x');",
		);
		// collection('x') matches `export const X = <something>` — but the regex
		// for bundle requires `= {` directly, which doesn't match `= collection(`
		expect(result.isBundle).toBeUndefined();
	});

	it("detects named re-export", () => {
		const result = detectExportTypeFromContent("export { foo };");
		expect(result.type).toBe("named");
		expect(result.namedExportName).toBe("foo");
	});

	it("returns unknown for no exports", () => {
		expect(detectExportTypeFromContent("const x = 1;")).toEqual({
			type: "unknown",
		});
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// multi-export factory discovery (integration)
// ─────────────────────────────────────────────────────────────────────────────

describe("multi-export factory discovery", () => {
	let rootDir: string;
	let outDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "questpie-factory-"));
		outDir = join(rootDir, ".generated");
		await mkdir(outDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});

	async function write(relPath: string, content: string): Promise<void> {
		const full = join(rootDir, relPath);
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, content, "utf-8");
	}

	/** Custom options with a blocks category using factoryFunctions */
	const factoryOpts: DiscoverFilesOptions = {
		categories: {
			blocks: {
				dirs: ["blocks"],
				prefix: "bloc",
				factoryFunctions: ["block"],
			},
		},
	};

	it("discovers two named factory exports from one file", async () => {
		await write(
			"blocks/layout.ts",
			'export const hero = block("hero");\nexport const cta = block("cta");',
		);

		const result = await discoverFiles(rootDir, outDir, factoryOpts);
		const blocks = result.categories.get("blocks")!;
		expect(blocks.size).toBe(2);
		expect(blocks.has("hero")).toBe(true);
		expect(blocks.has("cta")).toBe(true);

		const heroFile = blocks.get("hero")!;
		expect(heroFile.exportType).toBe("named");
		expect(heroFile.namedExportName).toBe("hero");
		expect(heroFile.varName).toBe("_bloc_hero");

		const ctaFile = blocks.get("cta")!;
		expect(ctaFile.namedExportName).toBe("cta");
	});

	it("derives key from factory string arg (kebab-case)", async () => {
		await write("blocks/banner.ts", 'export const x = block("hero-banner");');

		const result = await discoverFiles(rootDir, outDir, factoryOpts);
		const blocks = result.categories.get("blocks")!;
		// Factory string arg has highest priority → "hero-banner" → "heroBanner"
		expect(blocks.has("heroBanner")).toBe(true);
	});

	it("falls back to export name when factory arg is not a string", async () => {
		await write(
			"blocks/dynamic.ts",
			"export const heroBlock = block(dynamicVar);",
		);

		const result = await discoverFiles(rootDir, outDir, factoryOpts);
		const blocks = result.categories.get("blocks")!;
		// No string arg → falls back to export name
		expect(blocks.has("heroBlock")).toBe(true);
	});

	it("discovers default inline factory export", async () => {
		await write("blocks/hero.ts", 'export default block("hero");');

		const result = await discoverFiles(rootDir, outDir, factoryOpts);
		const blocks = result.categories.get("blocks")!;
		expect(blocks.has("hero")).toBe(true);
		expect(blocks.get("hero")!.exportType).toBe("default");
	});

	it("falls back to filename for default with non-string arg", async () => {
		await write("blocks/hero-banner.ts", "export default block(dynamicVar);");

		const result = await discoverFiles(rootDir, outDir, factoryOpts);
		const blocks = result.categories.get("blocks")!;
		expect(blocks.has("heroBanner")).toBe(true);
	});

	it("skips utility files with no factory calls", async () => {
		await write(
			"blocks/helpers.ts",
			"export const helper = () => {};\nexport type Foo = string;",
		);

		const result = await discoverFiles(rootDir, outDir, factoryOpts);
		const blocks = result.categories.get("blocks") ?? new Map();
		expect(blocks.size).toBe(0);
	});

	it("detects re-export pattern: export { X }", async () => {
		await write(
			"blocks/hero.ts",
			'const hero = block("hero");\nexport { hero };',
		);

		const result = await discoverFiles(rootDir, outDir, factoryOpts);
		const blocks = result.categories.get("blocks")!;
		expect(blocks.has("hero")).toBe(true);
		expect(blocks.get("hero")!.exportType).toBe("named");
	});

	it("detects aliased re-export: export { X as Y }", async () => {
		await write(
			"blocks/hero.ts",
			'const hero = block("hero");\nexport { hero as myHero };',
		);

		const result = await discoverFiles(rootDir, outDir, factoryOpts);
		const blocks = result.categories.get("blocks")!;
		expect(blocks.has("hero")).toBe(true);
		expect(blocks.get("hero")!.namedExportName).toBe("myHero");
	});

	it("detects default re-export of factory variable", async () => {
		await write(
			"blocks/hero.ts",
			'const hero = block("hero");\nexport default hero;\n',
		);

		const result = await discoverFiles(rootDir, outDir, factoryOpts);
		const blocks = result.categories.get("blocks")!;
		expect(blocks.has("hero")).toBe(true);
		expect(blocks.get("hero")!.exportType).toBe("default");
	});

	it("detects conflict with multi-export across files", async () => {
		await write("blocks/file1.ts", 'export const hero = block("hero");');
		await write("blocks/file2.ts", 'export const hero2 = block("hero");');

		// Both files use block("hero") → both get key "hero" → conflict
		await expect(discoverFiles(rootDir, outDir, factoryOpts)).rejects.toThrow(
			/duplicate blocks key "hero"/,
		);
	});

	it("both import paths point to same file for multi-export", async () => {
		await write(
			"blocks/layout.ts",
			'export const hero = block("hero");\nexport const cta = block("cta");',
		);

		const result = await discoverFiles(rootDir, outDir, factoryOpts);
		const blocks = result.categories.get("blocks")!;
		expect(blocks.get("hero")!.importPath).toBe(blocks.get("cta")!.importPath);
	});
});
