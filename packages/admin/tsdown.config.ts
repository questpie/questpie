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
  dts: true,

  // Copy CSS files instead of bundling them
  copy: [{ from: "src/client/styles/**/*.css", to: "dist/client/styles" }],

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

        return {
          ...exports,
          ...cssExports,
        };
      } catch (error) {
        console.error("Error generating custom exports:", error);
        return exports;
      }
    },
  },
});
