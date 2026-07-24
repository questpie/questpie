import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/exports/*.ts"],
	outDir: "dist",
	format: ["esm"],
	clean: true,
	dts: { sourcemap: false },
	shims: true,
	external: ["questpie/crdt", "yjs"],
	exports: {
		devExports: true,
	},
});
