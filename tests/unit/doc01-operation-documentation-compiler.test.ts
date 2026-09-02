import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	compileApplication,
	CompilerDiagnosticError,
} from "@questpie/compiler";

setDefaultTimeout(90_000);

const repositoryRoot = resolve(import.meta.dir, "../..");
const teamSupportDesk = resolve(repositoryRoot, "fixtures/team-support-desk");
const collaboration = resolve(repositoryRoot, "fixtures/collaboration");
const temporaryRoots: string[] = [];

async function fixtureCopy(source: string, label: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `questpie-doc01-${label}-`));
	temporaryRoots.push(root);
	await cp(source, root, { recursive: true });
	return root;
}

async function expectDiagnostic(
	run: () => Promise<unknown>,
	code: string,
): Promise<CompilerDiagnosticError> {
	try {
		await run();
	} catch (error) {
		expect(error).toBeInstanceOf(CompilerDiagnosticError);
		const diagnostic = error as CompilerDiagnosticError;
		expect(diagnostic.code).toBe(code);
		return diagnostic;
	}
	throw new Error(`expected ${code}`);
}

function textOrigin(
	source: string,
	marker: string,
): Readonly<{ line: number; column: number }> {
	const index = source.indexOf(marker);
	if (index < 0) throw new Error(`missing source marker ${marker}`);
	const prefix = source.slice(0, index);
	return {
		line: prefix.split("\n").length,
		column: index - prefix.lastIndexOf("\n"),
	};
}

function removeObjectProperties(source: string, property: string): string {
	let result = source;
	for (;;) {
		const match = new RegExp(`\\n[\\t ]+${property}: \\{`, "u").exec(result);
		if (!match || match.index === undefined) return result;
		const start = match.index;
		const objectStart = result.indexOf("{", start + match[0].length - 1);
		let depth = 0;
		let end = objectStart;
		for (; end < result.length; end += 1) {
			if (result[end] === "{") depth += 1;
			else if (result[end] === "}") {
				depth -= 1;
				if (depth === 0) break;
			}
		}
		if (depth !== 0) throw new Error(`unclosed ${property} object`);
		if (result[end + 1] === ",") end += 1;
		result = result.slice(0, start) + result.slice(end + 1);
	}
}

afterAll(async () => {
	await Promise.all(
		temporaryRoots.map((root) => rm(root, { force: true, recursive: true })),
	);
});

describe("DOC-01 compiler integration", () => {
	test("compiles Team Support Desk authoring and excludes docs from Runtime Build", async () => {
		const compilation = await compileApplication({
			applicationRoot: teamSupportDesk,
		});
		const artifact = JSON.parse(
			compilation.generatedFiles["operation-documentation.json"] ?? "null",
		);
		expect(artifact).toMatchObject({
			format: "questpie.operation-documentation",
			version: 1,
		});
		expect(
			artifact.operations.map(({ identity }: { identity: string }) => identity),
		).toEqual([
			"action:notification.sendTicketSummary",
			"mutation:ticket.close",
			"query:tickets.detail",
			"query:tickets.get",
		]);
		const runtimeBuild = JSON.parse(
			compilation.generatedFiles["runtime-build.json"] ?? "null",
		);
		expect(
			runtimeBuild.inventory.some(
				({ path }: { path: string }) => path === "operation-documentation.json",
			),
		).toBe(false);
		const checksums = JSON.parse(
			compilation.generatedFiles["internal/checksums.json"] ?? "null",
		);
		expect(
			checksums.files.some(
				({ path }: { path: string }) => path === "operation-documentation.json",
			),
		).toBe(true);
	});

	test("keeps client, wire, schema, fingerprint, and migrations independent", async () => {
		const root = await fixtureCopy(teamSupportDesk, "digest-independence");
		const before = await compileApplication({ applicationRoot: root });
		const queryPath = join(root, "src/tickets/queries.ts");
		await writeFile(
			queryPath,
			(await readFile(queryPath, "utf8")).replace(
				"Fetch one visible support ticket",
				"Fetch one Policy-visible support ticket",
			),
		);
		const after = await compileApplication({ applicationRoot: root });
		expect(after.generatedFiles["operation-documentation.json"]).not.toBe(
			before.generatedFiles["operation-documentation.json"],
		);
		for (const path of [
			"client.ts",
			"wire-contract.json",
			"schema-projection.json",
			"committed-migrations.json",
		])
			expect(after.generatedFiles[path], path).toBe(
				before.generatedFiles[path],
			);
		const beforeBuild = JSON.parse(
			before.generatedFiles["runtime-build.json"] ?? "null",
		);
		const afterBuild = JSON.parse(
			after.generatedFiles["runtime-build.json"] ?? "null",
		);
		expect(afterBuild.clientContractDigest).toBe(
			beforeBuild.clientContractDigest,
		);
		expect(afterBuild.wireDigest).toBe(beforeBuild.wireDigest);
		expect(afterBuild.schemaFingerprint).toBe(beforeBuild.schemaFingerprint);
	});

	test("atomically replaces stale documentation with the defined empty artifact", async () => {
		const root = await fixtureCopy(teamSupportDesk, "atomic-empty");
		const outputDirectory = join(root, ".questpie/generated");
		await compileApplication({ applicationRoot: root, outputDirectory });
		for (const relativePath of [
			"src/tickets/queries.ts",
			"src/ticket-mutations.ts",
			"src/notification-action.ts",
			"src/tickets/operations.ts",
		]) {
			const path = join(root, relativePath);
			await writeFile(
				path,
				removeObjectProperties(await readFile(path, "utf8"), "describe"),
			);
		}
		await compileApplication({ applicationRoot: root, outputDirectory });
		expect(
			JSON.parse(
				await readFile(
					join(outputDirectory, "operation-documentation.json"),
					"utf8",
				),
			),
		).toEqual({
			format: "questpie.operation-documentation",
			version: 1,
			operations: [],
		});
	});

	test("uses the same primitive for activated Package documentation", async () => {
		const root = await fixtureCopy(collaboration, "package-parity");
		const packageSource = join(root, "packages/audit/src/questpie.ts");
		await writeFile(
			packageSource,
			`${await readFile(packageSource, "utf8")}

import { codec } from "questpie";
import { defineQuery } from "#questpie/package";

export const auditEntry = defineQuery({
	name: "audit.entry",
	input: codec.object({ id: codec.uuid() }),
	output: codec.object({ id: codec.uuid() }),
	describe: {
		summary: "Fetch one audit entry",
		examples: [{ input: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131" } }],
	},
	handler: ({ input }) => ({ id: input.id }),
});
`,
		);
		const inventory = await expectDiagnostic(
			() => compileApplication({ applicationRoot: root }),
			"QP-COMPOSE-008",
		);
		const configPath = join(root, "questpie.json");
		const configuration = JSON.parse(await readFile(configPath, "utf8"));
		configuration.packages["@questpie/collaboration-audit"].inventoryDigest =
			inventory.details.actual;
		await writeFile(configPath, JSON.stringify(configuration, null, 2));
		const compiled = await compileApplication({ applicationRoot: root });
		const artifact = JSON.parse(
			compiled.generatedFiles["operation-documentation.json"] ?? "null",
		);
		expect(
			artifact.operations.find(
				({ identity }: { identity: string }) =>
					identity === "query:audit.entry",
			),
		).toMatchObject({ summary: "Fetch one audit entry" });

		await writeFile(
			packageSource,
			(await readFile(packageSource, "utf8")).replace(
				'summary: "Fetch one audit entry"',
				'summary: " invalid package prose"',
			),
		);
		const diagnostic = await expectDiagnostic(
			() => compileApplication({ applicationRoot: root }),
			"QP-COMPOSE-030",
		);
		expect(diagnostic.diagnosticClass).toBe("invalidDocumentation");
		expect(diagnostic.details).toMatchObject({
			reason: "invalidText",
			origin: { module: "src/questpie.ts" },
			path: ["describe", "summary"],
		});
	});

	test("reports the exact Origin of an unknown Collection member", async () => {
		const root = await fixtureCopy(teamSupportDesk, "collection-member-origin");
		const operationPath = join(root, "src/tickets/operations.ts");
		const marker = "descriptin: true";
		const source = (await readFile(operationPath, "utf8")).replace(
			"\t\tdescribe: {",
			`\t\t${marker},\n\t\tdescribe: {`,
		);
		await writeFile(operationPath, source);
		const diagnostic = await expectDiagnostic(
			() => compileApplication({ applicationRoot: root }),
			"QP-COMPOSE-030",
		);
		expect(diagnostic.details).toEqual({
			reason: "unexpectedOperationMember",
			origin: {
				module: "src/tickets/operations.ts",
				...textOrigin(source, marker),
			},
			path: ["query:tickets.get", "descriptin"],
		});
	});
});
