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
	external: ["bun"],
	unbundle: true,
	exports: {
		// Export all files including internal chunks so TypeScript can resolve
		// type references from internal .d.mts files
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
				"./cli": "./dist/cli.d.mts",
				"./client": "./dist/client.d.mts",
				"./shared": "./dist/shared.d.mts",
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
	onSuccess: async () => {
		// Make CLI executable
		const { chmod } = await import("node:fs/promises");
		try {
			// The output path depends on the file structure preservation
			// standard tsdown/rolldown behavior usually preserves structure if using globs
			// or we might find it flattened. Let's assume structure is preserved for now
			// or check dist/cli/index.js
			await chmod("dist/cli.mjs", 0o755);
			console.log("✅ Made CLI executable");
		} catch (error) {
			// It might be flat if not preserving structure, but multiple entries usually imply splitting or structure.
			// If flat, it might be dist/index.js (from cli/index.ts).
			// But we have multiple files.
			console.warn("⚠️  Could not make CLI executable:", error);
		}
	},
});
