import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts"],
	outDir: "dist",
	format: ["esm"],
	clean: true,
	dts: {
		sourcemap: false,
	},
	shims: true,
	exports: {
		devExports: true,
		customExports: async (generatedExports) => {
			const exportsWithTypes: Record<
				string,
				string | { types: string; default: string }
			> = {
				...generatedExports,
			};

			const current = generatedExports["."];
			if (typeof current === "string") {
				exportsWithTypes["."] = {
					types: "./dist/index.d.mts",
					default: current,
				};
			}

			return exportsWithTypes;
		},
	},
	external: ["questpie", "questpie/client", "@tanstack/react-query"],
});
