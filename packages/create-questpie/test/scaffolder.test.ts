import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	defaultModuleIds,
	isModuleAllowed,
	type RuntimeId,
} from "../src/modules";
import { scaffold } from "../src/scaffolder";
import {
	getSkillsInstallArgs,
	QUESTPIE_SKILL_NAMES,
	QUESTPIE_SKILLS_SOURCE,
	SKILLS_CLI_PACKAGE,
} from "../src/skills";

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
	test("creates a runnable project shell with env and scripts (skills not vendored)", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "create-questpie-"));
		process.chdir(tempDir);

		await scaffold({
			projectName: "smoke-app",
			templateId: "tanstack-start",
			databaseName: "smoke_app",
			modules: defaultModuleIds("tanstack-start"),
			installDeps: false,
			initGit: false,
			// The canonical skills install is network-bound; parity has a dedicated
			// disposable installer test, so keep it off in this scaffold smoke test.
			installSkills: false,
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
		const nitroPlugin = await readFile(
			join(projectDir, "src", "questpie-nitro-plugin.ts"),
			"utf-8",
		);
		const viteConfig = await readFile(
			join(projectDir, "vite.config.ts"),
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
		expect(packageJson.scripts["db:push"]).toBe(
			"questpie push -c questpie.config.ts",
		);
		expect(packageJson.scripts.migrate).toBe(
			"questpie migrate -c questpie.config.ts",
		);
		expect(packageJson.dependencies["@electric-sql/pglite"]).toBeDefined();
		expect(packageJson.dependencies["better-auth"]).toBe("^1.6.11");
		expect(packageJson.dependencies["pg-boss"]).toBeDefined();
		expect(packageJson.dependencies.nodemailer).toBeDefined();
		expect(packageJson.dependencies["pusher-js"]).toBe("^8.5.0");
		expect(packageJson.devDependencies["@tanstack/router-cli"]).toBeDefined();
		expect(existsSync(join(projectDir, "src", "routeTree.gen.ts"))).toBe(true);
		expect(existsSync(join(projectDir, "src", "vite-env.d.ts"))).toBe(true);
		expect(existsSync(join(projectDir, "src", "tanstack-start.d.ts"))).toBe(
			true,
		);
		expect(viteConfig).toContain("./src/questpie-nitro-plugin.ts");
		expect(nitroPlugin).toContain("createGracefulServerShutdown");
		expect(nitroPlugin).toContain(
			"tracingSrvxPlugins.push((server) => lifecycle.attach(server))",
		);

		// Skills are installed by the official CLI only when explicitly enabled.
		expect(existsSync(join(projectDir, ".agents", "skills"))).toBe(false);
	});

	test("browser templates install the client realtime peer", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "create-questpie-"));
		process.chdir(tempDir);

		for (const templateId of ["tanstack-start", "next"] as const) {
			await scaffold({
				projectName: `${templateId}-app`,
				templateId,
				databaseName: `${templateId.replace("-", "_")}_app`,
				modules: defaultModuleIds(templateId),
				installDeps: false,
				initGit: false,
				installSkills: false,
				runCodegen: false,
			});
			const packageJson = JSON.parse(
				await readFile(
					join(tempDir, `${templateId}-app`, "package.json"),
					"utf8",
				),
			) as { dependencies: Record<string, string> };
			expect(packageJson.dependencies["pusher-js"]).toBe("^8.5.0");
		}
	});

	test("templates mount the canonical runtime HTTP surface", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "create-questpie-"));
		process.chdir(tempDir);

		const expectations = {
			next: {
				adapter: "@questpie/next",
				entry: "src/app/api/[[...all]]/route.ts",
				import: 'from "@questpie/next"',
				mount: "questpieNextRouteHandlers(app, {",
				readme: "QUESTPIE Next adapter mount",
			},
			hono: {
				adapter: "@questpie/hono",
				entry: "src/index.ts",
				import: 'from "@questpie/hono/server"',
				mount: 'questpieHono(questpie, { basePath: "/api" })',
				readme: "mounts the QUESTPIE Hono adapter",
			},
			elysia: {
				adapter: "@questpie/elysia",
				entry: "src/index.ts",
				import: 'from "@questpie/elysia/server"',
				mount: 'questpieElysia(questpie, { basePath: "/api" })',
				readme: "mounts the QUESTPIE Elysia adapter",
			},
		} as const;

		for (const templateId of ["next", "hono", "elysia"] as const) {
			const expected = expectations[templateId];
			await scaffold({
				projectName: `${templateId}-adapter-app`,
				templateId,
				databaseName: `${templateId}_adapter_app`,
				modules: defaultModuleIds(templateId),
				installDeps: false,
				initGit: false,
				installSkills: false,
				runCodegen: false,
			});
			const projectDir = join(tempDir, `${templateId}-adapter-app`);
			const packageJson = JSON.parse(
				await readFile(join(projectDir, "package.json"), "utf8"),
			) as { dependencies: Record<string, string> };
			const entry = await readFile(join(projectDir, expected.entry), "utf8");
			const readme = await readFile(join(projectDir, "README.md"), "utf8");

			expect(packageJson.dependencies[expected.adapter]).toBe("latest");
			expect(entry).toContain(expected.import);
			expect(entry).toContain(expected.mount);
			expect(entry).not.toContain("createFetchHandler");
			expect(readme).toContain(expected.readme);
		}

		await scaffold({
			projectName: "tanstack-fetch-app",
			templateId: "tanstack-start",
			databaseName: "tanstack_fetch_app",
			modules: defaultModuleIds("tanstack-start"),
			installDeps: false,
			initGit: false,
			installSkills: false,
			runCodegen: false,
		});
		const tanstackDir = join(tempDir, "tanstack-fetch-app");
		const tanstackEntry = await readFile(
			join(tanstackDir, "src/routes/api/$.ts"),
			"utf8",
		);
		const tanstackReadme = await readFile(
			join(tanstackDir, "README.md"),
			"utf8",
		);
		const tanstackPackage = JSON.parse(
			await readFile(join(tanstackDir, "package.json"), "utf8"),
		) as { scripts: Record<string, string> };
		expect(tanstackEntry).toContain("createFetchHandler");
		expect(tanstackEntry).toContain("OPTIONS: ({ request })");
		expect(tanstackEntry).toContain("HEAD: ({ request })");
		expect(tanstackPackage.scripts.build).toBe(
			"NODE_ENV=production vite build",
		);
		expect(tanstackReadme).toContain(
			"Low-level QUESTPIE Fetch mount (seven methods)",
		);
	});

	test("headless templates keep runtime dependencies available in production", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "create-questpie-"));
		process.chdir(tempDir);

		for (const templateId of ["hono", "elysia"] as const) {
			await scaffold({
				projectName: `${templateId}-app`,
				templateId,
				databaseName: `${templateId}_app`,
				modules: defaultModuleIds(templateId),
				installDeps: false,
				initGit: false,
				installSkills: false,
				runCodegen: false,
			});
			const projectDir = join(tempDir, `${templateId}-app`);
			const packageJson = JSON.parse(
				await readFile(join(projectDir, "package.json"), "utf8"),
			) as { scripts: Record<string, string> };
			const dockerfile = await readFile(join(projectDir, "Dockerfile"), "utf8");

			expect(packageJson.scripts.build).toContain("--packages external");
			expect(dockerfile).toContain(
				"COPY --from=deps /app/node_modules ./node_modules",
			);
		}
	});

	test("Hono exits according to its graceful shutdown result", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "create-questpie-"));
		process.chdir(tempDir);

		await scaffold({
			projectName: "hono-app",
			templateId: "hono",
			databaseName: "hono_app",
			modules: defaultModuleIds("hono"),
			installDeps: false,
			initGit: false,
			installSkills: false,
			runCodegen: false,
		});
		const entry = await readFile(
			join(tempDir, "hono-app", "src", "index.ts"),
			"utf8",
		);

		expect(entry).toContain("() => process.exit(0)");
		expect(entry).toContain("Failed to shut down after ${signal}");
		expect(entry).toContain("process.exit(1)");
	});

	test("uses the pinned canonical project-local skills install", () => {
		expect(getSkillsInstallArgs()).toEqual([
			SKILLS_CLI_PACKAGE,
			"add",
			QUESTPIE_SKILLS_SOURCE,
			"--skill",
			...QUESTPIE_SKILL_NAMES,
			"--yes",
			"--copy",
		]);
	});

	test("applies adapter and workflow options to generated project files", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "create-questpie-"));
		process.chdir(tempDir);

		await scaffold({
			projectName: "adapter-app",
			templateId: "tanstack-start",
			databaseName: "adapter_app",
			modules: [...defaultModuleIds("tanstack-start"), "workflows"],
			installDeps: false,
			initGit: false,
			installSkills: false,
			runCodegen: false,
			queueAdapter: "bullmq",
			emailAdapter: "resend",
			realtimeBroker: "redis-streams",
			kvAdapter: "redis",
		});

		const projectDir = join(tempDir, "adapter-app");
		const packageJson = JSON.parse(
			await readFile(join(projectDir, "package.json"), "utf-8"),
		);
		const env = await readFile(
			join(projectDir, "src", "lib", "env.ts"),
			"utf-8",
		);
		const runtimeConfig = await readFile(
			join(projectDir, "src", "questpie", "server", "questpie.config.ts"),
			"utf-8",
		);
		const serverModules = await readFile(
			join(projectDir, "src", "questpie", "server", "modules.ts"),
			"utf-8",
		);
		const adminModules = await readFile(
			join(projectDir, "src", "questpie", "admin", "modules.ts"),
			"utf-8",
		);

		expect(packageJson.dependencies["@questpie/workflows"]).toBe("latest");
		expect(packageJson.dependencies.bullmq).toBeDefined();
		expect(packageJson.dependencies.redis).toBeDefined();
		expect(env).toContain('MAIL_ADAPTER: z.enum(["console","resend"])');
		expect(env).toContain("RESEND_API_KEY");
		expect(env).toContain("REDIS_URL");
		expect(runtimeConfig).toContain("bullMQAdapter");
		expect(runtimeConfig).toContain("ResendAdapter");
		expect(runtimeConfig).toContain("redisStreamsChangeBroker");
		expect(runtimeConfig).toContain("changeBroker:");
		expect(runtimeConfig).toContain("redisKVAdapter");
		expect(serverModules).toContain("workflowsModule");
		expect(adminModules).toContain("workflowsClientModule");
	});

	test("emits exact default modules/config/env (locks registry behavior)", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "create-questpie-"));
		process.chdir(tempDir);

		await scaffold({
			projectName: "default-app",
			templateId: "tanstack-start",
			databaseName: "default_app",
			modules: defaultModuleIds("tanstack-start"),
			installDeps: false,
			initGit: false,
			installSkills: false,
			runCodegen: false,
		});

		const projectDir = join(tempDir, "default-app");
		const read = (rel: string) => readFile(join(projectDir, rel), "utf-8");

		expect(await read("src/questpie/server/modules.ts")).toBe(
			[
				`/**`,
				` * Modules — static module dependencies for this project.`,
				` */`,
				`import { adminModule } from "@questpie/admin/modules/admin";`,
				`import { openApiModule } from "@questpie/openapi";`,
				``,
				`const modules = [`,
				`\tadminModule,`,
				`\topenApiModule,`,
				`] as const;`,
				``,
				`export default modules;`,
				``,
			].join("\n"),
		);

		expect(await read("src/questpie/admin/modules.ts")).toBe(
			[
				`import { adminClientModule } from "@questpie/admin/client/modules/admin";`,
				``,
				`export default [adminClientModule] as const;`,
				``,
			].join("\n"),
		);

		expect(await read("questpie.config.ts")).toBe(
			[
				`/**`,
				` * Questpie CLI Configuration`,
				` *`,
				` * Re-exports the server config for CLI commands (migrate, generate, seed).`,
				` * The CLI auto-resolves .generated/index.ts for the app instance.`,
				` */`,
				`export { default } from "./src/questpie/server/questpie.config";`,
				``,
			].join("\n"),
		);

		expect(await read("src/questpie/server/questpie.config.ts")).toBe(
			[
				`/**`,
				` * QUESTPIE Runtime Configuration`,
				` *`,
				` * Runtime-only configuration: database, adapters, secrets.`,
				` * Entity definitions are codegen-generated.`,
				` */`,
				``,
				`import { runtimeConfig } from "questpie/app";`,
				`import { ConsoleAdapter } from "questpie/adapters/console";`,
				`import { pgBossAdapter } from "questpie/adapters/pg-boss";`,
				``,
				`import { env } from "@/lib/env";`,
				``,
				`export default runtimeConfig({`,
				`\tapp: { url: env.APP_URL },`,
				`\tdb: { url: env.DATABASE_URL },`,
				`\tstorage: { basePath: "/api" },`,
				`\temail: {`,
				`\t\tadapter: new ConsoleAdapter({ logHtml: false }),`,
				`\t},`,
				`\tqueue: {`,
				`\t\tadapter: pgBossAdapter({ connectionString: env.DATABASE_URL }),`,
				`\t},`,
				`\tcli: {`,
				`\t\tmigrations: { directory: "./src/migrations" },`,
				`\t},`,
				`});`,
				``,
			].join("\n"),
		);

		expect(await read("src/questpie/server/config/auth.ts")).toBe(
			[
				`import { admin, bearer } from "better-auth/plugins";`,
				`import { authConfig } from "questpie/app";`,
				``,
				`export default authConfig({`,
				`\tplugins: [admin(), bearer()],`,
				`\temailAndPassword: {`,
				`\t\tenabled: true,`,
				`\t\trequireEmailVerification: false,`,
				`\t},`,
				`});`,
				``,
			].join("\n"),
		);

		expect(await read("src/lib/env.ts")).toBe(
			[
				`import { createEnv } from "@t3-oss/env-core";`,
				`import { z } from "zod";`,
				``,
				`export const env = createEnv({`,
				`\tserver: {`,
				`\t\tDATABASE_URL: z.string().url(),`,
				`\t\tAPP_URL: z.string().url().default("http://localhost:3000"),`,
				`\t\tPORT: z`,
				`\t\t\t.string()`,
				`\t\t\t.transform(Number)`,
				`\t\t\t.pipe(z.number().int().positive())`,
				`\t\t\t.default(3000),`,
				`\t\tBETTER_AUTH_SECRET: z.string().min(1).default("change-me-in-production"),`,
				`\t\tMAIL_ADAPTER: z.enum(["console"]).default("console"),`,
				`\t},`,
				`\truntimeEnv: process.env,`,
				`\temptyStringAsUndefined: true,`,
				`});`,
				``,
			].join("\n"),
		);
	});

	test("server modules.ts reflects the selected module set, not a hardcoded list", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "create-questpie-"));
		process.chdir(tempDir);

		// A non-default selection: admin + openapi + workflows.
		await scaffold({
			projectName: "selected-app",
			templateId: "tanstack-start",
			databaseName: "selected_app",
			modules: ["admin", "openapi", "workflows"],
			installDeps: false,
			initGit: false,
			installSkills: false,
			runCodegen: false,
		});

		const projectDir = join(tempDir, "selected-app");
		const serverModules = await readFile(
			join(projectDir, "src", "questpie", "server", "modules.ts"),
			"utf-8",
		);
		const adminModules = await readFile(
			join(projectDir, "src", "questpie", "admin", "modules.ts"),
			"utf-8",
		);

		// Server emits exactly the selected three, in registry order.
		expect(serverModules).toContain("adminModule");
		expect(serverModules).toContain("openApiModule");
		expect(serverModules).toContain("workflowsModule");
		// admin selected -> admin/modules.ts is (re)written with both client halves.
		expect(adminModules).toContain("adminClientModule");
		expect(adminModules).toContain("workflowsClientModule");
	});

	test("selecting mcp mounts the MCP endpoint module + adds the dependency", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "create-questpie-"));
		process.chdir(tempDir);

		// Render runtime: admin brings the starter (OAuth provider + tables), so
		// the /mcp route this module mounts is OAuth-MCP-ready end to end.
		await scaffold({
			projectName: "mcp-app",
			templateId: "tanstack-start",
			databaseName: "mcp_app",
			modules: ["admin", "openapi", "mcp"],
			installDeps: false,
			initGit: false,
			installSkills: false,
			runCodegen: false,
		});

		const projectDir = join(tempDir, "mcp-app");
		const serverModules = await readFile(
			join(projectDir, "src", "questpie", "server", "modules.ts"),
			"utf-8",
		);
		const packageJson = JSON.parse(
			await readFile(join(projectDir, "package.json"), "utf-8"),
		) as { dependencies: Record<string, string> };

		expect(serverModules).toContain(
			`import { mcpModule } from "@questpie/mcp/modules/mcp";`,
		);
		expect(serverModules).toContain("mcpModule,");
		expect(packageJson.dependencies["@questpie/mcp"]).toBe("latest");
		// mcp is server-only — it never appears in the admin client module list.
		const adminModules = await readFile(
			join(projectDir, "src", "questpie", "admin", "modules.ts"),
			"utf-8",
		);
		expect(adminModules).not.toContain("mcp");
	});

	test("mcp is available headless too (stdio system mode needs no OAuth)", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "create-questpie-"));
		process.chdir(tempDir);

		await scaffold({
			projectName: "mcp-headless",
			templateId: "hono",
			databaseName: "mcp_headless",
			modules: ["openapi", "mcp"],
			installDeps: false,
			initGit: false,
			installSkills: false,
			runCodegen: false,
		});

		const serverModules = await readFile(
			join(tempDir, "mcp-headless", "src", "questpie", "server", "modules.ts"),
			"utf-8",
		);
		expect(serverModules).toContain("mcpModule,");
	});
});

describe("module oracle", () => {
	const renderRuntimes: RuntimeId[] = ["tanstack-start", "next"];
	const headlessRuntimes: RuntimeId[] = ["hono", "elysia"];

	test("admin is allowed on render-layer runtimes", () => {
		for (const runtime of renderRuntimes) {
			expect(isModuleAllowed("admin", runtime)).toBe(true);
		}
	});

	test("admin is rejected on headless runtimes", () => {
		for (const runtime of headlessRuntimes) {
			expect(isModuleAllowed("admin", runtime)).toBe(false);
		}
	});

	test("server-only modules are allowed on every runtime", () => {
		for (const runtime of [...renderRuntimes, ...headlessRuntimes]) {
			expect(isModuleAllowed("openapi", runtime)).toBe(true);
			expect(isModuleAllowed("workflows", runtime)).toBe(true);
			// mcp is server-only (stdio works headless) — allowed everywhere.
			expect(isModuleAllowed("mcp", runtime)).toBe(true);
		}
	});

	test("unknown module ids are rejected", () => {
		expect(isModuleAllowed("does-not-exist", "tanstack-start")).toBe(false);
	});

	test("default module ids include admin only for render runtimes", () => {
		expect(defaultModuleIds("tanstack-start")).toEqual(["admin", "openapi"]);
		expect(defaultModuleIds("next")).toEqual(["admin", "openapi"]);
		expect(defaultModuleIds("hono")).toEqual(["openapi"]);
		expect(defaultModuleIds("elysia")).toEqual(["openapi"]);
	});
});
