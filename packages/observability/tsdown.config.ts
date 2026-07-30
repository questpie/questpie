import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/exports/*.ts"],
	outDir: "dist",
	format: ["esm"],
	clean: true,
	dts: { sourcemap: false },
	exports: {
		devExports: true,
		customExports: async (generatedExports) => {
			const exportsWithTypes: Record<
				string,
				string | { types: string; default: string }
			> = {};
			for (const [key, value] of Object.entries(generatedExports)) {
				if (typeof value === "string") {
					exportsWithTypes[key] = {
						types: value.replace(/\.mjs$/, ".d.mts"),
						default: value,
					};
				} else {
					exportsWithTypes[key] = value;
				}
			}
			return exportsWithTypes;
		},
	},
	shims: true,
});
