import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/exports/*.ts"],
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
