import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	compileApplication,
	CompilerDiagnosticError,
} from "@questpie/compiler";

import { digest } from "../../packages/compiler/src/canonical";

setDefaultTimeout(90_000);

const fixture = resolve(import.meta.dir, "../../fixtures/team-support-desk");
const temporaryRoots: string[] = [];

async function copyFixture(label: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "questpie-http03-" + label + "-"));
	temporaryRoots.push(root);
	await cp(fixture, root, { recursive: true });
	return root;
}

async function configureOpenApi(root: string, value: unknown): Promise<void> {
	const path = join(root, "questpie.json");
	const configuration = JSON.parse(await readFile(path, "utf8"));
	configuration.projections = { openapi: value };
	await writeFile(path, JSON.stringify(configuration, null, "\t") + "\n");
}

afterAll(async () => {
	await Promise.all(
		temporaryRoots.map((root) => rm(root, { force: true, recursive: true })),
	);
});

describe("HTTP-03 / DOC-02 compiler ownership", () => {
	test("projects generated JSDoc independently of OpenAPI selection", async () => {
		const root = await copyFixture("jsdoc-without-openapi");
		const compilation = await compileApplication({ applicationRoot: root });
		const documentation = JSON.parse(
			compilation.generatedFiles["operation-documentation.json"]!,
		);
		const documentationDigest = digest(
			"questpie-operation-documentation-v1",
			documentation,
		);

		expect(compilation.generatedFiles).not.toHaveProperty("openapi.json");
		expect(compilation.generatedFiles["app.ts"]).toContain(
			"Fetch one visible support ticket",
		);
		expect(compilation.generatedFiles["app.ts"]).toContain(
			`export declare const operationDocumentationDigest: ${JSON.stringify(documentationDigest)}`,
		);
	});

	test("selects OpenAPI exactly, pins digests, and keeps prose out of Runtime", async () => {
		const root = await copyFixture("selected");
		const outputDirectory = join(root, ".questpie/generated");
		await configureOpenApi(root, true);
		const compilation = await compileApplication({
			applicationRoot: root,
			outputDirectory,
		});

		const openapi = JSON.parse(compilation.generatedFiles["openapi.json"]!);
		const documentation = JSON.parse(
			compilation.generatedFiles["operation-documentation.json"]!,
		);
		const explain = JSON.parse(
			compilation.generatedFiles["operation-projection-explain.json"]!,
		);
		const http = JSON.parse(
			compilation.generatedFiles["operation-http-contract.json"]!,
		);
		expect(openapi.openapi).toBe("3.1.0");
		expect(openapi.info.version).toBe(http.clientContractDigest);
		expect(openapi.info["x-questpie-operation-documentation-digest"]).toBe(
			explain.documentationDigest,
		);
		expect(documentation.operations.length).toBeGreaterThan(0);
		expect(explain.httpContractDigest).toBe(http.digest);

		const app = compilation.generatedFiles["app.ts"]!;
		expect(app).toContain("/**");
		expect(app).toContain("Fetch one visible support ticket");
		expect(app).toContain(
			`export declare const operationDocumentationDigest: ${JSON.stringify(explain.documentationDigest)}`,
		);
		expect(app).not.toContain("operation-documentation.json");
		const runtimeApplication =
			compilation.generatedFiles["internal/application.js"]!;
		expect(runtimeApplication).not.toContain("openapi.json");
		expect(runtimeApplication).not.toContain("operation-documentation.json");
		expect(runtimeApplication).not.toContain(
			"operation-projection-explain.json",
		);

		const checksums = JSON.parse(
			compilation.generatedFiles["internal/checksums.json"]!,
		);
		const checksumPaths = checksums.files.map(
			(file: { path: string }) => file.path,
		);
		expect(checksumPaths).toContain("openapi.json");
		expect(checksumPaths).toContain("operation-documentation.json");
		expect(checksumPaths).toContain("operation-projection-explain.json");

		const runtimeBuild = JSON.parse(
			compilation.generatedFiles["runtime-build.json"]!,
		);
		const runtimePaths = runtimeBuild.inventory.map(
			(file: { path: string }) => file.path,
		);
		expect(runtimePaths).not.toContain("openapi.json");
		expect(runtimePaths).not.toContain("operation-documentation.json");
		expect(runtimePaths).not.toContain("operation-projection-explain.json");
	});

	test("atomically deletes stale selected projection and generated JSDoc", async () => {
		const root = await copyFixture("stale");
		const outputDirectory = join(root, ".questpie/generated");
		await configureOpenApi(root, true);
		await compileApplication({ applicationRoot: root, outputDirectory });

		const configurationPath = join(root, "questpie.json");
		const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
		delete configuration.projections;
		await writeFile(
			configurationPath,
			JSON.stringify(configuration, null, "\t") + "\n",
		);
		const sourcePath = join(root, "src/tickets/queries.ts");
		await writeFile(
			sourcePath,
			(await readFile(sourcePath, "utf8")).replace(
				/\n\t*describe: \{[\s\S]*?\n\t*\},\n/u,
				"\n",
			),
		);
		const compilation = await compileApplication({
			applicationRoot: root,
			outputDirectory,
		});
		expect(compilation.generatedFiles).not.toHaveProperty("openapi.json");
		expect(compilation.generatedFiles["app.ts"]).not.toContain(
			"Fetch one visible support ticket",
		);
		expect(await Bun.file(join(outputDirectory, "openapi.json")).exists()).toBe(
			false,
		);
	});

	test("rejects every spelling except exact projections.openapi true", async () => {
		const root = await copyFixture("invalid-selector");
		await configureOpenApi(root, false);
		try {
			await compileApplication({ applicationRoot: root });
			throw new Error("expected invalid selector");
		} catch (error) {
			expect(error).toBeInstanceOf(CompilerDiagnosticError);
			expect((error as CompilerDiagnosticError).code).toBe("QP-COMPOSE-017");
		}
	});
});
