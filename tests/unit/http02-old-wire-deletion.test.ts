import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { projectRuntimeContract } from "../../packages/compiler/src/runtime";

const repositoryRoot = resolve(import.meta.dir, "../..");

async function productionTypeScript(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const path = resolve(root, entry.name);
			if (entry.isDirectory()) return productionTypeScript(path);
			return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
		}),
	);
	return nested.flat();
}

test("projects one canonical HTTP contract without retained Operation Wire pairs", () => {
	const runtime = projectRuntimeContract({
		configuration: { application: { name: "http02" } } as never,
		resources: [],
		sourceGraph: [],
		contextProjection: { context: null },
	});

	expect(runtime.wire).toMatchObject({
		format: "questpie.operation-http",
		version: 1,
		application: "application:http02",
		operations: [],
	});
	expect(runtime.wire).not.toHaveProperty("path");
	expect(runtime.wire).not.toHaveProperty("compatibility");
});

test("production contains no deleted polymorphic route or compatibility kernel", async () => {
	const roots = [
		resolve(repositoryRoot, "packages/compiler/src"),
		resolve(repositoryRoot, "packages/runtime/src"),
	];
	const paths = (await Promise.all(roots.map(productionTypeScript))).flat();
	const offenders: string[] = [];
	for (const path of paths) {
		const source = await readFile(path, "utf8");
		if (
			source.includes("/_questpie/operation") ||
			source.includes("questpie.operation-wire")
		)
			offenders.push(path.slice(repositoryRoot.length + 1));
	}
	expect(offenders).toEqual([]);
});
