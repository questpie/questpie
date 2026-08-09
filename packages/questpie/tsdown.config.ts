import { defineConfig } from "tsdown";

/**
 * Modules that only exist in the export map so that declaration files can name
 * them.
 *
 * Types inferred from the public builders mention a handful of internal
 * modules. When a downstream package builds its own declarations, it has to
 * write an import for each of those, and it can only write specifiers the
 * export map accepts. If it cannot name one, the whole type collapses to
 * `undefined` in the published output, silently.
 *
 * These entries are declared under the `types` condition alone, so a
 * declaration file can point at them and nothing can import them at runtime.
 *
 * Keep the list short. A new entry means a type escaped a public entry point,
 * and re-exporting it from `src/exports/*` is the better fix.
 */
const internalTypeModules = [
	"server/collection/builder/types",
	"server/collection/crud/types",
	"server/modules/core/fields/index",
	"server/modules/core/fields/json",
];

export default defineConfig({
	// Public package entrypoints are declared here. Keep optional/heavy adapter
	// entrypoints under src/exports/adapters/* so they compile to
	// questpie/adapters/<name> instead of expanding the root barrel.
	entry: [
		"src/exports/*.ts",
		"src/exports/adapters/*.ts",
		"src/exports/internal/*.ts",
		"src/exports/modules/*.ts",
	],
	outDir: "dist",
	format: ["esm"],
	clean: true,
	dts: {
		sourcemap: false,
	},
	shims: true,
	external: ["bun"],
	// One output file per source file. The internal type modules above are
	// published subpaths, so they need a stable path in dist.
	unbundle: true,
	exports: {
		devExports: true,
		customExports: async (exports, { isPublish }) => ({
			...exports,
			...Object.fromEntries(
				internalTypeModules.map((id) => [
					`./internal/${id}`,
					{ types: isPublish ? `./dist/${id}.d.mts` : `./src/${id}.ts` },
				]),
			),
		}),
	},
	onSuccess: async () => {
		// Make CLI executable
		const { chmod } = await import("node:fs/promises");
		try {
			await chmod("dist/cli.mjs", 0o755);
			console.log("✅ Made CLI executable");
		} catch (error) {
			console.warn("⚠️  Could not make CLI executable:", error);
		}
	},
});
