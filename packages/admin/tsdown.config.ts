import { glob } from "tinyglobby";
import { defineConfig } from "tsdown";

export default defineConfig({
	// Clean entry points from exports folder + lightweight plugin entry
	entry: [
		"src/exports/*.ts",
		"src/exports/modules/*.ts",
		"src/exports/client/modules/*.ts",
	],
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

	// React Compiler is intentionally NOT applied here.
	// Pre-compiling dist with react-compiler caches calls on stable-but-mutable
	// references from libraries like @tanstack/react-table (table.getSelectedRowModel())
	// and @tiptap/react (editor.isActive()), returning stale values across renders.
	// Consumers should run react-compiler over their own application code in Vite,
	// where dev/prod gating and library-specific opt-outs are easier to manage.

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
