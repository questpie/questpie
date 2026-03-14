import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/server.ts", "src/plugin.ts"],
	outDir: "dist",
	format: ["esm"],
	clean: true,
	dts: {
		sourcemap: false,
	},
	exports: false,
	shims: true,
});
