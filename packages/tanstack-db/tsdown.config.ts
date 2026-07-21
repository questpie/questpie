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
	unbundle: true,
	exports: {
		all: true,
		devExports: true,
	},
	external: [
		"questpie",
		"questpie/client",
		"@tanstack/react-query",
		"@tanstack/react-db",
		"@tanstack/query-db-collection",
		"@tanstack/db",
	],
});
