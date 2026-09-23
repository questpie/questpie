import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import { digest } from "../../packages/compiler/src/canonical";
import { decodeMcpProjection } from "../../packages/runtime/src/application/mcp";

// Captured once from the pre-ADR-0049 compiler (commit 71d38a53a, the
// unconditional-`outputSchema` ADR-0038 shape) compiling this exact fixture
// with `projections.mcp: true`. Keyed by Operation identity; each value is
// that Operation's complete `outputSchema`, byte-for-byte, including its
// `$schema` and every `uuid` field's `format`+`pattern` pair. ADR-0049's
// opt-in (`projections.mcp: { outputSchema: true }`) must reproduce this
// exactly — see the "restores outputSchema byte-identical" test below.
const outputSchemaGoldenPath = resolve(
	import.meta.dir,
	"__fixtures__/mcp01-outputschema-golden.json",
);

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
 * ADR-0049: `inputSchema` omits only its own top-level `$schema` key (MCP
 * treats an absent `$schema` as 2020-12, the version this compiler always
 * emits). This checks exactly that one key on the object the compiler
 * assembles itself — it deliberately does not walk into `properties`,
 * `examples`, or any other nested/user-authored data, because those can
 * legitimately contain keys named `$schema` or `pattern` as ordinary domain
 * data (an Operation's documented example payload, for instance), and a
 * recursive walk would misreport or, worse, silently strip those instead of
 * only ever touching the one key this ADR actually changes.
 */
function assertNoTopLevelSchemaDialect(
	inputSchema: Record<string, unknown>,
	label: string,
): void {
	expect(inputSchema, `${label} has no top-level $schema`).not.toHaveProperty(
		"$schema",
	);
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

	test("ADR-0049: default catalogue's inputSchema drops only the top-level $schema", async () => {
		const root = await selectedFixture("diet-default");
		const compilation = await compileApplication({ applicationRoot: root });
		const catalogue = JSON.parse(
			compilation.generatedFiles["mcp-projection.json"]!,
		);

		expect(catalogue.tools.length).toBeGreaterThan(0);
		for (const { tool } of catalogue.tools) {
			expect(tool).not.toHaveProperty("outputSchema");
			assertNoTopLevelSchemaDialect(
				tool.inputSchema,
				`${tool.name}.inputSchema`,
			);
		}
		// tickets.detail's `input.id` is a uuid. `inputSchema` stays
		// codec-exact apart from the omitted top-level `$schema`: a uuid
		// field keeps BOTH `format: "uuid"` and its `pattern` — `format` is
		// annotation-only in JSON Schema 2020-12 (it does not itself
		// constrain validation) and the codec accepts only lowercase hex,
		// which the RFC-4122 `format: "uuid"` keyword alone does not pin
		// down (RFC 4122 permits uppercase). Dropping `pattern` here would
		// have silently widened what MCP callers are told is valid input.
		const query = catalogue.tools.find(
			({ identity }: { identity: string }) =>
				identity === "query:tickets.detail",
		);
		expect(query.tool.inputSchema.properties.input.properties.id).toEqual({
			type: "string",
			format: "uuid",
			pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
		});
	});

	test("ADR-0049: measures the default catalogue's byte reduction against the pre-diet baseline", async () => {
		// Baseline measured directly on this fixture before ADR-0049
		// (`projections.mcp: true`, ADR-0038's unconditional `outputSchema`,
		// `$schema` on every schema): 12 tools, 91,704 bytes for the
		// compact-serialized `tools` array that lands in `tools/list`'s
		// `result.tools` (same bytes captured in
		// `__fixtures__/mcp01-outputschema-golden.json`'s source run). See
		// ADR-0049's "Measured effect" section for the reproduction.
		//
		// Default (post-ADR-0049, `outputSchema` off, `inputSchema` missing
		// only its top-level `$schema`, uuid `pattern` retained), measured
		// on this same fixture: 14,379 bytes (1,198.3 B/tool avg) — an 84.3%
		// reduction. This test asserts the default catalogue stays under
		// 25,000 bytes (comfortable headroom above the measured 14,379 for
		// fixture drift) and under 30% of the baseline, which still proves
		// the reduction is dominated by dropping `outputSchema`, not by the
		// much smaller `$schema` omission alone (§ADR-0049 "Measured
		// effect": dropping `$schema` alone saves ~2%, not ~84%).
		const baselineBytes = 91_704;
		const ceilingBytes = 25_000;
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
		expect(toolsArrayBytes).toBeLessThan(baselineBytes * 0.3);
	});

	test("ADR-0049: projections.mcp.outputSchema restores outputSchema byte-identical to ADR-0038", async () => {
		const golden: Record<string, unknown> = JSON.parse(
			await readFile(outputSchemaGoldenPath, "utf8"),
		);

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
		expect(Object.keys(golden).sort()).toEqual(
			optInCatalogue.tools
				.map(({ identity }: { identity: string }) => identity)
				.sort(),
		);
		// The real proof: every opted-in tool's outputSchema deep-equals the
		// exact bytes the pre-ADR-0049 compiler (commit 71d38a53a) produced
		// for the same Operation — not just "has the right shape", but
		// identical down to key order-independent structural equality
		// (toEqual), including $schema and every uuid format+pattern pair.
		for (const { identity, tool } of optInCatalogue.tools) {
			expect(tool).toHaveProperty("outputSchema");
			expect(tool.outputSchema).toEqual(golden[identity]);
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
		).rejects.toThrow(
			/projections\.mcp must be true or \{ outputSchema: true \}/,
		);
		// The key omitted entirely (not just set to a wrong value) must fail
		// with the same accurate message — not a "when present" phrasing
		// that would be misleading for a key that isn't present at all.
		await expect((await withProjections({ mcp: {} }))()).rejects.toThrow(
			/projections\.mcp must be true or \{ outputSchema: true \}/,
		);
		await expect(
			(await withProjections({ mcp: { outputSchema: true, extra: true } }))(),
		).rejects.toThrow(/projections\.mcp has unknown key extra/);
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
