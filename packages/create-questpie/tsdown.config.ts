import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts"],
	outDir: "dist",
	format: ["esm"],
	clean: true,
	shims: true,
	onSuccess: async () => {
		const { chmod } = await import("node:fs/promises");
		try {
			await chmod("dist/index.mjs", 0o755);
		} catch {
			// Ignore if file doesn't exist yet
		}
	},
});
