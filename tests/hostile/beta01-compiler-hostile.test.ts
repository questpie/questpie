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

async function acceptCurrentPackageInventory(root: string): Promise<void> {
	const diagnostic = await expectDiagnostic(
		() => compileApplication({ applicationRoot: root }),
		"QP-COMPOSE-008",
	);
	const configPath = join(root, "questpie.json");
	const config = JSON.parse(await readFile(configPath, "utf8"));
	config.packages["@questpie/collaboration-audit"].inventoryDigest =
		diagnostic.details.actual;
	await writeFile(configPath, JSON.stringify(config, null, 2));
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

	test("specializes the generated Package contract without leaking host Resources", async () => {
		const root = await fixtureCopy("package-host-leak");
		const packageSource = join(root, "packages/audit/src/questpie.ts");
		const source = await readFile(packageSource, "utf8");
		await writeFile(
			packageSource,
			source.replace(
				"defineCollectionAugmentation, field, index",
				"codec, constraint, defineCollection, defineCollectionAugmentation, field, index",
			).concat(`

import { defineQuery } from "#questpie/package";

export const auditEntries = defineCollection({
  name: "auditEntries",
  fields: { id: field.uuid() },
  constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

export const auditById = defineQuery({
  name: "audit.byId",
  input: codec.object({ id: codec.uuid() }),
  output: codec.object({ id: codec.uuid() }),
  handler: async ({ input, ctx }) => {
    const row = await ctx.data.auditEntries.get({ key: { id: input.id } });
    return { id: row?.id ?? input.id };
  },
});
`),
		);
		await acceptCurrentPackageInventory(root);
		const result = await compileApplication({ applicationRoot: root });
		const packageContract =
			result.generatedFiles[
				"internal/package-contracts/questpie-collaboration-audit-846963f083917e90c9a1fa4c25d7ac12de3ef0dc1fb82b1c2badd14616c61c0c.ts"
			] ?? "";
		expect(packageContract).toContain('readonly "auditEntries"');
		expect(packageContract).toContain('"audit.byId"');
		expect(packageContract).not.toContain('readonly "messages"');

		await writeFile(
			packageSource,
			(await readFile(packageSource, "utf8")).replace(
				"ctx.data.auditEntries.get",
				"ctx.data.messages.get",
			),
		);
		await expectDiagnostic(
			() => compileApplication({ applicationRoot: root }),
			"QP-COMPOSE-013",
		);
	});

	test("uses declaration Origins through barrels and ignores traversal order", async () => {
		const root = await fixtureCopy("barrel-origin");
		await writeFile(
			join(root, "src/messages-barrel.ts"),
			'export { messages } from "./messages";\n',
		);
		const result = await compileApplication({ applicationRoot: root });
		const origins = JSON.parse(
			result.generatedFiles["origin-map.json"] ?? "null",
		);
		expect(
			origins.resources.find(
				(resource: { identity: string }) =>
					resource.identity === "collection:messages",
			).establishedAt.path,
		).toBe("src/messages.ts");
	});

	test("validates the transitive Package graph and rejects impure structure", async () => {
		const transitiveRoot = await fixtureCopy("transitive-package");
		const packageSource = join(
			transitiveRoot,
			"packages/audit/src/questpie.ts",
		);
		await writeFile(
			packageSource,
			`${await readFile(packageSource, "utf8")}\nexport * from "./nested";\n`,
		);
		await writeFile(
			join(transitiveRoot, "packages/audit/src/nested.ts"),
			'import { createApp } from "#questpie/app";\nexport const invalid = createApp;\n',
		);
		await expectDiagnostic(
			() => compileApplication({ applicationRoot: transitiveRoot }),
			"QP-COMPOSE-012",
		);

		const impureRoot = await fixtureCopy("impure-structure");
		await writeFile(
			join(impureRoot, "src/impure.ts"),
			"export const machineDependent = process.env.QUESTPIE_TEST;\n",
		);
		await expectDiagnostic(
			() => compileApplication({ applicationRoot: impureRoot }),
			"QP-COMPOSE-010",
		);
	});

	test("hashes inherited TypeScript configuration", async () => {
		const root = await fixtureCopy("tsconfig-graph");
		const configPath = join(root, "tsconfig.json");
		const config = JSON.parse(await readFile(configPath, "utf8"));
		config.extends = "./tsconfig.shared.json";
		await writeFile(configPath, JSON.stringify(config, null, 2));
		const sharedPath = join(root, "tsconfig.shared.json");
		await writeFile(
			sharedPath,
			JSON.stringify({ compilerOptions: {} }, null, 2),
		);
		const first = await compileApplication({ applicationRoot: root });
		await writeFile(
			sharedPath,
			JSON.stringify(
				{ compilerOptions: { exactOptionalPropertyTypes: true } },
				null,
				2,
			),
		);
		const second = await compileApplication({ applicationRoot: root });
		const firstInput = JSON.parse(
			first.generatedFiles["build-input.json"] ?? "null",
		);
		const secondInput = JSON.parse(
			second.generatedFiles["build-input.json"] ?? "null",
		);
		expect(firstInput.inputs.typescriptConfigGraphDigest).not.toBe(
			secondInput.inputs.typescriptConfigGraphDigest,
		);
	});

	test("rejects broad structural references outside exact local Fields", async () => {
		const root = await fixtureCopy("invalid-field-reference");
		const sourcePath = join(root, "src/companies.ts");
		await writeFile(
			sourcePath,
			(await readFile(sourcePath, "utf8")).replace(
				'constraint.primaryKey({ fields: ["id"] })',
				'constraint.primaryKey({ fields: ["missing"] })',
			),
		);
		await expectDiagnostic(
			() => compileApplication({ applicationRoot: root }),
			"QP-SCHEMA-003",
		);
	});
});
