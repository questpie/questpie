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

import {
	discoverFiles,
	type DiscoverFilesOptions,
} from "../../src/cli/codegen/discover.js";
import { extractPluginsFromModules } from "../../src/cli/codegen/extract-plugins.js";
import {
	coreCodegenPlugin,
	resolveTargetGraph,
} from "../../src/cli/codegen/index.js";
import {
	CODEGEN_MODULE_METADATA_SYMBOL,
	extractFactoryArgumentsFromModules,
	loadModuleFactoryArguments,
} from "../../src/cli/codegen/module-metadata.js";
import { generateTemplate as _generateTemplate } from "../../src/cli/codegen/template.js";
import type {
	CodegenPlugin,
	DiscoveredFile,
	DiscoveryResult,
} from "../../src/cli/codegen/types.js";

// Step-6 multi-file split: generateTemplate returns `{ code, extraFiles }`.
// Concatenate index.ts + layer files so `.includes(...)` assertions see the
// full emitted surface.
function generateTemplate(
	opts: Parameters<typeof _generateTemplate>[0],
): string {
	const { code, extraFiles } = _generateTemplate(opts);
	return [code, ...extraFiles.map((f) => f.code)].join("\n");
}

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
		configKey?: string;
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
			configKey: s.configKey,
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
function makeFullDiscoveryResult(
	opts: Parameters<typeof makeDiscoveryResult>[0],
): DiscoveryResult {
	const result = makeDiscoveryResult(opts);
	const coreNames = [
		"collections",
		"globals",
		"jobs",
		"routes",
		"messages",
		"services",
		"emails",
		"migrations",
		"seeds",
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
		const modules = [{ name: "mod-a" }, { name: "mod-b" }];
		const result = extractPluginsFromModules(modules);
		expect(result).toEqual([]);
	});

	it("extracts single plugin from a module", () => {
		const plugin = { name: "my-plugin", targets: {} };
		const modules = [{ name: "mod-a", plugin }];
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
				modules: [{ name: "child", plugin: pluginChild }],
			},
		];
		const result = extractPluginsFromModules(modules);
		// Depth-first: child plugin comes before parent
		expect(result).toHaveLength(2);
		expect(result[0].name).toBe("child-plugin");
		expect(result[1].name).toBe("parent-plugin");
	});

	it("deduplicates plugins by name (first wins)", () => {
		const plugin1 = {
			name: "shared-plugin",
			targets: { server: { root: ".", outputFile: "a.ts" } },
		};
		const plugin2 = {
			name: "shared-plugin",
			targets: { server: { root: ".", outputFile: "b.ts" } },
		};
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
		const modules = [{ name: "mod", plugin: [pluginA, pluginB] }];
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

describe("extractFactoryArgumentsFromModules", () => {
	it("qualifies generated source metadata and traverses each module once", () => {
		const symbol = Symbol.for(CODEGEN_MODULE_METADATA_SYMBOL);
		const child = {
			name: "questpie-chat",
			[symbol]: {
				factoryArguments: [
					{
						category: "channels",
						key: "chatRoom",
						value: "chat-room-[roomId]",
						source: "channels/chat-room.ts",
					},
				],
			},
		};
		const root = { name: "root", modules: [child, child] };

		expect(extractFactoryArgumentsFromModules([root])).toEqual([
			{
				category: "channels",
				key: "chatRoom",
				value: "chat-room-[roomId]",
				source: "questpie-chat:channels/chat-room.ts",
			},
		]);
	});

	it("loads metadata from modules.ts for root codegen", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "questpie-module-meta-"));
		try {
			await writeFile(
				join(rootDir, "modules.ts"),
				[
					`const symbol = Symbol.for(${JSON.stringify(CODEGEN_MODULE_METADATA_SYMBOL)});`,
					"export default [{",
					'  name: "questpie-chat",',
					"  [symbol]: { factoryArguments: [{",
					'    category: "channels", key: "chatRoom",',
					'    value: "chat-room-[roomId]", source: "channels/chat-room.ts"',
					"  }] }",
					"}];",
				].join("\n"),
				"utf-8",
			);

			expect(await loadModuleFactoryArguments(rootDir)).toEqual([
				{
					category: "channels",
					key: "chatRoom",
					value: "chat-room-[roomId]",
					source: "questpie-chat:channels/chat-room.ts",
				},
			]);
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});

	// Single-file discovery accepts a .mts sibling for every .ts pattern. This
	// used to look only for modules.ts, so an .mts project's module metadata was
	// dropped and its collision check never ran.
	it("reads modules.mts too", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "questpie-module-meta-mts-"));
		try {
			await writeFile(
				join(rootDir, "modules.mts"),
				[
					`const symbol = Symbol.for(${JSON.stringify(CODEGEN_MODULE_METADATA_SYMBOL)});`,
					"export default [{",
					'  name: "questpie-chat",',
					"  [symbol]: { factoryArguments: [{",
					'    category: "channels", key: "chatRoom",',
					'    value: "chat-room-[roomId]", source: "channels/chat-room.ts"',
					"  }] }",
					"}];",
				].join("\n"),
				"utf-8",
			);

			expect(await loadModuleFactoryArguments(rootDir)).toEqual([
				{
					category: "channels",
					key: "chatRoom",
					value: "chat-room-[roomId]",
					source: "questpie-chat:channels/chat-room.ts",
				},
			]);
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});

	// An unimportable modules.ts costs a uniqueness check, not the artifact, so
	// this warns and carries on. It has to say so: the old catch returned an
	// empty list with no output at all.
	it("warns and returns empty when modules.ts cannot be imported", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "questpie-module-meta-bad-"));
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args.map(String).join(" "));
		};
		try {
			await writeFile(
				join(rootDir, "modules.ts"),
				'import { nope } from "@questpie/definitely-not-installed";\nexport default [nope];\n',
				"utf-8",
			);

			expect(await loadModuleFactoryArguments(rootDir)).toEqual([]);
			expect(warnings.join("\n")).toContain("modules.ts");
			expect(warnings.join("\n")).toContain("collisions");
		} finally {
			console.warn = originalWarn;
			await rm(rootDir, { recursive: true, force: true });
		}
	});

	it("returns empty when there is no modules file", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "questpie-module-meta-none-"));
		try {
			expect(await loadModuleFactoryArguments(rootDir)).toEqual([]);
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Destructure on DiscoverPattern (integration with discoverFiles)
// ─────────────────────────────────────────────────────────────────────────────

describe("discoverFiles — configKey on DiscoverPattern", () => {
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

	it("discovers config/app.ts as appConfig single with configKey", async () => {
		await write(
			"config/app.ts",
			"export default { locale: {}, access: {}, hooks: {}, context: () => ({}) };",
		);

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const appConfig = result.singles.get("appConfig");

		expect(appConfig).toBeDefined();
		expect(appConfig!.key).toBe("appConfig");
		expect(appConfig!.varName).toBe("_appConfig");
		expect(appConfig!.exportType).toBe("default");
		expect(appConfig!.configKey).toBe("app");
	});

	it("discovers config/auth.ts as authConfig single with configKey", async () => {
		await write("config/auth.ts", "export default {};");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const authConfig = result.singles.get("authConfig");

		expect(authConfig).toBeDefined();
		expect(authConfig!.key).toBe("authConfig");
		expect(authConfig!.varName).toBe("_authConfig");
		expect(authConfig!.exportType).toBe("default");
		expect(authConfig!.configKey).toBe("auth");
	});

	it("config/app.ts has configKey 'app' for config bucket emission", async () => {
		await write("config/app.ts", "export default {};");

		const result = await discoverFiles(rootDir, outDir, coreDiscoverOptions());
		const appConfig = result.singles.get("appConfig");

		expect(appConfig).toBeDefined();
		expect(appConfig!.configKey).toBe("app");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Template *Config → base key mapping
// ─────────────────────────────────────────────────────────────────────────────

describe("generateTemplate — config bucket emission", () => {
	it("authConfig with configKey emits into config bucket", () => {
		const result = makeFullDiscoveryResult({
			singles: [
				{
					key: "authConfig",
					varName: "_authConfig",
					exportType: "default",
					configKey: "auth",
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

		// authConfig should be emitted inside config bucket
		expect(code).toContain("config: {");
		expect(code).toContain("auth: _authConfig,");
		// Should NOT emit "authConfig:" as a flat createApp key
		expect(code).not.toMatch(/\bauthConfig:\s*_authConfig\s+as\s+any/);
	});

	it("appConfig with configKey emits as whole object into config bucket", () => {
		const result = makeFullDiscoveryResult({
			singles: [
				{
					key: "appConfig",
					varName: "_appConfig",
					exportType: "default",
					configKey: "app",
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

		// appConfig should be emitted as whole object in config bucket
		expect(code).toContain("config: {");
		expect(code).toContain("app: _appConfig,");
	});

	it("multiple config singles are grouped in a single config bucket", () => {
		const result = makeFullDiscoveryResult({
			singles: [
				{
					key: "authConfig",
					varName: "_authConfig",
					exportType: "default",
					configKey: "auth",
				},
				{
					key: "appConfig",
					varName: "_appConfig",
					exportType: "default",
					configKey: "app",
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

		// Both should be inside config bucket
		expect(code).toContain("config: {");
		expect(code).toContain("auth: _authConfig,");
		expect(code).toContain("app: _appConfig,");
	});

	it("non-config singles are emitted as flat keys alongside config bucket", () => {
		const result = makeFullDiscoveryResult({
			singles: [
				{
					key: "appConfig",
					varName: "_appConfig",
					exportType: "default",
					configKey: "app",
				},
				{ key: "fields", varName: "_fields", exportType: "default" },
			],
		});

		const code = generateTemplate({
			configImportPath: "../questpie.config",
			discovered: result,
			categories: coreCategories(),
			singletonFactories: coreSingletonFactories(),
			discoverPatterns: coreDiscoverPatterns(),
		});

		// config bucket for configKey singles
		expect(code).toContain("config: {");
		expect(code).toContain("app: _appConfig,");
		// fields as flat key
		expect(code).toContain("fields: _fields,");
	});
});
