/**
 * Package mode builds its own output paths, so it needs its own collision check.
 *
 * `assertDistinctOutputDirs` compares `root + outDir`, which is app geometry.
 * Package mode ignores `root` and writes to `<moduleDir>/<moduleRoot>/<outDir>`,
 * so two targets with different roots and no `moduleRoot` pass the graph check
 * and then land in the same directory. `writeGeneratedFiles` does `rm -rf` on
 * that directory first, so the second target erased the first with no message.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateCommand } from "../../src/cli/commands/codegen.js";

const QUESTPIE_SRC = join(import.meta.dir, "../../src");

let root: string;

/**
 * Write a package whose config declares one extra target. `moduleRoot` decides
 * whether that target collides with the built-in server target.
 */
async function writePackage(moduleRoot: string | undefined): Promise<void> {
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ name: "probe-pkg", version: "0.0.0" }),
		"utf-8",
	);
	await mkdir(join(root, "src/modules/thing/collections"), { recursive: true });
	await writeFile(
		join(root, "src/modules/thing/collections/widget.ts"),
		"export default { name: 'widget' };\n",
		"utf-8",
	);
	await writeFile(
		join(root, "questpie.config.ts"),
		[
			`import { packageConfig } from ${JSON.stringify(`${QUESTPIE_SRC}/exports/cli.ts`)};`,
			"",
			"const altPlugin = {",
			'\tname: "alt-plugin",',
			"\ttargets: {",
			"\t\talt: {",
			// A different root keeps the graph-level check happy: "./.generated"
			// and "../alt/.generated" are distinct directories for an app.
			'\t\t\troot: "../alt",',
			'\t\t\toutputFile: "alt.ts",',
			moduleRoot ? `\t\t\tmoduleRoot: ${JSON.stringify(moduleRoot)},` : "",
			"\t\t\tcategories: {},",
			"\t\t},",
			"\t},",
			"};",
			"",
			"export default packageConfig({",
			'\tmodulesDir: "src/modules",',
			"\tplugins: [altPlugin],",
			"});",
		]
			.filter(Boolean)
			.join("\n"),
		"utf-8",
	);
}

describe("package mode — one output directory per target", () => {
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "questpie-pkg-outdirs-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("throws when two targets resolve to the same module directory", async () => {
		await writePackage(undefined);

		const run = generateCommand({
			configPath: join(root, "questpie.config.ts"),
			dryRun: true,
		});

		await expect(run).rejects.toThrow(/both write module output to/);
	});

	it("allows two targets that a moduleRoot keeps apart", async () => {
		await writePackage("alt");
		await mkdir(join(root, "src/modules/thing/alt"), { recursive: true });

		await generateCommand({
			configPath: join(root, "questpie.config.ts"),
			dryRun: true,
		});
	});
});
