import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/exports/*.ts"],
  outDir: "dist",
  format: ["esm"],
  clean: true,
  dts: true,
  shims: true,
  external: ["bun"],
  unbundle: true,
  exports: {
    // Export all files including internal chunks so TypeScript can resolve
    // type references from internal .d.mts files
    all: true,
    devExports: true,
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
