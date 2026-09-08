import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { bundleApplicationEntry } from "../../packages/compiler/src/runtime/application-bundle";
import type { PackageInventory } from "../../packages/compiler/src/types";

function bundleSource(
	root: string,
	inventories: readonly PackageInventory[] = [],
) {
	return bundleApplicationEntry({
		entry: 'export * from "#questpie/source/source.ts";',
		applicationRoot: root,
		configuration: {
			$schema: "https://questpie.dev/schema/application-v1.json",
			version: 1,
			application: { name: "sourceConditions" },
			postgres: {
				schema: "source_conditions",
				minimumMajor: 16,
				databaseCollation: "C.UTF-8",
				databaseCType: "C.UTF-8",
				extensions: [],
				physicalNames: {},
			},
			source: { root: ".", exclude: [] },
			packages: {},
		},
		inventories,
		readinessEntry: "unused",
		runtimeCoreBundleEntry: "unused",
		runtimeRealtimeBundleEntry: "unused",
	});
}

test("application source preserves distinct package import and require conditions", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-source-conditions-"));
	try {
		const dependency = join(root, "node_modules/conditional");
		await mkdir(dependency, { recursive: true });
		await writeFile(
			join(dependency, "package.json"),
			JSON.stringify({
				name: "conditional",
				type: "module",
				exports: { import: "./import.js", require: "./require.cjs" },
			}),
		);
		await writeFile(join(dependency, "import.js"), 'export default "import";');
		await writeFile(
			join(dependency, "require.cjs"),
			'module.exports = "require";',
		);
		await writeFile(
			join(root, "source.ts"),
			'import imported from "conditional"; const required = require("conditional"); export const values = [imported, required];',
		);
		const baseline = await Bun.build({
			entrypoints: [join(root, "source.ts")],
			target: "bun",
			format: "esm",
		});
		expect(baseline.success).toBe(true);
		const baselineModule = await import(
			`data:text/javascript;base64,${Buffer.from(await baseline.outputs[0]!.text()).toString("base64")}`
		);
		expect(baselineModule.values).toEqual(["import", "require"]);
		const output = await bundleSource(root);
		const module = await import(
			`data:text/javascript;base64,${Buffer.from(output["internal/application.js"]!).toString("base64")}`
		);
		expect(module.values).toEqual(["import", "require"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("application imports use the activated Package entry before installed package exports", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-source-package-"));
	try {
		const installed = join(root, "node_modules/selected");
		await mkdir(installed, { recursive: true });
		await writeFile(
			join(installed, "package.json"),
			JSON.stringify({
				name: "selected",
				exports: { "./questpie": "./wrong.js" },
			}),
		);
		await writeFile(
			join(installed, "wrong.js"),
			'export const value = "unselected";',
		);
		const entry = join(root, "selected.ts");
		await writeFile(entry, 'export const value = "activated";');
		await writeFile(
			join(root, "source.ts"),
			'export { value } from "selected/questpie";',
		);
		const inventories: readonly PackageInventory[] = [
			{
				package: {
					id: "selected@1.0.0",
					name: "selected",
					version: "1.0.0",
					resolution: "workspace",
					integrity: null,
					commit: null,
					contentDigest: "fixture",
					root,
					entry,
				},
				entries: [],
				digest: "fixture",
			},
		];
		for (const [selection, expected] of [
			[[], "unselected"],
			[inventories, "activated"],
		] as const) {
			const output = await bundleSource(root, selection);
			const module = await import(
				`data:text/javascript;base64,${Buffer.from(output["internal/application.js"]!).toString("base64")}`
			);
			expect(module.value).toBe(expected);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("application executable import.meta describes the emitted Runtime module", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-source-meta-"));
	try {
		await writeFile(
			join(root, "source.ts"),
			"export const location = { url: import.meta.url, path: import.meta.path, dir: import.meta.dir };",
		);
		const output = await bundleSource(root);
		const path = join(root, "application.js");
		await writeFile(path, output["internal/application.js"]!);
		const module = await import(pathToFileURL(path).href);
		expect(module.location).toEqual({
			url: pathToFileURL(path).href,
			path,
			dir: dirname(path),
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
