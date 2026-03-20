/**
 * Tests: config-related codegen features
 *
 * Covers:
 * 1. `extractPluginsFromModules` — plugin extraction from module trees
 * 2. Destructure on DiscoverPattern — integration with discoverFiles
 * 3. Template *Config → base key mapping
 * 4. Context resolver type propagation in template
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractPluginsFromModules } from "../../src/cli/codegen/extract-plugins.js";
import {
	discoverFiles,
	type DiscoverFilesOptions,
} from "../../src/cli/codegen/discover.js";
import {
	coreCodegenPlugin,
	resolveTargetGraph,
} from "../../src/cli/codegen/index.js";
import { generateTemplate } from "../../src/cli/codegen/template.js";
import type {
	CodegenPlugin,
	DiscoveredFile,
	DiscoveryResult,
} from "../../src/cli/codegen/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve the "server" target from the core plugin. */
function coreDiscoverOptions(): DiscoverFilesOptions {
	const graph = resolveTargetGraph([coreCodegenPlugin()]);
	const target = graph.get("server")!;
	return { categories: target.categories, discover: target.discover };
}

/** Get core categories for template generation. */
function coreCategories() {
	const graph = resolveTargetGraph([coreCodegenPlugin()]);
	return graph.get("server")!.categories;
}

/** Get core singleton factories for template generation. */
function coreSingletonFactories() {
	const graph = resolveTargetGraph([coreCodegenPlugin()]);
	return graph.get("server")!.registries.singletonFactories;
}

/** Get core discover patterns for template generation. */
function coreDiscoverPatterns() {
	const graph = resolveTargetGraph([coreCodegenPlugin()]);
	return graph.get("server")!.discover;
}

/**
 * Build a DiscoveryResult for template tests.
 */
function makeDiscoveryResult(opts: {
	singles?: Array<{
		key: string;
		varName?: string;
		exportType?: "default" | "named";
		destructure?: Record<string, string>;
	}>;
	categories?: Array<{
		name: string;
		files?: Array<{
			key: string;
			varName: string;
			exportType: "default" | "named";
		}>;
	}>;
}): DiscoveryResult {
	const result: DiscoveryResult = {
		categories: new Map(),
		singles: new Map(),
		spreads: new Map(),
	};
	// modules.ts is required
	result.singles.set("modules", {
		absolutePath: "/tmp/modules.ts",
		key: "modules",
		importPath: "../modules",
		varName: "_modules",
		source: "modules.ts",
		exportType: "default",
	});
	for (const s of opts.singles ?? []) {
		result.singles.set(s.key, {
			absolutePath: `/tmp/${s.key}.ts`,
			key: s.key,
			importPath: `../${s.key}`,
			varName: s.varName ?? `_${s.key}`,
			source: `${s.key}.ts`,
			exportType: s.exportType ?? "default",
			destructure: s.destructure,
		});
	}
	for (const cat of opts.categories ?? []) {
		const map = new Map<string, DiscoveredFile>();
		for (const f of cat.files ?? []) {
			map.set(f.key, {
				absolutePath: `/tmp/${cat.name}/${f.key}.ts`,
				key: f.key,
				importPath: `../${cat.name}/${f.key}`,
				varName: f.varName,
				source: `${cat.name}/${f.key}.ts`,
				exportType: f.exportType,
			});
		}
		result.categories.set(cat.name, map);
	}
	return result;
}

/**
 * Build a full DiscoveryResult with all core categories initialized (empty).
 * Useful to avoid the template complaining about missing category maps.
 */
function makeFullDiscoveryResult(opts: Parameters<typeof makeDiscoveryResult>[0]): DiscoveryResult {
	const result = makeDiscoveryResult(opts);
	const coreNames = [
		"collections", "globals", "jobs", "routes", "messages",
		"services", "emails", "migrations", "seeds",
	];
	for (const name of coreNames) {
		if (!result.categories.has(name)) {
			result.categories.set(name, new Map());
		}
	}
	return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. extractPluginsFromModules
// ─────────────────────────────────────────────────────────────────────────────

describe("extractPluginsFromModules", () => {
	it("returns empty array for modules with no plugins", () => {
		const modules = [
			{ name: "mod-a" },
			{ name: "mod-b" },
		];
		const result = extractPluginsFromModules(modules);
		expect(result).toEqual([]);
	});

	it("extracts single plugin from a module", () => {
		const plugin = { name: "my-plugin", targets: {} };
		const modules = [
			{ name: "mod-a", plugin },
		];
		const result = extractPluginsFromModules(modules);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe(plugin);
		expect(result[0].name).toBe("my-plugin");
	});

	it("extracts plugins from nested sub-modules (depth-first)", () => {
		const pluginChild = { name: "child-plugin", targets: {} };
		const pluginParent = { name: "parent-plugin", targets: {} };
		const modules = [
			{
				name: "parent",
				plugin: pluginParent,
				modules: [
					{ name: "child", plugin: pluginChild },
				],
			},
		];
		const result = extractPluginsFromModules(modules);
		// Depth-first: child plugin comes before parent
		expect(result).toHaveLength(2);
		expect(result[0].name).toBe("child-plugin");
		expect(result[1].name).toBe("parent-plugin");
	});

	it("deduplicates plugins by name (first wins)", () => {
		const plugin1 = { name: "shared-plugin", targets: { server: { root: ".", outputFile: "a.ts" } } };
		const plugin2 = { name: "shared-plugin", targets: { server: { root: ".", outputFile: "b.ts" } } };
		const modules = [
			{ name: "mod-a", plugin: plugin1 },
			{ name: "mod-b", plugin: plugin2 },
		];
		const result = extractPluginsFromModules(modules);
		expect(result).toHaveLength(1);
		// First occurrence wins
		expect(result[0]).toBe(plugin1);
	});

	it("handles array of plugins on a module", () => {
		const pluginA = { name: "plugin-a", targets: {} };
		const pluginB = { name: "plugin-b", targets: {} };
		const modules = [
			{ name: "mod", plugin: [pluginA, pluginB] },
		];
		const result = extractPluginsFromModules(modules);
		expect(result).toHaveLength(2);
		expect(result[0].name).toBe("plugin-a");
		expect(result[1].name).toBe("plugin-b");
	});

	it("handles mixed: some modules have plugins, some don't", () => {
		const plugin = { name: "only-plugin", targets: {} };
		const modules = [
			{ name: "mod-no-plugin" },
			{ name: "mod-with-plugin", plugin },
			{ name: "mod-also-no-plugin", other: "stuff" },
		];
		const result = extractPluginsFromModules(modules);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("only-plugin");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Destructure on DiscoverPattern (integration with discoverFiles)
// ─────────────────────────────────────────────────────────────────────────────

describe("discoverFiles — destructure on DiscoverPattern", () => {
	let rootDir: string;
	let outDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "questpie-config-"));
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

	it("discovers config/app.ts as appConfig single with destructure metadata", async () => {
		await write("config/app.ts", "export default { locale: {}, access: {}, hooks: {}, context: () => ({}) };");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const appConfig = result.singles.get("appConfig");

		expect(appConfig).toBeDefined();
		expect(appConfig!.key).toBe("appConfig");
		expect(appConfig!.varName).toBe("_appConfig");
		expect(appConfig!.exportType).toBe("default");
		expect(appConfig!.destructure).toBeDefined();
	});

	it("discovers config/auth.ts as authConfig single (path-based single detection with /)", async () => {
		await write("config/auth.ts", "export default {};");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const authConfig = result.singles.get("authConfig");

		expect(authConfig).toBeDefined();
		expect(authConfig!.key).toBe("authConfig");
		expect(authConfig!.varName).toBe("_authConfig");
		expect(authConfig!.exportType).toBe("default");
		// authConfig does not have destructure (it's a simple single)
		expect(authConfig!.destructure).toBeUndefined();
	});

	it("config/app.ts destructure has correct key mapping", async () => {
		await write("config/app.ts", "export default {};");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const appConfig = result.singles.get("appConfig");

		expect(appConfig).toBeDefined();
		const destructure = appConfig!.destructure!;
		expect(destructure.locale).toBe("locale");
		expect(destructure.access).toBe("defaultAccess");
		expect(destructure.hooks).toBe("hooks");
		expect(destructure.context).toBe("contextResolver");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Template *Config → base key mapping
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — *Config to base key mapping", () => {
	it("authConfig emits as auth: _authConfig as any (not authConfig:)", () => {
		const result = makeFullDiscoveryResult({
			singles: [
				{ key: "authConfig", varName: "_authConfig", exportType: "default" },
			],
		});

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
			discoverPatterns: coreDiscoverPatterns(),
		});

		// authConfig should be emitted under "auth" key (stripping "Config" suffix)
		expect(code).toContain("auth: _authConfig as any,");
		// Should NOT emit "authConfig:" as a createApp key
		expect(code).not.toMatch(/\bauthConfig:\s*_authConfig\s+as\s+any/);
	});

	it("appConfig destructure emits property-access assignments", () => {
		const result = makeFullDiscoveryResult({
			singles: [
				{
					key: "appConfig",
					varName: "_appConfig",
					exportType: "default",
					destructure: {
						locale: "locale",
						access: "defaultAccess",
						hooks: "hooks",
						context: "contextResolver",
					},
				},
			],
		});

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
			discoverPatterns: coreDiscoverPatterns(),
		});

		// Each destructured property should be emitted as property access
		expect(code).toContain("locale: _appConfig.locale as any,");
		expect(code).toContain("defaultAccess: _appConfig.access as any,");
		expect(code).toContain("hooks: _appConfig.hooks as any,");
		expect(code).toContain("contextResolver: _appConfig.context as any,");
	});

	it("when both authConfig and auth exist, authConfig wins (auth is suppressed)", () => {
		const result = makeFullDiscoveryResult({
			singles: [
				{ key: "authConfig", varName: "_authConfig", exportType: "default" },
				{ key: "auth", varName: "_auth", exportType: "default" },
			],
		});

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
			discoverPatterns: coreDiscoverPatterns(),
		});

		// authConfig should emit as "auth:"
		expect(code).toContain("auth: _authConfig as any,");
		// Standalone auth should be suppressed (not emitted)
		expect(code).not.toContain("auth: _auth as any,");
	});

	it("when appConfig exists with destructure, flat locale/hooks/etc. are suppressed", () => {
		const result = makeFullDiscoveryResult({
			singles: [
				{
					key: "appConfig",
					varName: "_appConfig",
					exportType: "default",
					destructure: {
						locale: "locale",
						access: "defaultAccess",
						hooks: "hooks",
						context: "contextResolver",
					},
				},
				// These standalone singles should be suppressed by appConfig destructure
				{ key: "locale", varName: "_locale", exportType: "default" },
				{ key: "hooks", varName: "_hooks", exportType: "default" },
			],
		});

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
			discoverPatterns: coreDiscoverPatterns(),
		});

		// The destructured versions should appear
		expect(code).toContain("locale: _appConfig.locale as any,");
		expect(code).toContain("hooks: _appConfig.hooks as any,");
		// The standalone versions should NOT appear
		expect(code).not.toContain("locale: _locale as any,");
		expect(code).not.toContain("hooks: _hooks as any,");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Context resolver type propagation in template
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — context resolver type propagation", () => {
	it("when appConfig has destructure with context key, template emits _ContextReturn type", () => {
		const result = makeFullDiscoveryResult({
			singles: [
				{
					key: "appConfig",
					varName: "_appConfig",
					exportType: "default",
					destructure: {
						locale: "locale",
						access: "defaultAccess",
						hooks: "hooks",
						context: "contextResolver",
					},
				},
			],
		});

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
			discoverPatterns: coreDiscoverPatterns(),
		});

		// Should emit _ContextReturn based on appConfig.context
		expect(code).toContain("type _ContextReturn =");
		expect(code).toContain("typeof _appConfig.context");
		expect(code).toContain("QuestpieContextExtension extends _ContextReturn");
	});

	it("when standalone contextResolver exists, template emits _ContextReturn type", () => {
		const result = makeFullDiscoveryResult({
			singles: [
				{ key: "contextResolver", varName: "_contextResolver", exportType: "default" },
			],
		});

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
			discoverPatterns: coreDiscoverPatterns(),
		});

		// Should emit _ContextReturn based on standalone contextResolver
		expect(code).toContain("type _ContextReturn =");
		expect(code).toContain("typeof _contextResolver");
		expect(code).toContain("QuestpieContextExtension extends _ContextReturn");
	});

	it("when neither appConfig context nor standalone contextResolver exists, no _ContextReturn is emitted", () => {
		const result = makeFullDiscoveryResult({
			singles: [],
		});

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
			discoverPatterns: coreDiscoverPatterns(),
		});

		// Should NOT emit _ContextReturn
		expect(code).not.toContain("type _ContextReturn");
		expect(code).not.toContain("QuestpieContextExtension");
	});

	it("appConfig with destructure takes precedence over standalone contextResolver for _ContextReturn", () => {
		const result = makeFullDiscoveryResult({
			singles: [
				{
					key: "appConfig",
					varName: "_appConfig",
					exportType: "default",
					destructure: {
						locale: "locale",
						access: "defaultAccess",
						hooks: "hooks",
						context: "contextResolver",
					},
				},
				{ key: "contextResolver", varName: "_contextResolver", exportType: "default" },
			],
		});

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
			discoverPatterns: coreDiscoverPatterns(),
		});

		// appConfig destructure context should be used, not standalone contextResolver
		expect(code).toContain("typeof _appConfig.context");
		// The _ContextReturn type should exist
		expect(code).toContain("type _ContextReturn =");
	});

	it("appConfig without context in destructure falls through to standalone contextResolver", () => {
		const result = makeFullDiscoveryResult({
			singles: [
				{
					key: "appConfig",
					varName: "_appConfig",
					exportType: "default",
					destructure: {
						locale: "locale",
						// No "context" key in destructure
					},
				},
				{ key: "contextResolver", varName: "_contextResolver", exportType: "default" },
			],
		});

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
			discoverPatterns: coreDiscoverPatterns(),
		});

		// Should fall through to standalone contextResolver
		expect(code).toContain("type _ContextReturn =");
		expect(code).toContain("typeof _contextResolver");
		expect(code).not.toContain("typeof _appConfig.context");
	});
});
