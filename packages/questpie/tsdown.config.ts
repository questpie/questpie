import { defineConfig } from "tsdown";

export default defineConfig({
	// Public package entrypoints are declared here. Keep optional/heavy adapter
	// entrypoints under src/exports/adapters/* so they compile to
	// questpie/adapters/<name> instead of expanding the root barrel.
	entry: [
		"src/exports/*.ts",
		"src/exports/adapters/*.ts",
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
	unbundle: true,
	exports: {
		// Export all files including internal chunks so TypeScript can resolve
		// type references from internal .d.mts files
		all: true,
		devExports: true,
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
