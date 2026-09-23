import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import { digest } from "../../packages/compiler/src/canonical";
import { decodeMcpProjection } from "../../packages/runtime/src/application/mcp";

setDefaultTimeout(90_000);

const fixture = resolve(import.meta.dir, "../../fixtures/team-support-desk");
const temporaryRoots: string[] = [];

async function selectedFixture(
	label: string,
	mcp: true | Readonly<{ outputSchema: true }> = true,
): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `questpie-mcp01-${label}-`));
	temporaryRoots.push(root);
	await cp(fixture, root, { recursive: true });
	const configurationPath = join(root, "questpie.json");
	const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
	configuration.projections = { mcp };
	await writeFile(
		configurationPath,
		JSON.stringify(configuration, null, "\t") + "\n",
	);
	return root;
}

/**
 * ADR-0049: every `format: "uuid"` schema node, wherever it appears (nested
 * arbitrarily deep in objects/arrays), must carry no `pattern`. Walks the
 * whole tree instead of asserting on one known field path so a
 * newly-added uuid field anywhere in the schema is covered automatically.
 */
function assertNoRedundantUuidPattern(node: unknown, path: string): void {
	if (Array.isArray(node)) {
		node.forEach((item, index) =>
			assertNoRedundantUuidPattern(item, `${path}[${index}]`),
		);
		return;
	}
	if (!node || typeof node !== "object") return;
	const record = node as Record<string, unknown>;
	if (record.format === "uuid")
		expect(record, `${path} is a uuid schema node`).not.toHaveProperty(
			"pattern",
		);
	for (const [key, value] of Object.entries(record))
		assertNoRedundantUuidPattern(value, `${path}.${key}`);
}

/**
 * ADR-0049: no schema node anywhere in the tool tree carries `$schema` (the
 * JSON Schema dialect declaration is a fixed, repeated, non-per-tool fact).
 */
function assertNoSchemaDialectDeclaration(node: unknown, path: string): void {
	if (Array.isArray(node)) {
		node.forEach((item, index) =>
			assertNoSchemaDialectDeclaration(item, `${path}[${index}]`),
		);
		return;
	}
	if (!node || typeof node !== "object") return;
	const record = node as Record<string, unknown>;
	expect(record, `${path} has no $schema`).not.toHaveProperty("$schema");
	for (const [key, value] of Object.entries(record))
		assertNoSchemaDialectDeclaration(value, `${path}.${key}`);
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
		expect(
			decodeMcpProjection({
				bytes: compilation.generatedFiles["mcp-projection.json"],
				digest: catalogue.digest,
				operationContractDigest: runtimeBuild.operationContractsDigest,
				operationHttpContractDigest: runtimeBuild.operationHttpContractDigest,
			})?.tools.map(({ tool }) => tool.name),
		).toEqual(
			catalogue.tools.map(({ tool }: { tool: { name: string } }) => tool.name),
		);

		const reorderedUnsigned = {
			...unsignedCatalogue,
			tools: catalogue.tools.toReversed(),
		};
		const reordered = {
			...reorderedUnsigned,
			digest: digest("questpie-mcp-projection-v1", reorderedUnsigned),
		};
		expect(() =>
			decodeMcpProjection({
				bytes: JSON.stringify(reordered),
				digest: reordered.digest,
				operationContractDigest: runtimeBuild.operationContractsDigest,
				operationHttpContractDigest: runtimeBuild.operationHttpContractDigest,
			}),
		).toThrow("MCP tool contract is invalid");
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
		// ADR-0049: outputSchema is opt-in and off by default.
		expect(query.tool).not.toHaveProperty("outputSchema");
		expect(mutation.tool).not.toHaveProperty("outputSchema");
		expect(action.tool).not.toHaveProperty("outputSchema");
	});

	test("ADR-0049: default catalogue carries no $schema and no redundant uuid pattern", async () => {
		const root = await selectedFixture("diet-default");
		const compilation = await compileApplication({ applicationRoot: root });
		const catalogue = JSON.parse(
			compilation.generatedFiles["mcp-projection.json"]!,
		);

		expect(catalogue.tools.length).toBeGreaterThan(0);
		for (const { tool } of catalogue.tools) {
			expect(tool).not.toHaveProperty("outputSchema");
			assertNoSchemaDialectDeclaration(
				tool.inputSchema,
				`${tool.name}.inputSchema`,
			);
			assertNoRedundantUuidPattern(
				tool.inputSchema,
				`${tool.name}.inputSchema`,
			);
		}
		// tickets.detail's `input.id` is a uuid — confirm the walk actually
		// found a uuid node, not that it vacuously passed on an empty tree.
		const query = catalogue.tools.find(
			({ identity }: { identity: string }) =>
				identity === "query:tickets.detail",
		);
		expect(query.tool.inputSchema.properties.input.properties.id).toMatchObject(
			{ type: "string", format: "uuid" },
		);
		expect(
			query.tool.inputSchema.properties.input.properties.id,
		).not.toHaveProperty("pattern");
	});

	test("ADR-0049: measures the default catalogue's byte reduction against the pre-diet baseline", async () => {
		// Baseline measured directly on this fixture before ADR-0049
		// (`projections.mcp: true`, ADR-0038's unconditional `outputSchema`,
		// `$schema` on every schema, full uuid format+pattern pairs): 12
		// tools, 91,704 bytes for the compact-serialized `tools` array that
		// lands in `tools/list`'s `result.tools`. See ADR-0049's "Measured
		// effect" section for the reproduction. This test asserts the
		// default (post-ADR-0049) catalogue stays under 20,000 bytes — well
		// under half the baseline, proving the reduction, with headroom
		// above the actually-measured 11,604 bytes for fixture drift.
		const baselineBytes = 91_704;
		const ceilingBytes = 20_000;
		const root = await selectedFixture("diet-size");
		const compilation = await compileApplication({ applicationRoot: root });
		const catalogue = JSON.parse(
			compilation.generatedFiles["mcp-projection.json"]!,
		);
		const toolsArrayBytes = Buffer.byteLength(
			JSON.stringify(
				catalogue.tools.map((entry: { tool: unknown }) => entry.tool),
			),
		);

		expect(toolsArrayBytes).toBeLessThan(ceilingBytes);
		expect(toolsArrayBytes).toBeLessThan(baselineBytes * 0.2);
	});

	test("ADR-0049: projections.mcp.outputSchema restores outputSchema byte-identical to ADR-0038", async () => {
		const defaultRoot = await selectedFixture("diet-optin-default", true);
		const optInRoot = await selectedFixture("diet-optin-restored", {
			outputSchema: true,
		});
		const [defaultCompilation, optInCompilation] = await Promise.all([
			compileApplication({ applicationRoot: defaultRoot }),
			compileApplication({ applicationRoot: optInRoot }),
		]);
		const defaultCatalogue = JSON.parse(
			defaultCompilation.generatedFiles["mcp-projection.json"]!,
		);
		const optInCatalogue = JSON.parse(
			optInCompilation.generatedFiles["mcp-projection.json"]!,
		);
		const defaultRuntimeBuild = JSON.parse(
			defaultCompilation.generatedFiles["runtime-build.json"]!,
		);
		const optInRuntimeBuild = JSON.parse(
			optInCompilation.generatedFiles["runtime-build.json"]!,
		);

		// The runtime artifact decoder accepts both an outputSchema-absent
		// (default) and an outputSchema-present (opt-in) tool binding.
		expect(
			decodeMcpProjection({
				bytes: defaultCompilation.generatedFiles["mcp-projection.json"],
				digest: defaultCatalogue.digest,
				operationContractDigest: defaultRuntimeBuild.operationContractsDigest,
				operationHttpContractDigest:
					defaultRuntimeBuild.operationHttpContractDigest,
			})?.tools.every(({ tool }) => !("outputSchema" in tool)),
		).toBe(true);
		expect(
			decodeMcpProjection({
				bytes: optInCompilation.generatedFiles["mcp-projection.json"],
				digest: optInCatalogue.digest,
				operationContractDigest: optInRuntimeBuild.operationContractsDigest,
				operationHttpContractDigest:
					optInRuntimeBuild.operationHttpContractDigest,
			})?.tools.every(({ tool }) => "outputSchema" in tool),
		).toBe(true);

		for (const { tool } of defaultCatalogue.tools)
			expect(tool).not.toHaveProperty("outputSchema");

		expect(optInCatalogue.tools.length).toBe(defaultCatalogue.tools.length);
		for (const { identity, tool } of optInCatalogue.tools) {
			expect(tool).toHaveProperty("outputSchema");
			// Exactly ADR-0038's shape: $schema present, closed oneOf with a
			// success frame plus one branch per declared/framework error.
			expect(tool.outputSchema.$schema).toBe(
				"https://json-schema.org/draft/2020-12/schema",
			);
			expect(tool.outputSchema.oneOf[0]).toMatchObject({
				type: "object",
				additionalProperties: false,
				required: ["callId", "result"],
			});
			if (identity === "action:notification.sendTicketSummary")
				expect(
					tool.outputSchema.oneOf
						.filter(
							(frame: {
								properties?: {
									error?: { properties?: { code?: { const?: string } } };
								};
							}) =>
								frame.properties?.error?.properties?.code?.const ===
								"RESOURCE_LIMIT",
						)
						.map(
							(frame: {
								properties: {
									error: { properties: { retryable: { const: boolean } } };
								};
							}) => frame.properties.error.properties.retryable.const,
						)
						.sort(),
				).toEqual([false, true]);
		}

		// The opt-in path does not change inputSchema's ADR-0049 diet: it
		// still has no $schema and no redundant uuid pattern. Only
		// outputSchema's presence and content change between the two roots.
		for (const { tool } of optInCatalogue.tools) {
			assertNoSchemaDialectDeclaration(
				tool.inputSchema,
				`${tool.name}.inputSchema`,
			);
			assertNoRedundantUuidPattern(
				tool.inputSchema,
				`${tool.name}.inputSchema`,
			);
		}
	});

	test("ADR-0049: projections.mcp validates the outputSchema opt-in shape", async () => {
		const root = await mkdtemp(join(tmpdir(), "questpie-mcp01-diet-invalid-"));
		temporaryRoots.push(root);
		await cp(fixture, root, { recursive: true });
		const configurationPath = join(root, "questpie.json");
		const base = JSON.parse(await readFile(configurationPath, "utf8"));

		async function withProjections(
			projections: unknown,
		): Promise<() => Promise<unknown>> {
			await writeFile(
				configurationPath,
				JSON.stringify({ ...base, projections }, null, "\t") + "\n",
			);
			return () => compileApplication({ applicationRoot: root });
		}

		await expect(
			(await withProjections({ mcp: { outputSchema: false } }))(),
		).rejects.toThrow(/projections\.mcp\.outputSchema/);
		await expect(
			(await withProjections({ mcp: { outputSchema: true, extra: true } }))(),
		).rejects.toThrow(/projections\.mcp/);
		await expect(
			(await withProjections({ mcp: { outputSchema: true } }))(),
		).resolves.toBeTruthy();
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
