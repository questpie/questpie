export type MutationRow = Readonly<Record<string, unknown>>;
export type MutationFieldPath = readonly string[];

export function mutationPathKey(path: MutationFieldPath): string {
	return JSON.stringify(path);
}

export function hasMutationValueAt(
	value: MutationRow,
	path: MutationFieldPath,
): boolean {
	let current: unknown = value;
	for (const [index, part] of path.entries()) {
		if (!current || typeof current !== "object" || Array.isArray(current))
			return false;
		if (!Object.hasOwn(current, part)) return false;
		current = (current as MutationRow)[part];
		if (index < path.length - 1 && current === undefined) return false;
	}
	return true;
}

export function mutationValueAt(
	value: MutationRow,
	path: MutationFieldPath,
	label: string,
): unknown {
	let current: unknown = value;
	for (const part of path) {
		if (!current || typeof current !== "object" || Array.isArray(current))
			throw new TypeError(`${label} must be an object`);
		current = (current as MutationRow)[part];
	}
	return current;
}

export function setMutationValueAt(
	target: Record<string, unknown>,
	path: MutationFieldPath,
	value: unknown,
): void {
	let current = target;
	for (const part of path.slice(0, -1)) {
		const child = current[part];
		if (!child || typeof child !== "object" || Array.isArray(child))
			current[part] = {};
		current = current[part] as Record<string, unknown>;
	}
	current[path.at(-1)!] = value;
}

export function mutationLeafPaths(
	value: unknown,
	label: string,
	physicalPaths: readonly MutationFieldPath[],
	prefix: string[] = [],
): MutationFieldPath[] {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	const source = value as MutationRow;
	const prototype = Object.getPrototypeOf(source);
	if (prototype !== null && prototype !== Object.prototype)
		throw new TypeError(`${label} must have exactly the compiled Fields`);
	if (
		prefix.length > 0 &&
		physicalPaths.some(
			(fieldPath) => mutationPathKey(fieldPath) === mutationPathKey(prefix),
		)
	)
		return [prefix];
	const paths: MutationFieldPath[] = [];
	const keys = Object.keys(source).toSorted();
	if (keys.length === 0 && prefix.length > 0) return [prefix];
	for (const key of keys) {
		const next = [...prefix, key];
		const child = source[key];
		if (
			child &&
			typeof child === "object" &&
			!Array.isArray(child) &&
			!(child instanceof Date)
		)
			paths.push(...mutationLeafPaths(child, label, physicalPaths, next));
		else paths.push(next);
	}
	return paths;
}
