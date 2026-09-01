export type OperationKind = "query" | "mutation" | "action";

export type NetworkOperation = Readonly<{
	kind: OperationKind;
	name: string;
	network: boolean;
	inputSchema: Readonly<Record<string, unknown>>;
	contextSchema: Readonly<Record<string, unknown>>;
	outputSchema: Readonly<Record<string, unknown>>;
	description?: string;
}>;

export type McpTool = Readonly<{
	name: string;
	description?: string;
	inputSchema: Readonly<Record<string, unknown>>;
	outputSchema: Readonly<Record<string, unknown>>;
	annotations?: Readonly<{ readOnlyHint: true }>;
}>;

const toolNamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}[A-Za-z0-9]$/;

export function toolName(operation: Pick<NetworkOperation, "kind" | "name">) {
	const name = `${operation.kind}.${operation.name}`;
	if (!toolNamePattern.test(name))
		throw new TypeError(`unsupported MCP tool identity: ${name}`);
	return name;
}

export function projectMcpTools(
	operations: readonly NetworkOperation[],
): readonly McpTool[] {
	const tools = operations
		.filter((operation) => operation.network)
		.map((operation) => {
			const name = toolName(operation);
			return Object.freeze({
				name,
				...(operation.description === undefined
					? {}
					: { description: operation.description }),
				inputSchema: Object.freeze({
					$schema: "https://json-schema.org/draft/2020-12/schema",
					type: "object",
					additionalProperties: false,
					properties: Object.freeze({
						context: operation.contextSchema,
						input: operation.inputSchema,
					}),
					required: Object.freeze(["context", "input"]),
				}),
				outputSchema: operation.outputSchema,
				...(operation.kind === "query"
					? { annotations: Object.freeze({ readOnlyHint: true as const }) }
					: {}),
			});
		})
		.sort((left, right) =>
			left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
		);
	for (let index = 1; index < tools.length; index += 1)
		if (tools[index - 1]!.name === tools[index]!.name)
			throw new TypeError(`duplicate MCP tool identity: ${tools[index]!.name}`);
	return Object.freeze(tools);
}
