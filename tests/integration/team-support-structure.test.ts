import { expect, test } from "bun:test";
import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixture = resolve(import.meta.dir, "../../fixtures/team-support-desk");

test("builds the documented Support Desk web entry without tracer dependencies", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-web-structure-"));
	try {
		await cp(fixture, root, { recursive: true });
		await compileApplication({ applicationRoot: root });
		const result = await Bun.build({
			entrypoints: [resolve(root, "web/main.tsx")],
			target: "browser",
			format: "esm",
			plugins: [
				{
					name: "assert-product-web-boundary",
					setup(builder) {
						builder.onLoad({ filter: /\/tracer\//, namespace: "file" }, () => {
							throw new Error("Product web entry depends on tracer code");
						});
					},
				},
			],
		});
		expect(
			result.success,
			result.logs.map((log) => log.message).join("\n"),
		).toBe(true);
		expect(result.outputs).toHaveLength(1);
		const javascript = await result.outputs[0]!.text();
		expect(javascript).not.toContain("/__team_support/report");
		expect(javascript).not.toContain("tracerPersona");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);

test("keeps every local README navigation target available", async () => {
	const readme = await readFile(resolve(fixture, "README.md"), "utf8");
	const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
		.map((match) => match[1]!)
		.filter((path) => !path.includes(":") && !path.startsWith("#"));
	expect(links.length).toBeGreaterThan(0);
	for (const path of links) await access(resolve(fixture, path.split("#")[0]!));
});
