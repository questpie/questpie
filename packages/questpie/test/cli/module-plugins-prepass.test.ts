/**
 * The modules.ts pre-pass must fail loudly.
 *
 * `extractModulePlugins()` used to catch every import failure, print it only
 * under --verbose, and return the config plugins as if nothing had happened.
 * That is not a partial build. `writeGeneratedFiles` does `rm -rf outDir`
 * first, so codegen then replaced a correct `.generated` with a core-only one
 * and exited 0. Every plugin category, collection extension and factory method
 * gone, no message. One unbuilt workspace dependency was enough.
 *
 * These pin the three ways that used to go quiet: an unimportable modules file,
 * a modules file with the wrong export shape, and a `.mts` modules file that
 * discovery reads but the pre-pass did not.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { CodegenPlugin } from "../../src/cli/codegen/types.js";
import { extractModulePlugins } from "../../src/cli/commands/codegen.js";

const OPTIONS = { configPath: "questpie.config.ts" };

/** Minimal stand-in for a plugin a module package would contribute. */
const CONFIG_PLUGIN = {
	name: "from-config",
	targets: {},
} as unknown as CodegenPlugin;

let tempDir: string | undefined;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

async function makeRoot(filename: string, source: string): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "questpie-prepass-"));
	await writeFile(join(tempDir, filename), source);
	return tempDir;
}

describe("modules.ts pre-pass", () => {
	it("throws when the modules file cannot be imported", async () => {
		// The real-world trigger: a dependency that has not been built yet.
		const rootDir = await makeRoot(
			"modules.ts",
			'import { missing } from "@questpie/not-installed-on-purpose";\n' +
				"export default [missing];\n",
		);

		const promise = extractModulePlugins(rootDir, [CONFIG_PLUGIN], OPTIONS);

		await expect(promise).rejects.toThrow(/Could not import/);
		// The message has to name the file and say why the build stopped.
		await expect(promise).rejects.toThrow(/modules\.ts/);
	});

	it("throws when the modules file has no array default export", async () => {
		const rootDir = await makeRoot(
			"modules.ts",
			"export const modules = [];\n",
		);

		await expect(
			extractModulePlugins(rootDir, [CONFIG_PLUGIN], OPTIONS),
		).rejects.toThrow(/default export/);
	});

	it("reads modules.mts, which discovery already accepts", async () => {
		const rootDir = await makeRoot(
			"modules.mts",
			'export default [{ name: "m", plugin: { name: "from-module", targets: {} } }];\n',
		);

		const merged = await extractModulePlugins(
			rootDir,
			[CONFIG_PLUGIN],
			OPTIONS,
		);

		expect(merged.map((p) => p.name)).toEqual(["from-config", "from-module"]);
	});

	it("passes the config plugins through when there is no modules file", async () => {
		// The root template raises the missing-modules.ts error, with a better
		// message than this function could give.
		tempDir = await mkdtemp(join(tmpdir(), "questpie-prepass-"));

		const merged = await extractModulePlugins(
			tempDir,
			[CONFIG_PLUGIN],
			OPTIONS,
		);

		expect(merged).toEqual([CONFIG_PLUGIN]);
	});

	it("rejects distinct config plugins sharing one name", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "questpie-prepass-"));
		const collision = {
			name: CONFIG_PLUGIN.name,
			targets: {},
		} as CodegenPlugin;

		await expect(
			extractModulePlugins(tempDir, [CONFIG_PLUGIN, collision], OPTIONS),
		).rejects.toThrow(/different plugins.*from-config/i);
	});

	it("rejects a module plugin colliding with a config plugin", async () => {
		const rootDir = await makeRoot(
			"modules.mts",
			'export default [{ name: "m", plugin: { name: "from-config", targets: {} } }];\n',
		);

		await expect(
			extractModulePlugins(rootDir, [CONFIG_PLUGIN], OPTIONS),
		).rejects.toThrow(/runtimeConfig.*modules\.ts/s);
	});

	/**
	 * A bare `C:\app\modules.ts` parses as a URL whose scheme is "c:", so the
	 * import throws ERR_UNSUPPORTED_ESM_URL_SCHEME and every Windows build lands
	 * in the catch above. No POSIX runner can reproduce a drive letter, so this
	 * is a source-level guard instead. It is the same approach
	 * dev-module-plugins takes for the call site it cannot drive.
	 */
	it("imports the modules file by file URL", () => {
		const src = readFileSync(
			resolve(import.meta.dir, "../../src/cli/commands/codegen.ts"),
			"utf8",
		);
		const fn = src.slice(
			src.indexOf("export async function extractModulePlugins"),
		);
		const body = fn.slice(0, fn.indexOf("\n}\n"));

		expect(body).toContain("toFileImportSpecifier(modulesPath)");
	});
});
