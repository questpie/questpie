import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	compileApplication,
	CompilerDiagnosticError,
} from "@questpie/compiler";

setDefaultTimeout(90_000);

const fixture = resolve(import.meta.dir, "../../fixtures/collaboration");
const temporaryRoots: string[] = [];

afterAll(async () => {
	await Promise.all(
		temporaryRoots.map((root) => rm(root, { force: true, recursive: true })),
	);
});

async function expectInventoryDigest(root: string): Promise<string> {
	try {
		await compileApplication({ applicationRoot: root });
	} catch (error) {
		expect(error).toBeInstanceOf(CompilerDiagnosticError);
		const diagnostic = error as CompilerDiagnosticError;
		expect(diagnostic.code).toBe("QP-COMPOSE-008");
		expect(diagnostic.details.actual).toMatch(/^[0-9a-f]{64}$/);
		return String(diagnostic.details.actual);
	}
	throw new Error("expected activated Package inventory mismatch");
}

test("compiles an activated Package-owned network Operation into MCP", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-mcp03-package-"));
	temporaryRoots.push(root);
	await cp(fixture, root, { recursive: true });
	const packageSource = join(root, "packages/audit/src/questpie.ts");
	await writeFile(
		packageSource,
		`${await readFile(packageSource, "utf8")}

import { codec } from "questpie";
import { defineQuery } from "#questpie/package";

export const auditEntry = defineQuery({
	name: "audit.entry",
	network: true,
	input: codec.object({ id: codec.uuid() }),
	output: codec.object({ id: codec.uuid() }),
	describe: { summary: "Fetch one Package audit entry" },
	handler: ({ input }) => ({ id: input.id }),
});
`,
	);

	const configurationPath = join(root, "questpie.json");
	const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
	configuration.packages["@questpie/collaboration-audit"].inventoryDigest =
		await expectInventoryDigest(root);
	await writeFile(
		configurationPath,
		`${JSON.stringify(configuration, null, "\t")}\n`,
	);

	const compilation = await compileApplication({ applicationRoot: root });
	const catalogue = JSON.parse(
		compilation.generatedFiles["mcp-projection.json"] ?? "null",
	);
	const explain = JSON.parse(
		compilation.generatedFiles["mcp-projection-explain.json"] ?? "null",
	);

	expect(
		catalogue.tools.find(
			({ identity }: { identity: string }) => identity === "query:audit.entry",
		),
	).toMatchObject({
		identity: "query:audit.entry",
		kind: "query",
		tool: {
			name: "query.audit.entry",
			title: "Fetch one Package audit entry",
			annotations: { readOnlyHint: true },
		},
	});
	expect(
		explain.operations.find(
			({ identity }: { identity: string }) => identity === "query:audit.entry",
		),
	).toMatchObject({
		identity: "query:audit.entry",
		disposition: "included",
		toolName: "query.audit.entry",
		origin: {
			kind: "export",
			packageId: expect.stringMatching(/^[0-9a-f]{64}$/),
			path: "src/questpie.ts",
			exportName: "auditEntry",
		},
	});

	await writeFile(
		packageSource,
		(await readFile(packageSource, "utf8")).replace("\tnetwork: true,\n", ""),
	);
	configuration.packages["@questpie/collaboration-audit"].inventoryDigest =
		await expectInventoryDigest(root);
	await writeFile(
		configurationPath,
		`${JSON.stringify(configuration, null, "\t")}\n`,
	);
	const directOnly = await compileApplication({ applicationRoot: root });
	const directOnlyCatalogue = JSON.parse(
		directOnly.generatedFiles["mcp-projection.json"] ?? "null",
	);
	expect(
		directOnlyCatalogue.tools.some(
			({ identity }: { identity: string }) => identity === "query:audit.entry",
		),
	).toBe(false);
});
