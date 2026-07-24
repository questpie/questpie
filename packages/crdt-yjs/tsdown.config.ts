import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		server: "src/exports/server.ts",
		client: "src/exports/client.ts",
		"worker-entry": "src/worker-entry.ts",
	},
	outDir: "dist",
	format: ["esm"],
	clean: true,
	dts: { sourcemap: false },
	shims: true,
	external: ["questpie/crdt", "yjs"],
	exports: {
		devExports: true,
		customExports: async (generated) =>
			Object.fromEntries(
				Object.entries(generated).filter(([key]) => key !== "./worker-entry"),
			),
	},
});
