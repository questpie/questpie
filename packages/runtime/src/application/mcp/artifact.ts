import {
	exactRuntimeArtifactKeys as exact,
	failRuntimeArtifact as fail,
	runtimeArtifactDigest as artifactDigest,
	runtimeArtifactDigestValue as digestValue,
	runtimeArtifactRecord as artifactRecord,
} from "../artifact-protocol";
import { MCP_PROTOCOL_VERSION, type McpToolBinding } from "./contract";

export function decodeMcpProjection(
	input: Readonly<{
		bytes: Uint8Array | string | undefined;
		digest: string | null | undefined;
		operationContractDigest: string;
		operationHttpContractDigest: string;
	}>,
): Readonly<{ tools: readonly McpToolBinding[] }> | null {
	if (input.digest == null) {
		if (input.bytes !== undefined) fail("unselected MCP projection is present");
		return null;
	}
	digestValue(input.digest, "mcpProjectionDigest");
	if (input.bytes === undefined) fail("selected MCP projection is missing");
	let parsed: unknown;
	try {
		parsed = JSON.parse(
			typeof input.bytes === "string"
				? input.bytes
				: new TextDecoder("utf-8", { fatal: true }).decode(input.bytes),
		);
	} catch {
		fail("MCP projection is not canonical JSON");
	}
	const artifact = artifactRecord(parsed, "MCP projection");
	exact(
		artifact,
		[
			"format",
			"version",
			"protocolVersion",
			"protocolDigest",
			"endpoint",
			"cacheScope",
			"ttlMs",
			"operationContractDigest",
			"operationHttpContractDigest",
			"operationDocumentationDigest",
			"contextCodecDigest",
			"tools",
			"digest",
		],
		"MCP projection",
	);
	const { digest, ...unsigned } = artifact;
	if (
		artifact.format !== "questpie.mcp-projection" ||
		artifact.version !== 1 ||
		artifact.protocolVersion !== MCP_PROTOCOL_VERSION ||
		artifact.protocolDigest !== "5f5440bb26a62e2cf3440b92da5a667efa03b267" ||
		artifact.cacheScope !== "public" ||
		artifact.ttlMs !== 0 ||
		digest !== input.digest ||
		artifactDigest("questpie-mcp-projection-v1", unsigned) !== input.digest ||
		artifact.operationContractDigest !== input.operationContractDigest ||
		artifact.operationHttpContractDigest !==
			input.operationHttpContractDigest ||
		!Array.isArray(artifact.tools)
	)
		fail("MCP projection binding is invalid");
	digestValue(
		artifact.operationDocumentationDigest,
		"MCP operationDocumentationDigest",
	);
	digestValue(artifact.contextCodecDigest, "MCP contextCodecDigest");
	const endpoint = artifactRecord(artifact.endpoint, "MCP endpoint");
	exact(endpoint, ["method", "path"], "MCP endpoint");
	if (endpoint.method !== "POST" || endpoint.path !== "/_questpie/mcp")
		fail("MCP endpoint binding is invalid");
	const identities = new Set<string>();
	const names = new Set<string>();
	let previousName: string | undefined;
	const tools = artifact.tools.map((raw, index) => {
		const binding = artifactRecord(raw, `MCP tool ${index}`);
		exact(binding, ["identity", "kind", "tool"], `MCP tool ${index}`);
		if (
			typeof binding.identity !== "string" ||
			(binding.kind !== "query" &&
				binding.kind !== "mutation" &&
				binding.kind !== "action")
		)
			fail("MCP tool binding is invalid");
		const tool = artifactRecord(binding.tool, `MCP tool ${index} contract`);
		const hasDocumentation =
			Object.hasOwn(tool, "title") || Object.hasOwn(tool, "description");
		// ADR-0049: `outputSchema` is opt-in (`projections.mcp.outputSchema: true`)
		// and absent by default, unlike `inputSchema`, which every tool always
		// carries.
		const hasOutputSchema = Object.hasOwn(tool, "outputSchema");
		exact(
			tool,
			[
				"name",
				"inputSchema",
				...(hasOutputSchema ? ["outputSchema"] : []),
				...(hasDocumentation ? ["title", "description"] : []),
				...(binding.kind === "query" ? ["annotations"] : []),
			],
			`MCP tool ${index} contract`,
		);
		const expectedName = `${binding.kind}.${binding.identity.slice(
			binding.identity.indexOf(":") + 1,
		)}`;
		if (
			typeof tool.name !== "string" ||
			binding.identity.indexOf(":") <= 0 ||
			!binding.identity.startsWith(`${binding.kind}:`) ||
			expectedName !== tool.name ||
			!/^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,126}[A-Za-z0-9])?$/u.test(tool.name) ||
			identities.has(binding.identity) ||
			names.has(tool.name) ||
			(previousName !== undefined && previousName >= tool.name)
		)
			fail("MCP tool contract is invalid");
		artifactRecord(tool.inputSchema, `MCP tool ${index} input schema`);
		if (hasOutputSchema)
			artifactRecord(tool.outputSchema, `MCP tool ${index} output schema`);
		if (
			hasDocumentation &&
			(typeof tool.title !== "string" ||
				tool.title.length === 0 ||
				typeof tool.description !== "string" ||
				tool.description.length === 0)
		)
			fail("MCP tool documentation is invalid");
		if (binding.kind === "query") {
			const annotations = artifactRecord(
				tool.annotations,
				`MCP tool ${index} annotations`,
			);
			exact(annotations, ["readOnlyHint"], `MCP tool ${index} annotations`);
			if (annotations.readOnlyHint !== true)
				fail("MCP Query annotation is invalid");
		}
		identities.add(binding.identity);
		names.add(tool.name);
		previousName = tool.name;
		return {
			identity: binding.identity,
			kind: binding.kind,
			tool,
		} as McpToolBinding;
	});
	return Object.freeze({ tools: Object.freeze(tools) });
}
