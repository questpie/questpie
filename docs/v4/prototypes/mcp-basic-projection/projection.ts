import { createHash } from "node:crypto";

export type OperationKind = "query" | "mutation" | "action";

export type OperationOrigin = Readonly<{
	exportName: string;
	logicalPath: string;
	packageId: string | null;
}>;

export type NetworkOperation = Readonly<{
	kind: OperationKind;
	name: string;
	network: boolean;
	origin: OperationOrigin;
	inputSchema: Readonly<Record<string, unknown>>;
	contextSchema: Readonly<Record<string, unknown>>;
	outputSchema: Readonly<Record<string, unknown>>;
	declaredErrorSchemas?: readonly Readonly<{
		code: string;
		payloadSchema: Readonly<Record<string, unknown>>;
	}>[];
	frameworkFailureSchemas: readonly Readonly<Record<string, unknown>>[];
	documentation?: Readonly<{
		summary: string;
		description?: string;
		examples?: readonly Readonly<{ input: unknown; output?: unknown }>[];
	}>;
}>;

export type McpTool = Readonly<{
	name: string;
	title?: string;
	description?: string;
	inputSchema: Readonly<Record<string, unknown>>;
	outputSchema: Readonly<Record<string, unknown>>;
	annotations?: Readonly<{ readOnlyHint: true }>;
}>;

export type McpProjectionArtifact = Readonly<{
	format: "questpie.mcp-projection";
	version: 1;
	protocolVersion: "2026-07-28";
	operationContractDigest: string;
	operationDocumentationDigest: string;
	tools: readonly Readonly<{
		identity: string;
		kind: OperationKind;
		tool: McpTool;
	}>[];
}>;

export type CompiledMcpProjection = Readonly<{
	artifact: McpProjectionArtifact;
	bytes: string;
	digest: string;
}>;

const toolNamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}[A-Za-z0-9]$/;

function outcomeSchema(
	operation: NetworkOperation,
	callIdSchema: Readonly<Record<string, unknown>>,
) {
	const outputExamples = operation.documentation?.examples
		?.filter(
			(example): example is Readonly<{ input: unknown; output: unknown }> =>
				Object.hasOwn(example, "output"),
		)
		.map(({ output }) => output);
	const result = Object.freeze({
		type: "object",
		additionalProperties: false,
		properties: Object.freeze({
			callId: callIdSchema,
			result: Object.freeze({
				...operation.outputSchema,
				...(outputExamples?.length ? { examples: outputExamples } : {}),
			}),
		}),
		required: Object.freeze(["callId", "result"]),
	});
	const declared = (operation.declaredErrorSchemas ?? [])
		.map((error) =>
			Object.freeze({
				type: "object",
				additionalProperties: false,
				properties: Object.freeze({
					callId: callIdSchema,
					error: Object.freeze({
						type: "object",
						additionalProperties: false,
						properties: Object.freeze({
							code: Object.freeze({ const: error.code }),
							payload: error.payloadSchema,
						}),
						required: Object.freeze(["code", "payload"]),
					}),
				}),
				required: Object.freeze(["callId", "error"]),
			}),
		)
		.sort((left, right) => {
			const leftCode = left.properties.error.properties.code.const;
			const rightCode = right.properties.error.properties.code.const;
			return leftCode < rightCode ? -1 : leftCode > rightCode ? 1 : 0;
		});
	return Object.freeze({
		$schema: "https://json-schema.org/draft/2020-12/schema",
		oneOf: Object.freeze([
			result,
			...declared,
			...operation.frameworkFailureSchemas,
		]),
	});
}

export function compileMcpProjection(
	input: Readonly<{
		enabled: boolean;
		operationContractDigest: string;
		operationDocumentationDigest: string;
		callIdSchema: Readonly<Record<string, unknown>>;
		effectKeySchema: Readonly<Record<string, unknown>>;
		operations: readonly NetworkOperation[];
	}>,
): CompiledMcpProjection | null {
	if (!input.enabled) return null;
	const tools = input.operations
		.filter((operation) => operation.network)
		.map((operation) => {
			let name: string;
			try {
				name = toolName(operation);
			} catch {
				throw new TypeError(
					`unsupported MCP tool identity ${operation.kind}.${operation.name} at ${originLabel(operation.origin)}`,
				);
			}
			const inputExamples = operation.documentation?.examples?.map(
				({ input: exampleInput }) => exampleInput,
			);
			const invocationProperties: Record<string, unknown> = {
				context: operation.contextSchema,
				input: Object.freeze({
					...operation.inputSchema,
					...(inputExamples?.length ? { examples: inputExamples } : {}),
				}),
			};
			if (operation.kind === "mutation" || operation.kind === "query")
				invocationProperties.callId = input.callIdSchema;
			if (operation.kind === "action") {
				invocationProperties.callId = input.callIdSchema;
				invocationProperties.effectKey = input.effectKeySchema;
			}
			const required = ["context", "input"];
			if (operation.kind === "mutation") required.push("callId");
			if (operation.kind === "action") required.push("effectKey");
			required.sort();
			const documentation = operation.documentation;
			return Object.freeze({
				origin: operation.origin,
				identity: `${operation.kind}:${operation.name}`,
				kind: operation.kind,
				tool: Object.freeze({
					name,
					...(documentation
						? {
								title: documentation.summary,
								description:
									documentation.description === undefined
										? documentation.summary
										: `${documentation.summary}\n\n${documentation.description}`,
							}
						: {}),
					inputSchema: Object.freeze({
						$schema: "https://json-schema.org/draft/2020-12/schema",
						type: "object",
						additionalProperties: false,
						properties: Object.freeze(
							Object.fromEntries(
								Object.entries(invocationProperties).sort(([left], [right]) =>
									left < right ? -1 : left > right ? 1 : 0,
								),
							),
						),
						required: Object.freeze(required),
					}),
					outputSchema: outcomeSchema(operation, input.callIdSchema),
					...(operation.kind === "query"
						? { annotations: Object.freeze({ readOnlyHint: true as const }) }
						: {}),
				}),
			});
		})
		.sort((left, right) =>
			left.tool.name < right.tool.name
				? -1
				: left.tool.name > right.tool.name
					? 1
					: 0,
		);
	for (let index = 1; index < tools.length; index += 1)
		if (tools[index - 1]!.tool.name === tools[index]!.tool.name)
			throw new TypeError(
				`duplicate MCP tool identity ${tools[index]!.tool.name} at ${[
					originLabel(tools[index - 1]!.origin),
					originLabel(tools[index]!.origin),
				]
					.sort()
					.join(", ")}`,
			);
	const artifact = Object.freeze({
		format: "questpie.mcp-projection" as const,
		version: 1 as const,
		protocolVersion: "2026-07-28" as const,
		operationContractDigest: input.operationContractDigest,
		operationDocumentationDigest: input.operationDocumentationDigest,
		tools: Object.freeze(
			tools.map(({ origin: _origin, ...tool }) => Object.freeze(tool)),
		),
	});
	const bytes = `${canonicalJson(artifact)}\n`;
	return Object.freeze({
		artifact,
		bytes,
		digest: createHash("sha256").update(bytes).digest("hex"),
	});
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
			.join(",")}}`;
	const encoded = JSON.stringify(value);
	if (encoded === undefined)
		throw new TypeError("noncanonical MCP artifact value");
	return encoded;
}

function toolName(operation: Pick<NetworkOperation, "kind" | "name">) {
	const name = `${operation.kind}.${operation.name}`;
	if (!toolNamePattern.test(name))
		throw new TypeError(`unsupported MCP tool identity: ${name}`);
	return name;
}

function originLabel(origin: OperationOrigin): string {
	return `${origin.packageId ?? "application"}:${origin.logicalPath}#${origin.exportName}`;
}
