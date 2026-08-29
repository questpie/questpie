import {
	mutationPathKey as pathKey,
	type MutationFieldPath,
} from "./field-path";

export function assertAllowedCollectionPaths(
	actual: readonly MutationFieldPath[],
	allowed: readonly MutationFieldPath[],
	label: string,
) {
	const allowedKeys = new Set(allowed.map(pathKey));
	const actualKeys = actual.map(pathKey);
	if (
		new Set(actualKeys).size !== actualKeys.length ||
		actualKeys.some((key) => !allowedKeys.has(key))
	)
		throw new TypeError(`${label} contains undeclared Fields`);
}

export function assertDisjointCollectionPaths(
	callerPaths: readonly MutationFieldPath[],
	trustedPaths: readonly MutationFieldPath[],
	label: string,
) {
	const caller = new Set(callerPaths.map(pathKey));
	if (trustedPaths.some((path) => caller.has(pathKey(path))))
		throw new TypeError(`${label} must not overlap`);
}

export function assertRequiredCollectionPaths(
	supplied: readonly MutationFieldPath[],
	required: readonly MutationFieldPath[],
	label: string,
) {
	const present = new Set(supplied.map(pathKey));
	if (required.some((path) => !present.has(pathKey(path))))
		throw new TypeError(`${label} is missing required Fields`);
}
