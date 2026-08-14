import { afterAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	compileApplication,
	CompilerDiagnosticError,
} from "@questpie/compiler";

const repositoryRoot = resolve(import.meta.dir, "../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/collaboration");
const temporaryRoots: string[] = [];

async function fixtureCopy(label: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `questpie-beta01-${label}-`));
	temporaryRoots.push(root);
	await cp(fixtureRoot, root, { recursive: true });
	return root;
}

async function expectDiagnostic(
	operation: () => Promise<unknown>,
	code: string,
): Promise<CompilerDiagnosticError> {
	try {
		await operation();
	} catch (error) {
		expect(error).toBeInstanceOf(CompilerDiagnosticError);
		const diagnostic = error as CompilerDiagnosticError;
		expect(diagnostic.code).toBe(code);
		return diagnostic;
	}
	throw new Error(`expected ${code}`);
}

afterAll(async () => {
	await Promise.all(
		temporaryRoots.map((root) => rm(root, { force: true, recursive: true })),
	);
});

describe("BETA-01 hostile compiler cases", () => {
	test("rejects duplicate Resource identity without replacing good output", async () => {
		const root = await fixtureCopy("duplicate");
		const outputDirectory = join(root, ".questpie/generated");
		await compileApplication({ applicationRoot: root, outputDirectory });
		const acceptedManifest = await readFile(
			join(outputDirectory, "manifest.json"),
			"utf8",
		);
		await writeFile(
			join(root, "src/duplicate.ts"),
			`import { constraint, defineCollection, field } from "questpie";
export const duplicate = defineCollection({
  name: "messages",
  fields: { id: field.uuid() },
  constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});
`,
		);
		await expectDiagnostic(
			() => compileApplication({ applicationRoot: root, outputDirectory }),
			"QP-COMPOSE-002",
		);
		expect(await readFile(join(outputDirectory, "manifest.json"), "utf8")).toBe(
			acceptedManifest,
		);
	});

	test("rejects an unauthorized Augmentation and an accepted member collision", async () => {
		const inactiveRoot = await fixtureCopy("inactive-package");
		const configPath = join(inactiveRoot, "questpie.json");
		const config = JSON.parse(await readFile(configPath, "utf8"));
		config.packages = {};
		await writeFile(configPath, JSON.stringify(config, null, 2));
		await expectDiagnostic(
			() => compileApplication({ applicationRoot: inactiveRoot }),
			"QP-COMPOSE-005",
		);

		const collisionRoot = await fixtureCopy("augmentation-collision");
		const packageSource = join(collisionRoot, "packages/audit/src/questpie.ts");
		const source = await readFile(packageSource, "utf8");
		await writeFile(
			packageSource,
			source.replace(
				"fields: {",
				"fields: {\n\t\tbody: field.text({ nullable: true }),",
			),
		);
		const inventoryChange = await expectDiagnostic(
			() => compileApplication({ applicationRoot: collisionRoot }),
			"QP-COMPOSE-008",
		);
		const collisionConfigPath = join(collisionRoot, "questpie.json");
		const collisionConfig = JSON.parse(
			await readFile(collisionConfigPath, "utf8"),
		);
		collisionConfig.packages["@questpie/collaboration-audit"].inventoryDigest =
			inventoryChange.details.actual;
		await writeFile(
			collisionConfigPath,
			JSON.stringify(collisionConfig, null, 2),
		);
		await expectDiagnostic(
			() => compileApplication({ applicationRoot: collisionRoot }),
			"QP-COMPOSE-014",
		);
	});

	test("rejects generated structural values and ambient registries", async () => {
		const generatedRoot = await fixtureCopy("generated-import");
		await writeFile(
			join(generatedRoot, "src/generated-import.ts"),
			'import { createApp } from "#questpie/app";\nexport const invalid = createApp;\n',
		);
		await expectDiagnostic(
			() => compileApplication({ applicationRoot: generatedRoot }),
			"QP-COMPOSE-012",
		);

		const ambientRoot = await fixtureCopy("ambient-registry");
		await writeFile(
			join(ambientRoot, "src/ambient.ts"),
			'declare module "#questpie/app" { interface AmbientRegistry { messages: true } }\nexport {};\n',
		);
		await expectDiagnostic(
			() => compileApplication({ applicationRoot: ambientRoot }),
			"QP-COMPOSE-013",
		);
	});

	test("keeps the generated Package contract blind to host Resources", async () => {
		const root = await fixtureCopy("package-host-leak");
		const result = await compileApplication({ applicationRoot: root });
		const probeRoot = await mkdtemp(
			join(tmpdir(), "questpie-beta01-package-probe-"),
		);
		temporaryRoots.push(probeRoot);
		const packageContract = join(probeRoot, "package.ts");
		await writeFile(
			packageContract,
			result.generatedFiles[
				"internal/package-contracts/collaboration-audit.ts"
			] ?? "",
		);
		await writeFile(
			join(probeRoot, "probe.ts"),
			`import { defineQuery } from "./package.ts";
import { codec } from "questpie";
export const leak = defineQuery({
  name: "audit.leak",
  input: codec.object({ id: codec.uuid() }),
  handler: ({ ctx }) => ctx.data.messages,
});
`,
		);
		await writeFile(
			join(probeRoot, "tsconfig.json"),
			JSON.stringify(
				{
					compilerOptions: {
						allowImportingTsExtensions: true,
						module: "ESNext",
						moduleResolution: "Bundler",
						noEmit: true,
						paths: {
							questpie: [
								resolve(repositoryRoot, "packages/questpie/src/index.ts"),
							],
						},
						skipLibCheck: true,
						strict: true,
						target: "ES2024",
					},
					files: [packageContract, join(probeRoot, "probe.ts")],
				},
				null,
				2,
			),
		);
		const typecheck = Bun.spawnSync(
			[
				"bun",
				resolve(repositoryRoot, "node_modules/typescript/bin/tsc"),
				"-p",
				join(probeRoot, "tsconfig.json"),
				"--pretty",
				"false",
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		expect(typecheck.exitCode).not.toBe(0);
		expect(
			`${typecheck.stdout.toString()}${typecheck.stderr.toString()}`,
		).toContain("not assignable to parameter of type 'never'");
	});
});
