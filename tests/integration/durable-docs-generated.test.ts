import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const repositoryRoot = resolve(import.meta.dir, "../..");

test("compiles the exact public Reaction example against its application contract", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-durable-docs-"));
	try {
		await cp(resolve(repositoryRoot, "fixtures/collaboration"), root, {
			recursive: true,
		});
		const documentation = await readFile(
			resolve(
				repositoryRoot,
				"apps/docs/content/docs/v4/durable-reactions.mdx",
			),
			"utf8",
		);
		const example = /^```ts title="[^"]+"\n([\s\S]*?)\n```/m.exec(
			documentation,
		)?.[1];
		if (!example) throw new Error("missing documented Reaction example");
		await writeFile(join(root, "src/message-published.ts"), `${example}\n`);
		const compilation = await compileApplication({ applicationRoot: root });
		expect(compilation.generatedFiles["app.ts"]).toContain(
			'"messagePublished": "deliver-message"',
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
}, 30_000);
