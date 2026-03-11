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
		customExports: async (generatedExports) => {
			const exportsWithTypes: Record<
				string,
				string | { types: string; default: string }
			> = {
				...generatedExports,
			};

			const typedEntries: Record<string, string> = {
				".": "./dist/index.d.mts",
			};

			for (const [entry, typesPath] of Object.entries(typedEntries)) {
				const current = generatedExports[entry];
				if (typeof current === "string") {
					exportsWithTypes[entry] = {
						types: typesPath,
						default: current,
					};
				}
			}

			return exportsWithTypes;
		},
	},
});
