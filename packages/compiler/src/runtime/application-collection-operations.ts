import { compareAscii } from "../canonical";
import type { NormalizedResource } from "../types";

export type GeneratedCollectionOperationBindings = Readonly<{
	definitionName(identity: string): string | null;
	definitions: string;
	linkHandlers: string;
}>;

/**
 * Renders statically named executable bindings around linked Operation Set
 * adapters. Each binding owns one adapter and one kernel identity; runtime
 * never chooses a CRUD member from caller data.
 */
export function renderGeneratedCollectionOperationBindings(
	resources: readonly NormalizedResource[],
): GeneratedCollectionOperationBindings {
	const operations = resources
		.filter(
			(resource) =>
				resource.value.kind === "frameworkGeneratedCollectionOperation",
		)
		.toSorted((left, right) => compareAscii(left.identity, right.identity));
	const indexes = new Map(
		operations.map((resource, index) => [resource.identity, index]),
	);
	return Object.freeze({
		definitionName(identity) {
			const index = indexes.get(identity);
			return index === undefined
				? null
				: `generatedOperationDefinition${index}`;
		},
		definitions: operations
			.map(
				(resource, index) =>
					`let generatedOperationHandler${index};
const generatedOperationDefinition${index} = Object.freeze({ name: ${JSON.stringify(resource.name)}, handler: (request) => {
	if (!generatedOperationHandler${index}) throw new TypeError("generated Collection Operation is not linked");
	return generatedOperationHandler${index}(request);
} });`,
			)
			.join("\n"),
		linkHandlers: operations
			.map((resource, index) => {
				const target = String(resource.value.target);
				const collection = target.slice("collection:".length);
				const member = String(resource.value.member);
				const kernelIdentity = String(resource.value.kernelIdentity);
				return `{
				const adapter = mutationArtifacts.collectionAdapters.byIdentity.get(${JSON.stringify(resource.identity)});
				if (!adapter || adapter.target !== ${JSON.stringify(target)} || adapter.member !== ${JSON.stringify(member)} || adapter.kernelIdentity !== ${JSON.stringify(kernelIdentity)})
					throw new TypeError("generated Collection Operation adapter does not match");
				generatedOperationHandler${index} = ({ input: operationInput, ctx }) => executeCollectionOperationAdapter({
					adapter,
					facts: Object.freeze({ operationTime: ctx.now, principal: ctx.principal, tenant: ctx.tenant }),
					invokeKernel: (identity, kernelInput) => {
						if (identity !== ${JSON.stringify(kernelIdentity)}) throw new TypeError("generated Collection Operation kernel does not match");
						return ctx.data[${JSON.stringify(collection)}][${JSON.stringify(member)}](kernelInput);
					},
				}, operationInput);
			}`;
			})
			.join("\n"),
	});
}
