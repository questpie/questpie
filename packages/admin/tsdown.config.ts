import pluginBabel from "@rollup/plugin-babel";
import { glob } from "tinyglobby";
import { defineConfig } from "tsdown";

export default defineConfig({
	// Clean entry points from exports folder
	entry: ["src/exports/*.ts"],
	outDir: "dist",
	format: ["esm"],
	clean: true,

	treeshake: true,
	unbundle: true,
	dts: {
		sourcemap: false,
	},

	// Copy CSS files instead of bundling them
	copy: [{ from: "src/client/styles/**/*.css", to: "dist/client/styles" }],

	plugins: [
		pluginBabel({
			babelHelpers: "bundled",
			parserOpts: {
				sourceType: "module",
				plugins: ["jsx", "typescript"],
			},
			plugins: ["babel-plugin-react-compiler"],
			extensions: [".js", ".jsx", ".ts", ".tsx"],
		}),
	],

	exports: {
		// Export all files including internal chunks so TypeScript can resolve
		// type references from internal .d.mts files
		all: true,
		devExports: true,
		customExports: async (exports, opts) => {
			try {
				// Add CSS file exports
				const cssFiles = await glob("src/**/*.css");
				const cssExports: Record<string, string> = {};

				for (const file of cssFiles) {
					const normalizedFile = file.replace(/\\/g, "/");
					const exportKey = `./${normalizedFile.replace("src/", "")}`;
					const distPath = opts.isPublish
						? `./${normalizedFile.replace("src/", "dist/")}`
						: `./${normalizedFile}`;
					cssExports[exportKey] = distPath;
				}

				const mergedExports: Record<
					string,
					string | { types: string; default: string }
				> = {
					...exports,
					...cssExports,
				};

				const typedEntries: Record<string, string> = {
					".": "./dist/index.d.mts",
					"./client": "./dist/client.d.mts",
					"./server": "./dist/server.d.mts",
					"./shared": "./dist/shared.d.mts",
				};

				for (const [entry, typesPath] of Object.entries(typedEntries)) {
					const current = exports[entry];
					if (typeof current === "string") {
						mergedExports[entry] = {
							types: typesPath,
							default: current,
						};
					}
				}

				return {
					...mergedExports,
				};
			} catch (error) {
				console.error("Error generating custom exports:", error);
				return exports;
			}
		},
	},
});
