/**
 * @questpie/vite-plugin-iconify
 *
 * Vite plugin that scans source files for Iconify icon references
 * (e.g. "ph:check", "mdi:home", "tabler:star") and generates a
 * virtual module that preloads only the used icons via addCollection().
 *
 * Works with ANY icon set from @iconify/json. Supports HMR —
 * adding a new icon triggers automatic rebundle.
 *
 * Usage:
 *   import { iconifyPreload } from "@questpie/vite-plugin-iconify";
 *   // vite.config.ts
 *   plugins: [iconifyPreload({ scan: ["src/**\/*.{ts,tsx}"] })]
 *
 *   // entry point (e.g. app.tsx or client.ts)
 *   import "virtual:iconify-preload";
 */
import { existsSync, globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { type Plugin, type ResolvedConfig, createFilter } from "vite";

const require = createRequire(import.meta.url);

export interface IconifyPreloadOptions {
	/**
	 * Glob patterns for files to scan for icon references.
	 * @default ["src\/**\/*.{ts,tsx,js,jsx}"]
	 */
	scan?: string[];

	/**
	 * Extra icon names to always include (for truly dynamic icons).
	 * @example ["ph:spinner", "ph:spinner-gap"]
	 */
	include?: string[];
}

const VIRTUAL_ID = "virtual:iconify-preload";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

// Match "prefix:icon-name" patterns — prefix is 2+ lowercase chars, name is lowercase+digits+hyphens
const ICON_REF_RE = /["'`]([a-z]{2,}:[a-z0-9][a-z0-9-]*)["'`]/g;

// Prefixes that are definitely NOT icon references
const IGNORE_PREFIXES = new Set([
	"http",
	"https",
	"data",
	"var",
	"oklch",
	"from",
	"node",
	"workspace",
	"npm",
	"bun",
	"file",
	"env",
]);

type IconSet = {
	prefix: string;
	icons: Record<string, { body: string; width?: number; height?: number }>;
	aliases?: Record<string, { parent: string }>;
	width?: number;
	height?: number;
};

export function iconifyPreload(options: IconifyPreloadOptions = {}): Plugin {
	const { scan = ["src/**/*.{ts,tsx,js,jsx}"], include = [] } = options;

	let config: ResolvedConfig;
	let filter: (id: string) => boolean;
	let iconJsonDir: string;

	// Cache loaded icon set JSONs
	const iconSetCache = new Map<string, IconSet | null>();

	function loadIconSet(prefix: string): IconSet | null {
		if (iconSetCache.has(prefix)) return iconSetCache.get(prefix)!;

		const jsonPath = resolve(iconJsonDir, `${prefix}.json`);
		if (!existsSync(jsonPath)) {
			iconSetCache.set(prefix, null);
			return null;
		}

		const data = JSON.parse(readFileSync(jsonPath, "utf-8")) as IconSet;
		iconSetCache.set(prefix, data);
		return data;
	}

	function scanSources(): Map<string, Set<string>> {
		const byPrefix = new Map<string, Set<string>>();

		// Add explicit includes
		for (const ref of include) {
			const [prefix, name] = ref.split(":");
			if (!prefix || !name) continue;
			if (!byPrefix.has(prefix)) byPrefix.set(prefix, new Set());
			byPrefix.get(prefix)!.add(name);
		}

		// Scan matched files using Node 22+ globSync
		const files: string[] = [];
		for (const pattern of scan) {
			const matches = globSync(pattern, {
				cwd: config.root,
				exclude: (name: string) => name === "node_modules" || name === ".generated",
			});
			for (const f of matches) {
				files.push(resolve(config.root, f as unknown as string));
			}
		}

		for (const file of files) {
			const content = readFileSync(file, "utf-8");
			let match: RegExpExecArray | null;
			ICON_REF_RE.lastIndex = 0;

			while ((match = ICON_REF_RE.exec(content)) !== null) {
				const ref = match[1];
				const colonIdx = ref.indexOf(":");
				const prefix = ref.slice(0, colonIdx);
				const name = ref.slice(colonIdx + 1);

				if (IGNORE_PREFIXES.has(prefix)) continue;
				if (!loadIconSet(prefix)) continue;

				if (!byPrefix.has(prefix)) byPrefix.set(prefix, new Set());
				byPrefix.get(prefix)!.add(name);
			}
		}

		return byPrefix;
	}

	function generateModule(): string {
		const byPrefix = scanSources();
		const parts: string[] = [
			'import { addCollection } from "@iconify/react";',
		];

		let totalIcons = 0;

		for (const [prefix, names] of byPrefix) {
			const iconSet = loadIconSet(prefix);
			if (!iconSet) continue;

			const minimal: IconSet = {
				prefix: iconSet.prefix,
				icons: {},
				width: iconSet.width,
				height: iconSet.height,
			};

			for (const name of names) {
				if (iconSet.icons[name]) {
					minimal.icons[name] = iconSet.icons[name];
				} else if (iconSet.aliases?.[name]) {
					const parent = iconSet.aliases[name].parent;
					if (iconSet.icons[parent]) {
						minimal.icons[name] = iconSet.icons[parent];
					}
				}
			}

			const count = Object.keys(minimal.icons).length;
			if (count === 0) continue;

			totalIcons += count;
			parts.push(
				`// ${prefix}: ${count} icons`,
				`addCollection(${JSON.stringify(minimal)});`,
			);
		}

		if (totalIcons === 0) {
			parts.push("// No icons found");
		}

		// Log summary
		const summary = [...byPrefix.entries()]
			.filter(([p]) => loadIconSet(p))
			.map(([p, names]) => `${p}:${names.size}`)
			.join(", ");
		if (totalIcons > 0) {
			console.log(`[iconify-preload] Bundled ${totalIcons} icons (${summary})`);
		}

		return parts.join("\n");
	}

	return {
		name: "questpie:iconify-preload",
		enforce: "pre",

		configResolved(resolvedConfig) {
			config = resolvedConfig;
			filter = createFilter(scan, ["**/node_modules/**"]);
			// Resolve @iconify/json via require.resolve to handle monorepo hoisting
			try {
				const jsonPkg = require.resolve("@iconify/json/json/ph.json");
				iconJsonDir = resolve(jsonPkg, "..");
			} catch {
				iconJsonDir = resolve(config.root, "node_modules/@iconify/json/json");
			}
		},

		resolveId(id) {
			if (id === VIRTUAL_ID) return RESOLVED_ID;
		},

		load(id) {
			if (id === RESOLVED_ID) {
				return generateModule();
			}
		},

		handleHotUpdate({ file, server }) {
			if (!filter(file)) return;

			// A scanned file changed — invalidate the virtual module so icons are re-scanned
			const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
			if (mod) {
				server.moduleGraph.invalidateModule(mod);
				return [mod];
			}
		},
	};
}
