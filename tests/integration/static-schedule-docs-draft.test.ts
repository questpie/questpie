import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const repositoryRoot = resolve(import.meta.dir, "../..");

test("compiles the exact candidate schedule guide against the Support Desk contract", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-schedule-docs-"));
	try {
		const fixture = resolve(repositoryRoot, "fixtures/team-support-desk");
		await cp(fixture, root, { recursive: true });
		const draft = await readFile(
			resolve(
				repositoryRoot,
				"docs/v4/research/static-job-schedules/PUBLIC-GUIDE-DRAFT.md",
			),
			"utf8",
		);
		const snippets = [
			...draft.matchAll(/^```ts title="([^"]+)"\n([\s\S]*?)\n```/gm),
		];
		expect(snippets.map((snippet) => snippet[1])).toEqual([
			"src/memberships/sweep-seed.ts",
			"src/tickets/sla-sweep.ts",
		]);
		for (const snippet of snippets) {
			const path = snippet[1]!;
			const source = `${snippet[2]}\n`;
			expect(source).toBe(await readFile(join(fixture, path), "utf8"));
			await writeFile(join(root, path), source);
		}
		const compilation = await compileApplication({ applicationRoot: root });
		const schedules = JSON.parse(
			compilation.generatedFiles["job-schedules.json"]!,
		);
		expect(schedules.schedules).toHaveLength(1);
		expect(schedules.schedules[0]).toMatchObject({
			jobIdentity: "job:ticket.sweepSla",
			principal: {
				kind: "service",
				id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7105",
			},
		});
		expect(JSON.parse(schedules.schedules[0].inputJson)).toEqual({});
	} finally {
		await rm(root, { force: true, recursive: true });
	}
}, 30_000);
