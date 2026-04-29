import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scaffold } from "../src/scaffolder";

let tempDir: string | undefined;
const originalCwd = process.cwd();

afterEach(async () => {
	process.chdir(originalCwd);
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

describe("scaffold", () => {
	test("creates a runnable project shell with env, scripts, and agent skills", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "create-questpie-"));
		process.chdir(tempDir);

		await scaffold({
			projectName: "smoke-app",
			templateId: "tanstack-start",
			databaseName: "smoke_app",
			installDeps: false,
			initGit: false,
			installSkills: true,
			runCodegen: false,
		});

		const projectDir = join(tempDir, "smoke-app");
		const packageJson = JSON.parse(
			await readFile(join(projectDir, "package.json"), "utf-8"),
		);
		const env = await readFile(join(projectDir, ".env"), "utf-8");
		const dockerCompose = await readFile(
			join(projectDir, "docker-compose.yml"),
			"utf-8",
		);

		expect(existsSync(join(projectDir, ".gitignore"))).toBe(true);
		expect(existsSync(join(projectDir, "gitignore"))).toBe(false);
		expect(existsSync(join(projectDir, ".env.example"))).toBe(true);
		expect(existsSync(join(projectDir, "env.example"))).toBe(false);
		expect(env).toContain("DATABASE_URL=postgresql://smoke_app:");
		expect(env).toContain("@localhost:5432/smoke_app");
		expect(env).toContain("BETTER_AUTH_SECRET=");
		expect(env).not.toContain("{{");
		expect(dockerCompose).not.toContain("{{");

		expect(packageJson.scripts["questpie:generate"]).toBe(
			"questpie generate -c src/questpie/server/questpie.config.ts",
		);
		expect(packageJson.scripts["routes:generate"]).toBe("tsr generate");
		expect(packageJson.scripts["scaffold:generate"]).toBe(
			"bun run routes:generate && bun run questpie:generate",
		);
		expect(packageJson.scripts["scaffold:verify"]).toBe(
			"bun run scaffold:generate && bun run check-types",
		);
		expect(packageJson.scripts.migrate).toBe(
			"questpie migrate -c questpie.config.ts",
		);
		expect(packageJson.dependencies["@electric-sql/pglite"]).toBeDefined();
		expect(packageJson.dependencies["pg-boss"]).toBeDefined();
		expect(packageJson.dependencies.nodemailer).toBeDefined();
		expect(packageJson.devDependencies["@tanstack/router-cli"]).toBeDefined();
		expect(existsSync(join(projectDir, "src", "routeTree.gen.ts"))).toBe(true);
		expect(existsSync(join(projectDir, "src", "vite-env.d.ts"))).toBe(true);
		expect(existsSync(join(projectDir, "src", "tanstack-start.d.ts"))).toBe(
			true,
		);

		expect(
			existsSync(join(projectDir, ".agents", "skills", "questpie", "SKILL.md")),
		).toBe(true);
		expect(
			existsSync(
				join(projectDir, ".agents", "skills", "questpie-admin", "SKILL.md"),
			),
		).toBe(true);
	});
});
