import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { copyRuntimeSourceDeclarations } from "../../packages/runtime/scripts/copy-source-declarations";

test("Runtime build copies every source declaration with exact bytes", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-runtime-types-"));
	const source = join(root, "src");
	const output = join(root, "dist");
	try {
		await Bun.write(
			join(source, "bundle-core-types.d.ts"),
			"export type A = 1;\n",
		);
		await Bun.write(
			join(source, "postgres", "contract-types.d.ts"),
			"export declare const brand: unique symbol;\n",
		);
		await Bun.write(join(source, "postgres", "ignored.ts"), "export {};\n");

		await expect(
			copyRuntimeSourceDeclarations(source, output),
		).resolves.toEqual([
			"bundle-core-types.d.ts",
			"postgres/contract-types.d.ts",
		]);
		expect(await Bun.file(join(output, "bundle-core-types.d.ts")).text()).toBe(
			"export type A = 1;\n",
		);
		expect(
			await Bun.file(join(output, "postgres", "contract-types.d.ts")).text(),
		).toBe("export declare const brand: unique symbol;\n");
		expect(
			await Bun.file(join(output, "postgres", "ignored.ts")).exists(),
		).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
