import { renderCodecType } from "../runtime";
import { renderServerOperationType } from "../server-operation-map";
import type { NormalizedResource } from "../types";

export function renderQueryDeclarations(
	resources: readonly NormalizedResource[],
	documentation: Readonly<Record<string, string>> = {},
): string {
	return resources
		.filter((resource) => resource.kind === "query")
		.map((resource) => {
			const contract = resource.contract;
			const jsdoc = documentation[resource.identity];
			return `${jsdoc ? `${jsdoc}\n\t` : ""}${JSON.stringify(resource.name)}: Readonly<{ input: ${renderCodecType(contract.input)}; output: ${renderCodecType(contract.output)}; handlerOutput: GeneratedQueries[${JSON.stringify(resource.name)}]["output"]; }>;`;
		})
		.join("\n\t");
}

export function renderQueryOperations(
	resources: readonly NormalizedResource[],
): string {
	return renderServerOperationType(
		"Query",
		resources
			.filter((resource) => resource.kind === "query")
			.map((resource) => ({
				name: resource.name,
				origin: resource.origin,
				value: `(input: GeneratedQueries[${JSON.stringify(resource.name)}]["input"]) => Promise<GeneratedQueries[${JSON.stringify(resource.name)}]["output"]>`,
			})),
	);
}
