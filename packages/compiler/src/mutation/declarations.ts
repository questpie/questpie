import { renderCodecType } from "../runtime";
import { renderServerOperationType } from "../server-operation-map";
import type { NormalizedResource } from "../types";

function mutations(resources: readonly NormalizedResource[]) {
	return resources.filter((resource) => resource.kind === "mutation");
}

export function renderMutationDeclarations(
	resources: readonly NormalizedResource[],
): string {
	const definitions = mutations(resources)
		.map((resource) => {
			const contract = resource.contract;
			return `${JSON.stringify(resource.name)}: Readonly<{ input: ${renderCodecType(contract.input)}; output: ${renderCodecType(contract.output)}; handlerOutput: ${renderCodecType(contract.output)}; }>;`;
		})
		.join("\n\t");
	const operations = renderServerOperationType(
		"Mutation",
		mutations(resources).map((resource) => ({
			name: resource.name,
			value: `(input: ${renderCodecType(resource.contract.input)}, options?: OperationCallOptions) => Promise<${renderCodecType(resource.contract.output)}>`,
		})),
	);
	return `export interface GeneratedMutations {
	${definitions}
}

export interface OperationCallOptions {
	readonly callId?: string;
	readonly signal?: AbortSignal;
	readonly deadline?: number;
}

export type GeneratedMutationOperations = ${operations};

export type MutationDefinition<Name extends keyof GeneratedMutations, Errors extends OperationErrorMap> = Readonly<{
	readonly kind: "mutation";
	readonly identity: \`mutation:\${Name & string}\`;
	readonly name: Name;
	readonly network: boolean;
	readonly input: Codec<GeneratedMutations[Name]["input"]>;
	readonly output: Codec<GeneratedMutations[Name]["output"]>;
	readonly errors: Errors;
	readonly handler: (input: Readonly<{
		input: GeneratedMutations[Name]["input"];
		ctx: MutationContext;
		errors: OperationErrorFactories<Errors>;
	}>) => GeneratedMutations[Name]["handlerOutput"] | Promise<GeneratedMutations[Name]["handlerOutput"]>;
}>;

export type MutationFactory = <const Name extends keyof GeneratedMutations, const Errors extends OperationErrorMap>(
	definition: Readonly<{
		name: Name;
		network?: boolean;
		input: Codec<GeneratedMutations[Name]["input"]>;
		output: Codec<GeneratedMutations[Name]["output"]>;
		policy: object;
		errors: Errors;
		handler(input: Readonly<{
			input: GeneratedMutations[Name]["input"];
			ctx: MutationContext;
			errors: OperationErrorFactories<Errors>;
		}>): GeneratedMutations[Name]["handlerOutput"] | Promise<GeneratedMutations[Name]["handlerOutput"]>;
	}>,
) => MutationDefinition<Name, Errors>;`;
}

export function renderMutationFactory(): string {
	return `export const defineMutation: MutationFactory = ((definition) => Object.freeze({
	...definition,
	kind: "mutation" as const,
	identity: \`mutation:\${definition.name}\` as const,
	network: definition.network === true,
})) as MutationFactory;`;
}
