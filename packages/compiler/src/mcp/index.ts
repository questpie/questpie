import { canonicalBytes, compareAscii, digest } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import {
	projectOperationDocumentationEntries,
	projectOperationCodecSchema,
	type DocumentationEntry,
} from "../operation-projection";
import { projectMcpOutcomeSchema } from "./schema";

type JsonRecord = Readonly<Record<string, unknown>>;

type OperationContract = Readonly<{
	identity: string;
	input: unknown;
	output: unknown;
	declaredErrors: unknown;
}>;

type Origin = Readonly<{
	identity: string;
	establishedAt: JsonRecord;
}>;

export interface McpProjectionInput {
	readonly contextCodec: unknown;
	readonly operationContracts: Readonly<{
		operations: readonly OperationContract[];
	}>;
	readonly operationContractDigest: string;
	readonly httpContract: Readonly<{
		digest: string;
		failures: readonly string[];
		operations: readonly OperationContract[];
	}>;
	readonly documentationBytes: string;
	readonly documentationDigest: string;
	readonly origins: readonly Origin[];
	/**
	 * ADR-0049: `outputSchema` is omitted from every tool by default. Setting
	 * this to `true` (application config `projections.mcp.outputSchema: true`)
	 * restores the exact ADR-0038 `outputSchema` shape, byte-for-byte,
	 * including its top-level `$schema`. It is not affected by the
	 * default-mode omission of `inputSchema`'s top-level `$schema` (see
	 * `tool` below) — the two schemas are independent objects.
	 */
	readonly includeOutputSchema: boolean;
}

const protocolVersion = "2026-07-28";
const protocolDigest = "5f5440bb26a62e2cf3440b92da5a667efa03b267";
const toolNamePattern = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,126}[A-Za-z0-9])?$/u;

function operationKind(identity: string): "action" | "mutation" | "query" {
	const kind = identity.slice(0, identity.indexOf(":"));
	if (kind !== "action" && kind !== "mutation" && kind !== "query")
		throw new TypeError("invalid Operation identity in MCP projection");
	return kind;
}

function operationName(identity: string): string {
	return identity.slice(identity.indexOf(":") + 1);
}

function invocationIdentitySchema(): JsonRecord {
	return {
		type: "string",
		minLength: 1,
		maxLength: 256,
		"x-questpie-runtime-validation": {
			requirements: ["maxUtf8Bytes:1024", "nfc", "noNull", "noLoneSurrogate"],
		},
	};
}

function originFor(identity: string, origins: readonly Origin[]): JsonRecord {
	return (
		origins.find((candidate) => candidate.identity === identity)
			?.establishedAt ?? {
			identity,
		}
	);
}

function invalidToolName(
	identity: string,
	name: string,
	origin: JsonRecord,
): never {
	throw new CompilerDiagnosticError(
		"QP-COMPOSE-024",
		"operationProjectionUnsafeName",
		`${identity} cannot project MCP tool ${name}`,
		{
			kind: "mcpTool",
			name,
			rewrite:
				"rename the Operation so <kind>.<qualified-name> is 1-128 MCP characters",
			origins: [origin],
		},
	);
}

function tool(
	operation: OperationContract,
	contextCodec: unknown,
	failures: readonly string[],
	documentation: DocumentationEntry | undefined,
	origin: JsonRecord,
	includeOutputSchema: boolean,
) {
	const kind = operationKind(operation.identity);
	const name = `${kind}.${operationName(operation.identity)}`;
	if (!toolNamePattern.test(name))
		invalidToolName(operation.identity, name, origin);
	const inputExamples = documentation?.examples?.map(
		(example) => example.input,
	);
	const properties: Record<string, unknown> = {
		context: projectOperationCodecSchema(contextCodec),
		input: {
			...projectOperationCodecSchema(operation.input),
			...(inputExamples && inputExamples.length > 0
				? { examples: inputExamples }
				: {}),
		},
	};
	if (kind === "mutation" || kind === "query")
		properties.callId = invocationIdentitySchema();
	if (kind === "action") {
		properties.callId = invocationIdentitySchema();
		properties.effectKey = invocationIdentitySchema();
	}
	const required = ["context", "input"];
	if (kind === "mutation") required.push("callId");
	if (kind === "action") required.push("effectKey");
	return {
		identity: operation.identity,
		kind,
		tool: {
			name,
			...(documentation
				? {
						title: documentation.summary,
						description: documentation.description
							? `${documentation.summary}\n\n${documentation.description}`
							: documentation.summary,
					}
				: {}),
			// ADR-0049: no top-level `$schema` (an absent `$schema` is
			// treated as 2020-12, the only dialect this compiler emits).
			// Every codec-derived schema below `type`/`properties`/`required`
			// is untouched — codec-exact, same as ADR-0038's original shape,
			// including a `uuid` field's `format` and `pattern` together.
			inputSchema: {
				type: "object",
				additionalProperties: false,
				properties: Object.fromEntries(
					Object.entries(properties).sort(([left], [right]) =>
						compareAscii(left, right),
					),
				),
				required: required.sort(compareAscii),
			},
			...(includeOutputSchema
				? {
						outputSchema: projectMcpOutcomeSchema(
							operation,
							failures,
							documentation,
						),
					}
				: {}),
			...(kind === "query" ? { annotations: { readOnlyHint: true } } : {}),
		},
	};
}

export function projectMcpProjection(input: McpProjectionInput) {
	const documentation = new Map(
		projectOperationDocumentationEntries({
			documentationBytes: input.documentationBytes,
			documentationDigest: input.documentationDigest,
		}).map((entry) => [entry.identity, entry]),
	);
	const projected = input.httpContract.operations
		.map((operation) => {
			const origin = originFor(operation.identity, input.origins);
			return {
				origin,
				...tool(
					operation,
					input.contextCodec,
					input.httpContract.failures,
					documentation.get(operation.identity),
					origin,
					input.includeOutputSchema,
				),
			};
		})
		.sort((left, right) => compareAscii(left.tool.name, right.tool.name));
	for (let index = 1; index < projected.length; index += 1) {
		const left = projected[index - 1]!;
		const right = projected[index]!;
		if (left.tool.name !== right.tool.name) continue;
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-023",
			"operationProjectionCollision",
			`${left.identity} and ${right.identity} project duplicate MCP tool ${left.tool.name}`,
			{
				kind: "mcpTool",
				name: left.tool.name,
				origins: [left.origin, right.origin],
				missingAuthority: "globally unique Operation identity",
			},
		);
	}
	const contextCodecDigest = digest(
		"questpie-mcp-context-codec-v1",
		input.contextCodec,
	);
	const withoutDigest = {
		format: "questpie.mcp-projection",
		version: 1,
		protocolVersion,
		protocolDigest,
		endpoint: { method: "POST", path: "/_questpie/mcp" },
		cacheScope: "public",
		ttlMs: 0,
		operationContractDigest: input.operationContractDigest,
		operationHttpContractDigest: input.httpContract.digest,
		operationDocumentationDigest: input.documentationDigest,
		contextCodecDigest,
		tools: projected.map(({ origin: _origin, ...entry }) => entry),
	};
	const artifact = {
		...withoutDigest,
		digest: digest("questpie-mcp-projection-v1", withoutDigest),
	};
	const network = new Set(
		input.httpContract.operations.map((operation) => operation.identity),
	);
	const direct = new Set(
		input.operationContracts.operations.map((operation) => operation.identity),
	);
	const explain = {
		format: "questpie.mcp-projection-explain",
		version: 1,
		selected: true,
		catalogueDigest: artifact.digest,
		operationContractDigest: input.operationContractDigest,
		operationDocumentationDigest: input.documentationDigest,
		operationHttpContractDigest: input.httpContract.digest,
		contextCodecDigest,
		operations: input.origins
			.filter(
				({ identity }) => direct.has(identity) || identity.startsWith("route:"),
			)
			.map(({ identity, establishedAt }) =>
				network.has(identity)
					? {
							identity,
							disposition: "included",
							toolName: `${operationKind(identity)}.${operationName(identity)}`,
							origin: establishedAt,
						}
					: {
							identity,
							disposition: "omitted",
							reason: identity.startsWith("route:")
								? "rawRouteUnsupported"
								: "directOnly",
							origin: establishedAt,
						},
			)
			.sort((left, right) =>
				compareAscii(String(left.identity), String(right.identity)),
			),
	};
	return {
		artifact,
		bytes: canonicalBytes(artifact),
		explain,
		explainBytes: canonicalBytes(explain),
	};
}
