import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import { digest } from "../../packages/compiler/src/canonical";

setDefaultTimeout(90_000);

const fixture = resolve(import.meta.dir, "../../fixtures/team-support-desk");
const temporaryRoots: string[] = [];

async function selectedFixture(label: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `questpie-mcp01-${label}-`));
	temporaryRoots.push(root);
	await cp(fixture, root, { recursive: true });
	const configurationPath = join(root, "questpie.json");
	const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
	configuration.projections = { mcp: true };
	await writeFile(
		configurationPath,
		JSON.stringify(configuration, null, "\t") + "\n",
	);
	return root;
}

afterAll(async () => {
	await Promise.all(
		temporaryRoots.map((root) => rm(root, { force: true, recursive: true })),
	);
});

describe("MCP-01 compiler catalogue", () => {
	test("selects one MCP catalogue and binds only its runtime artifact", async () => {
		const root = await selectedFixture("selected");
		const compilation = await compileApplication({ applicationRoot: root });

		const catalogue = JSON.parse(
			compilation.generatedFiles["mcp-projection.json"]!,
		);
		const explain = JSON.parse(
			compilation.generatedFiles["mcp-projection-explain.json"]!,
		);
		const runtimeBuild = JSON.parse(
			compilation.generatedFiles["runtime-build.json"]!,
		);

		expect(catalogue).toMatchObject({
			format: "questpie.mcp-projection",
			version: 1,
			protocolVersion: "2026-07-28",
			endpoint: { method: "POST", path: "/_questpie/mcp" },
			cacheScope: "public",
			ttlMs: 0,
		});
		expect(catalogue.digest).toMatch(/^[0-9a-f]{64}$/);
		expect(catalogue.tools.length).toBeGreaterThan(0);
		const { digest: catalogueDigest, ...unsignedCatalogue } = catalogue;
		expect(catalogueDigest).toBe(
			digest("questpie-mcp-projection-v1", unsignedCatalogue),
		);
		expect(catalogue.operationContractDigest).toBe(
			runtimeBuild.operationContractsDigest,
		);
		expect(catalogue.operationHttpContractDigest).toBe(
			runtimeBuild.operationHttpContractDigest,
		);
		expect(runtimeBuild.mcpProjectionDigest).toBe(catalogue.digest);
		expect(explain).toMatchObject({
			format: "questpie.mcp-projection-explain",
			version: 1,
			selected: true,
		});
		expect(
			runtimeBuild.inventory.map(({ path }: { path: string }) => path),
		).toContain("mcp-projection.json");
		expect(
			runtimeBuild.inventory.map(({ path }: { path: string }) => path),
		).not.toContain("mcp-projection-explain.json");
		expect(compilation.generatedFiles).not.toHaveProperty("openapi.json");
	});

	test("derives exact documented Query, Mutation, and Action tools", async () => {
		const root = await selectedFixture("tools");
		const compilation = await compileApplication({ applicationRoot: root });
		const catalogue = JSON.parse(
			compilation.generatedFiles["mcp-projection.json"]!,
		);
		const names = catalogue.tools.map(
			({ tool }: { tool: { name: string } }) => tool.name,
		);

		expect(names).toEqual([...names].sort());
		const query = catalogue.tools.find(
			({ identity }: { identity: string }) =>
				identity === "query:tickets.detail",
		);
		const mutation = catalogue.tools.find(
			({ identity }: { identity: string }) =>
				identity === "mutation:ticket.close",
		);
		const action = catalogue.tools.find(
			({ identity }: { identity: string }) =>
				identity === "action:notification.sendTicketSummary",
		);

		expect(query).toMatchObject({
			kind: "query",
			tool: {
				name: "query.tickets.detail",
				title: "Fetch one visible support ticket",
				description:
					"Fetch one visible support ticket\n\nReturns the ticket only when the current principal may see it.",
				annotations: { readOnlyHint: true },
				inputSchema: { required: ["context", "input"] },
			},
		});
		expect(query.tool.inputSchema.properties).toHaveProperty("callId");
		expect(query.tool.inputSchema.properties.input.examples).toEqual([
			{ id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131" },
		]);
		expect(mutation.tool.inputSchema.required).toEqual([
			"callId",
			"context",
			"input",
		]);
		expect(action.tool.inputSchema.required).toEqual([
			"context",
			"effectKey",
			"input",
		]);
		expect(mutation.tool).not.toHaveProperty("annotations");
		expect(action.tool).not.toHaveProperty("annotations");
		expect(query.tool.outputSchema.$schema).toBe(
			"https://json-schema.org/draft/2020-12/schema",
		);
		expect(query.tool.outputSchema.oneOf[0]).toMatchObject({
			type: "object",
			additionalProperties: false,
			required: ["callId", "result"],
		});
	});

	test("atomically removes an unselected MCP projection", async () => {
		const root = await selectedFixture("stale");
		const outputDirectory = join(root, ".questpie/generated");
		await compileApplication({ applicationRoot: root, outputDirectory });
		expect(
			await Bun.file(join(outputDirectory, "mcp-projection.json")).exists(),
		).toBe(true);

		const configurationPath = join(root, "questpie.json");
		const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
		delete configuration.projections;
		await writeFile(
			configurationPath,
			JSON.stringify(configuration, null, "\t") + "\n",
		);
		const compilation = await compileApplication({
			applicationRoot: root,
			outputDirectory,
		});

		expect(compilation.generatedFiles).not.toHaveProperty(
			"mcp-projection.json",
		);
		expect(
			await Bun.file(join(outputDirectory, "mcp-projection.json")).exists(),
		).toBe(false);
		expect(
			await Bun.file(
				join(outputDirectory, "mcp-projection-explain.json"),
			).exists(),
		).toBe(false);
	});
});
