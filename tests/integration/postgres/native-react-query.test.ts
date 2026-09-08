import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const repository = resolve(import.meta.dir, "../../..");
const owned = /^[a-f0-9]{64}$/.test(
	process.env.QUESTPIE_NATIVE_QUERY_CONTAINER ?? "",
);

(owned ? test : test.skip)(
	"the public native adapter uses a verified PostgreSQL Runtime with live replacement and two-family refresh",
	async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "questpie-native-postgres-"),
		);
		try {
			await cp(join(repository, "fixtures/collaboration"), directory, {
				recursive: true,
				filter: (path) =>
					!path
						.split("/")
						.some((part) => part === "node_modules" || part === ".questpie"),
			});
			await mkdir(join(directory, "node_modules/@questpie"), {
				recursive: true,
			});
			for (const [name, target] of [
				["questpie", "node_modules/questpie"],
				["@tanstack", "node_modules/@tanstack"],
				["@types", "node_modules/@types"],
				["@questpie/compiler", "packages/compiler"],
				["@questpie/runtime", "packages/runtime"],
				["@questpie/testkit", "packages/testkit"],
			] as const)
				await symlink(
					join(repository, target),
					join(directory, "node_modules", name),
					"dir",
				);
			await symlink(
				join(directory, "packages/audit"),
				join(directory, "node_modules/@questpie/collaboration-audit"),
				"dir",
			);
			await compileApplication({ applicationRoot: directory });
			await cp(
				join(
					repository,
					"tests/support/native-query-cases/collaboration-postgres.case.ts",
				),
				join(directory, "native-postgres.test.ts"),
			);
			await writeFile(
				join(directory, "test-ids.ts"),
				`export { beta05Ids } from ${JSON.stringify(join(repository, "tests/integration/postgres/helpers/beta05-runtime"))};\n`,
			);
			await writeFile(
				join(directory, "tsconfig.native.json"),
				JSON.stringify({
					compilerOptions: {
						target: "ES2024",
						module: "ESNext",
						moduleResolution: "Bundler",
						strict: true,
						noEmit: true,
						skipLibCheck: true,
						noUncheckedIndexedAccess: true,
						lib: ["ES2024", "DOM", "DOM.Iterable"],
						types: ["bun"],
					},
					files: ["native-postgres.test.ts"],
				}),
			);
			const run = async (command: string[]) => {
				const child = Bun.spawn(command, {
					cwd: directory,
					stdout: "pipe",
					stderr: "pipe",
				});
				const [status, stdout, stderr] = await Promise.all([
					child.exited,
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
				]);
				const output = stdout + stderr;
				if (status !== 0)
					throw new Error(`Native PostgreSQL consumer failed:\n${output}`);
				return output;
			};
			await run([
				"bun",
				join(repository, "node_modules/typescript/bin/tsc"),
				"-p",
				join(directory, "tsconfig.native.json"),
			]);
			const output = await run([
				"bun",
				"test",
				"native-postgres.test.ts",
				"--timeout=120000",
			]);
			expect(output).toContain("2 pass");
			expect(output).toContain("39 expect() calls");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
	180_000,
);
