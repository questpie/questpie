import { expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const repositoryRoot = resolve(import.meta.dir, "../..");

test("compiles the retained Collaboration Reaction example against its application contract", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-durable-docs-"));
	try {
		await cp(resolve(repositoryRoot, "fixtures/collaboration"), root, {
			recursive: true,
		});
		const compilation = await compileApplication({ applicationRoot: root });
		expect(compilation.generatedFiles["app.ts"]).toContain(
			'"messagePublished": "deliver-message"',
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
}, 30_000);
