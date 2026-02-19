import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/server.ts"],
	outDir: "dist",
	format: ["esm"],
	clean: true,
	dts: {
		sourcemap: false,
	},
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
					types: "./dist/server.d.mts",
					default: current,
				};
			}

			return exportsWithTypes;
		},
	},
	shims: true,
});
