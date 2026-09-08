import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundleApplicationEntry } from "../../packages/compiler/src/runtime/application-bundle";

test("application source reads preserve inferred loaders, assets, and external imports", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-bundle-loaders-"));
	try {
		const sources = {
			"plain.js": 'export default "js";',
			"module.mjs": 'export default "mjs";',
			"common.cjs": 'module.exports = "cjs";',
			"typed.ts": 'const value: string = "ts"; export default value;',
			"module.mts": 'const value: string = "mts"; export default value;',
			"common.cts": 'const value: string = "cts"; module.exports = value;',
			"view.jsx":
				'/** @jsxRuntime classic */\n/** @jsx h */\nconst h = () => "jsx"; export default <piece />;',
			"view.tsx":
				'/** @jsxRuntime classic */\n/** @jsx h */\nconst h = (): string => "tsx"; export default <piece />;',
			"data.json": '"json"',
			"asset.txt": "asset",
		};
		for (const [name, source] of Object.entries(sources))
			await writeFile(join(root, name), source);
		const imports = Object.keys(sources).map(
			(name, index) =>
				`import value${index} from ${JSON.stringify(`#questpie/source/${name}`)};`,
		);
		const input = {
			applicationRoot: root,
			configuration: {
				$schema: "https://questpie.dev/schema/application-v1.json",
				version: 1,
				application: { name: "loaders" },
				postgres: {
					schema: "loaders",
					minimumMajor: 16,
					databaseCollation: "C.UTF-8",
					databaseCType: "C.UTF-8",
					extensions: [],
					physicalNames: {},
				},
				source: { root: ".", exclude: [] },
				packages: {},
			},
			inventories: [],
			readinessEntry: "unused",
			runtimeCoreBundleEntry: "unused",
			runtimeRealtimeBundleEntry: "unused",
		} as const;
		const entry = `${imports.join("\n")}\nexport default [${Object.keys(sources)
			.map((_, index) => `value${index}`)
			.join(",")}];`;
		const first = await bundleApplicationEntry({ ...input, entry });
		const second = await bundleApplicationEntry({ ...input, entry });
		expect(second).toEqual(first);
		const module = await import(
			`data:text/javascript;base64,${Buffer.from(first["internal/application.js"]!).toString("base64")}`
		);
		expect(module.default).toEqual([
			"js",
			"mjs",
			"cjs",
			"ts",
			"mts",
			"cts",
			"jsx",
			"tsx",
			"json",
			"asset",
		]);
		const external = await bundleApplicationEntry({
			...input,
			entry:
				'export { readFile } from "node:fs/promises"; export * from "questpie"; export * from "questpie/internal/observability";',
		});
		for (const specifier of [
			"fs/promises",
			"questpie",
			"questpie/internal/observability",
		])
			expect(external["internal/application.js"]).toContain(
				JSON.stringify(specifier),
			);
		await writeFile(
			join(root, "lazy.ts"),
			'export { default as value } from "./typed";',
		);
		const dynamicEntry =
			'export const read = () => import("#questpie/source/lazy.ts");';
		const dynamic = await bundleApplicationEntry({
			...input,
			entry: dynamicEntry,
		});
		const relocatedRoot = await mkdtemp(
			join(tmpdir(), "questpie-bundle-relocated-"),
		);
		try {
			await cp(root, relocatedRoot, { recursive: true });
			const relocated = await bundleApplicationEntry({
				...input,
				applicationRoot: relocatedRoot,
				entry: dynamicEntry,
			});
			expect(relocated).toEqual(dynamic);
		} finally {
			await rm(relocatedRoot, { recursive: true, force: true });
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
