import { defineConfig } from "tsdown";

export default defineConfig({
	entry: [
		"src/exports/*.ts",
		"src/exports/modules/*.ts",
		"src/exports/client/modules/*.ts",
	],
	outDir: "dist",
	format: ["esm"],
	clean: true,
	copy: [
		{
			from: "src/server/modules/ai/lib/codex-bridge/*",
			to: "dist/codex-bridge",
		},
	],
	dts: {
		sourcemap: false,
	},
	exports: {
		devExports: true,
		customExports: async (generatedExports) => {
			const exportsWithTypes: Record<
				string,
				string | { types: string; default: string }
			> = {};

			for (const [key, value] of Object.entries(generatedExports)) {
				if (typeof value === "string") {
					const dtsPath = value
						.replace(/\.mjs$/, ".d.mts")
						.replace(/^\.\/dist\//, "./dist/");
					exportsWithTypes[key] = {
						types: dtsPath,
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
