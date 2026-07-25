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
	exports: {
		devExports: true,
		customExports: async (generatedExports, { isPublish }) => {
			const exportsWithTypes: Record<
				string,
				string | { types: string; default: string }
			> = { ...generatedExports };
			const current = generatedExports["."];
			if (typeof current === "string") {
				exportsWithTypes["."] = {
					types: isPublish ? "./dist/index.d.mts" : "./src/exports/index.ts",
					default: current,
				};
			}
			return exportsWithTypes;
		},
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
