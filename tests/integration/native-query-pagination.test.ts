import { expect, test } from "bun:test";
import { copyFile, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const repository = resolve(import.meta.dir, "../..");

test("production-generated Support Desk retains native forward paging and hydration regressions", async () => {
	const directory = await mkdtemp(
		join(tmpdir(), "questpie-native-pagination-"),
	);
	try {
		await symlink(
			join(repository, "node_modules"),
			join(directory, "node_modules"),
			"dir",
		);
		await writeFile(
			join(directory, "package.json"),
			JSON.stringify({
				type: "module",
				imports: { "#questpie/test-pagination": "./generated/client.ts" },
			}),
		);
		await compileApplication({
			applicationRoot: join(repository, "fixtures/team-support-desk"),
			outputDirectory: join(directory, "generated"),
		});
		for (const [source, target] of [
			["infinite-query.case.ts", "infinite-query.test.ts"],
			["infinite-consumer.types.ts", "infinite-consumer.types.ts"],
		])
			await copyFile(
				join(repository, "tests/support/native-query-cases", source!),
				join(directory, target!),
			);
		await writeFile(
			join(directory, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					target: "ES2024",
					module: "ESNext",
					moduleResolution: "Bundler",
					lib: ["ES2024", "DOM"],
					types: ["bun"],
					strict: true,
					noUncheckedIndexedAccess: true,
					skipLibCheck: true,
					noEmit: true,
					paths: {
						"#questpie/app": [join(directory, "generated/app.ts")],
						"#questpie/source/*": [
							join(repository, "fixtures/team-support-desk/src/*"),
						],
					},
				},
				files: ["infinite-query.test.ts", "infinite-consumer.types.ts"],
			}),
		);
		for (const command of [
			[
				"bun",
				join(repository, "node_modules/typescript/bin/tsc"),
				"-p",
				"tsconfig.json",
				"--pretty",
				"false",
			],
			["bun", "test", "infinite-query.test.ts"],
		]) {
			const run = Bun.spawn(command, {
				cwd: directory,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [status, stdout, stderr] = await Promise.all([
				run.exited,
				new Response(run.stdout).text(),
				new Response(run.stderr).text(),
			]);
			expect(status, stdout + stderr).toBe(0);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 120_000);
