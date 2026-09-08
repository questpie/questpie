import { expect, test } from "bun:test";
import { join } from "node:path";

import { instrumentClient } from "./render-projection";
import { resources } from "./task-contract.fixture";

test("proof instrumentation refuses a changed renderer seam", () => {
	expect(() =>
		instrumentClient("export const incompatible = true;", resources),
	).toThrow("PROOF_RENDERER_SEAM_CHANGED");
});

test("instrumented core client bundles for browsers without React or TanStack runtime imports", async () => {
	const dependencies: string[] = [];
	const build = await Bun.build({
		entrypoints: [join(import.meta.dir, "generated/client.ts")],
		target: "browser",
		plugins: [
			{
				name: "record-runtime-dependencies",
				setup(builder) {
					builder.onResolve({ filter: /.*/ }, (args) => {
						dependencies.push(args.path);
					});
				},
			},
		],
	});
	expect(build.success).toBe(true);
	expect(
		dependencies.filter((path) => /@tanstack|(^|\/)react($|\/)/.test(path)),
	).toEqual([]);
	expect(build.outputs[0]!.size).toBeGreaterThan(0);
});
