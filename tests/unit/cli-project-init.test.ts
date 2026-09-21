import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../../packages/questpie/cli/questpie.ts");

test("init preserves dependencies and refuses to overwrite an existing application", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-init-"));
	try {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "my-app",
				private: true,
				dependencies: { questpie: "file:../questpie.tgz" },
				scripts: { test: "bun test" },
			}),
		);
		const invoke = () =>
			Bun.spawnSync(["bun", cli, "init", "--name", "barbershopSupport"], {
				cwd: root,
				stdout: "pipe",
				stderr: "pipe",
			});
		const first = invoke();
		expect(first.exitCode, first.stderr.toString()).toBe(0);
		const manifest = JSON.parse(
			await readFile(join(root, "package.json"), "utf8"),
		);
		expect(manifest.dependencies.questpie).toBe("file:../questpie.tgz");
		expect(manifest.scripts.test).toBe("bun test");
		expect(manifest.imports["#questpie/app"]).toBe(
			"./.questpie/generated/app.ts",
		);
		expect(
			JSON.parse(await readFile(join(root, "questpie.json"), "utf8"))
				.application.name,
		).toBe("barbershopSupport");
		await writeFile(join(root, "questpie.json"), "user work\n");
		expect(invoke().exitCode).not.toBe(0);
		expect(await readFile(join(root, "questpie.json"), "utf8")).toBe(
			"user work\n",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("init rejects invalid names and conflicting generated import maps before writing", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-init-conflict-"));
	try {
		const manifest = JSON.stringify({
			imports: { "#questpie/app": "./owned.ts" },
		});
		await writeFile(join(root, "package.json"), manifest);
		for (const name of [
			"../escape",
			"public",
			"pgAdmin",
			"questpieDemo",
			"a" + "A".repeat(62),
			"validName",
		]) {
			const result = Bun.spawnSync(["bun", cli, "init", "--name", name], {
				cwd: root,
				stdout: "pipe",
				stderr: "pipe",
			});
			expect(result.exitCode).not.toBe(0);
			expect(await Bun.file(join(root, "questpie.json")).exists()).toBe(false);
			expect(await readFile(join(root, "package.json"), "utf8")).toBe(manifest);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
