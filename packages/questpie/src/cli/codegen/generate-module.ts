/**
 * Module Codegen Helper
 *
 * Convenience function for generating module definitions from individual files.
 * Used by npm packages during build to generate `.generated/module.ts`.
 *
 * @example
 * ```ts
 * // packages/questpie/scripts/generate-modules.ts
 * import { generateModule } from "./src/cli/codegen/generate-module";
 *
 * await generateModule({
 *   moduleName: "questpie-starter",
 *   rootDir: "./src/server/modules/starter",
 * });
 * ```
 *
 * @see RFC-MODULE-ARCHITECTURE §9.2 (Module — .generated/module.ts)
 */

import { join } from "node:path";

import { runCodegen } from "./index.js";
import type { CodegenPlugin, CodegenResult } from "./types.js";

export interface GenerateModuleOptions {
	/** Module name (e.g. "questpie-starter", "questpie-admin"). */
	moduleName: string;
	/** Absolute path to the module root directory (containing collections/, routes/, etc.). */
	rootDir: string;
	/**
	 * Output directory for generated file.
	 * @default `${rootDir}/.generated`
	 */
	outDir?: string;
	/**
	 * Output filename.
	 * @default "module.ts"
	 */
	outputFile?: string;
	/** Codegen plugins to run. */
	plugins?: CodegenPlugin[];
	/** If true, don't write files — just return the generated code. */
	dryRun?: boolean;
}

/**
 * Generate a `.generated/module.ts` file for an npm package module.
 *
 * This runs codegen in module mode: discovers entities from the file system
 * and generates a static module definition object (no runtime config, no createApp).
 */
export async function generateModule(
	options: GenerateModuleOptions,
): Promise<CodegenResult> {
	const {
		moduleName,
		rootDir,
		outDir = join(rootDir, ".generated"),
		outputFile = "module.ts",
		plugins = [],
		dryRun,
	} = options;

	return runCodegen({
		rootDir,
		// configPath is not used in module mode, but required by the interface
		configPath: join(rootDir, "questpie.config.ts"),
		outDir,
		plugins,
		dryRun,
		module: {
			name: moduleName,
			outputFile,
		},
	});
}
