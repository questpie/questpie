/**
 * `questpie dev` must assemble its codegen plugin list the same way
 * `questpie generate` does.
 *
 * Two code paths built that list and had drifted. `generateCommand` runs the
 * `extractModulePlugins()` pre-pass over `modules.ts`; `devCommand` did not —
 * it built the watch graph from `[core, ...userPlugins]` and every debounced
 * regeneration from `userPlugins` alone. Scaffolded apps declare no `plugins`
 * in `runtimeConfig()`, so module-contributed plugins arrive exclusively
 * through `modules.ts`, which meant every watch-triggered regeneration ran
 * core-only.
 *
 * That is destructive rather than merely incomplete: `writeGeneratedFiles`
 * does `rm -rf outDir` before writing, so the first save after `questpie dev`
 * started replaced a complete `.generated` with one missing the
 * views/components/blocks categories and the collection extensions — and
 * reported no error.
 *
 * This asserts the invariant that broke: a project whose only plugin source is
 * `modules.ts` must resolve to more than the core target.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	coreCodegenPlugin,
	resolveTargetGraph,
} from "../../src/cli/codegen/index.js";
import { extractModulePlugins } from "../../src/cli/commands/codegen.js";

const CITY_PORTAL = resolve(
	import.meta.dir,
	"../../../../examples/city-portal/src/questpie/server",
);

describe("dev and generate resolve the same plugin list", () => {
	it("modules.ts contributes plugins that config.plugins does not", async () => {
		// The app declares none in runtimeConfig — this is the scaffolded shape.
		const fromConfigOnly: never[] = [];

		const merged = await extractModulePlugins(CITY_PORTAL, fromConfigOnly, {
			configPath: "questpie.config.ts",
		});

		expect(merged.length).toBeGreaterThan(fromConfigOnly.length);
		expect(merged.map((p) => p.name)).toContain("questpie-admin");
	});

	it("the merged list resolves targets the core-only list does not", async () => {
		const merged = await extractModulePlugins(CITY_PORTAL, [], {
			configPath: "questpie.config.ts",
		});

		const coreOnly = resolveTargetGraph([coreCodegenPlugin()]);
		const withModules = resolveTargetGraph([coreCodegenPlugin(), ...merged]);

		const ids = (g: ReturnType<typeof resolveTargetGraph>) =>
			[...g.keys()].sort();

		// This is the concrete regression: dev saw ["server"], generate saw
		// ["server", "admin-client"].
		expect(ids(withModules).length).toBeGreaterThan(ids(coreOnly).length);
		expect(ids(withModules)).toContain("admin-client");
	});

	/**
	 * The two tests above pin the PREMISE — that modules.ts contributes targets
	 * core-only resolution misses. They do not pin the call site: re-breaking
	 * devCommand by passing `userPlugins` again would leave them green, because
	 * neither runs devCommand.
	 *
	 * Driving devCommand for real means starting a file watcher, so this is a
	 * source-level guard instead. It is narrow on purpose: it only asserts that
	 * the watch path does not hand runAllTargets the un-merged list.
	 */
	it("devCommand does not regenerate from the un-merged plugin list", () => {
		const src = readFileSync(
			resolve(import.meta.dir, "../../src/cli/commands/codegen.ts"),
			"utf8",
		);
		const dev = src.slice(src.indexOf("export async function devCommand"));
		const body = dev.slice(0, dev.indexOf("\nexport "));

		expect(body).toContain("extractModulePlugins(");

		// `plugins: userPlugins` legitimately appears once, renaming the field
		// out of loadConfigForCodegen's result. A second occurrence means it is
		// being passed somewhere — which is the bug.
		const uses = body.match(/plugins:\s*userPlugins\b/g) ?? [];
		expect(uses.length).toBe(1);
	});
});
