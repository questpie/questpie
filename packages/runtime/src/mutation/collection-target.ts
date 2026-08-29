export function collectionNameFromTarget(target: string): string {
	if (
		!target.startsWith("collection:") ||
		target.length === "collection:".length
	)
		throw new TypeError("Compiled Collection target is invalid");
	return target.slice("collection:".length);
}
