import { expect, test } from "bun:test";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const repositoryRoot = resolve(import.meta.dir, "../..");

test("emits one executable App over the same exact Query engine", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta05-app-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await mkdir(join(temporary, "node_modules"), { recursive: true });
		await rm(join(temporary, "node_modules/questpie"), {
			force: true,
			recursive: true,
		});
		await mkdir(join(temporary, "node_modules/questpie"));
		await writeFile(
			join(temporary, "node_modules/questpie/package.json"),
			JSON.stringify({
				name: "questpie",
				type: "module",
				exports: "./index.ts",
			}),
		);
		await symlink(
			resolve(repositoryRoot, "packages/questpie/src/index.ts"),
			join(temporary, "node_modules/questpie/index.ts"),
			"file",
		);
		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		expect(compilation.generatedFiles["app.ts"]).not.toContain(
			"export declare function createApp",
		);
		expect(compilation.generatedFiles["app.ts"]).toContain(
			'import("./internal/application.js")',
		);
		expect(compilation.generatedFiles["internal/application.js"]).toContain(
			"createRuntimeApplication",
		);
		expect(compilation.generatedFiles["internal/application.js"]).toContain(
			"serverExports",
		);
		expect(compilation.generatedFiles["internal/application.js"]).not.toContain(
			"@questpie/runtime",
		);
		expect(compilation.generatedFiles["internal/application.js"]).toContain(
			"schemaFingerprint",
		);
		expect(compilation.generatedFiles["internal/application.js"]).toContain(
			"schema_migration_receipts",
		);
		expect(compilation.generatedFiles["internal/application.js"]).toContain(
			"application_bindings",
		);
		expect(compilation.generatedFiles["internal/application.d.ts"]).toContain(
			"bindIngressPrincipalForRequest",
		);
		expect(compilation.generatedFiles["app.ts"]).not.toContain(
			"bindIngressPrincipalForRequest",
		);
		const internalApplication = await import(
			pathToFileURL(
				join(temporary, ".questpie/generated/internal/application.js"),
			).href
		);
		expect(Object.keys(internalApplication).sort()).toEqual([
			"bindIngressPrincipalForRequest",
			"createApplication",
		]);
		const ingressRequest = new Request("http://runtime.test");
		const { principal } = await import(
			pathToFileURL(join(temporary, "node_modules/questpie/index.ts")).href
		);
		expect(
			internalApplication.bindIngressPrincipalForRequest(
				ingressRequest,
				principal.user({
					id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
				}),
			),
		).toBe(ingressRequest);

		await writeFile(
			join(temporary, "generated-app-contract-consumer.ts"),
			`import { createApp } from "#questpie/app";
import { principal } from "questpie";

async function useGeneratedApp() {
	const app = await createApp({ postgres: { url: "postgres://localhost/questpie" } });
	const response: Response = await app.fetch(new Request("http://runtime.test/_questpie/operation"));
	const page = await app.execution(
		{
			principal: principal.user({ id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4" }),
			context: { companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
			signal: AbortSignal.timeout(5_000),
		},
		({ queries }) => queries["messages.page"]({
			channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
			first: 20,
			after: null,
		}),
	);
	page.nodes satisfies ReadonlyArray<Readonly<{
		id: string;
		body?: string;
		createdAt: Date;
		author: Readonly<{ id: string; role: string }> | null;
	}>>;
	response satisfies Response;
	await app.close();
}
void useGeneratedApp;
`,
		);
		await writeFile(
			join(temporary, "tsconfig.generated-app.json"),
			JSON.stringify({
				compilerOptions: {
					allowImportingTsExtensions: true,
					module: "ESNext",
					moduleResolution: "Bundler",
					noEmit: true,
					paths: {
						"#questpie/app": ["./.questpie/generated/app.ts"],
						"#questpie/source/*": ["./src/*"],
						"@questpie/runtime": [
							resolve(repositoryRoot, "packages/runtime/src/index.ts"),
						],
						questpie: [
							resolve(repositoryRoot, "packages/questpie/src/index.ts"),
						],
					},
					skipLibCheck: true,
					strict: true,
					target: "ES2024",
					typeRoots: [resolve(repositoryRoot, "node_modules/@types")],
					types: ["bun"],
				},
				include: [
					"generated-app-contract-consumer.ts",
					".questpie/generated/**/*.ts",
				],
			}),
		);
		const typecheck = Bun.spawn(
			[
				"bun",
				resolve(repositoryRoot, "node_modules/typescript/bin/tsc"),
				"-p",
				"tsconfig.generated-app.json",
			],
			{ cwd: temporary, stdout: "pipe", stderr: "pipe" },
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			typecheck.exited,
			new Response(typecheck.stdout).text(),
			new Response(typecheck.stderr).text(),
		]);
		expect(`${stdout}${stderr}`).toBe("");
		expect(exitCode).toBe(0);

		const fixtureManifest = await readFile(
			join(temporary, "package.json"),
			"utf8",
		);
		expect(fixtureManifest).not.toContain("@questpie/runtime");
		expect(compilation.generatedFiles["app.ts"]).not.toMatch(
			/provider|authAdapter|hostAdapter/,
		);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);
