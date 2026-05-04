import { cloneSnapshot, type PreviewPatchOp } from "./patch.js";

export function diffSnapshot(
	previous: unknown,
	next: unknown,
	basePath = "",
): PreviewPatchOp[] {
	if (isDeepEqual(previous, next)) {
		return [];
	}

	if (Array.isArray(previous) || Array.isArray(next)) {
		return [{ op: "set", path: basePath, value: cloneSnapshot(next) }];
	}

	if (isPlainObject(previous) && isPlainObject(next)) {
		const ops: PreviewPatchOp[] = [];
		const previousKeys = Object.keys(previous);
		const nextKeys = Object.keys(next);

		for (const key of previousKeys) {
			if (!Object.prototype.hasOwnProperty.call(next, key)) {
				ops.push({ op: "remove", path: joinPath(basePath, key) });
			}
		}

		for (const key of nextKeys) {
			const path = joinPath(basePath, key);

			if (!Object.prototype.hasOwnProperty.call(previous, key)) {
				ops.push({ op: "set", path, value: cloneSnapshot(next[key]) });
				continue;
			}

			ops.push(...diffSnapshot(previous[key], next[key], path));
		}

		return ops;
	}

	return [{ op: "set", path: basePath, value: cloneSnapshot(next) }];
}

export function diffSnapshotAtPath(
	previous: unknown,
	next: unknown,
	path: string,
): PreviewPatchOp[] {
	if (!path) {
		return diffSnapshot(previous, next);
	}

	const previousValue = readPath(previous, path);
	const nextValue = readPath(next, path);

	if (!nextValue.exists) {
		return previousValue.exists ? [{ op: "remove", path }] : [];
	}

	if (
		previousValue.exists &&
		isDeepEqual(previousValue.value, nextValue.value)
	) {
		return [];
	}

	return [{ op: "set", path, value: cloneSnapshot(nextValue.value) }];
}

function joinPath(basePath: string, key: string): string {
	return basePath ? `${basePath}.${key}` : key;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function isDeepEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}

	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right)) {
			return false;
		}

		if (left.length !== right.length) {
			return false;
		}

		return left.every((value, index) => isDeepEqual(value, right[index]));
	}

	if (isPlainObject(left) || isPlainObject(right)) {
		if (!isPlainObject(left) || !isPlainObject(right)) {
			return false;
		}

		const leftKeys = Object.keys(left);
		const rightKeys = Object.keys(right);

		if (leftKeys.length !== rightKeys.length) {
			return false;
		}

		return leftKeys.every(
			(key) =>
				Object.prototype.hasOwnProperty.call(right, key) &&
				isDeepEqual(left[key], right[key]),
		);
	}

	return false;
}

function isArrayIndex(segment: string): boolean {
	return /^(0|[1-9]\d*)$/.test(segment);
}

function readPath(
	value: unknown,
	path: string,
): { exists: true; value: unknown } | { exists: false; value: undefined } {
	let current = value;

	for (const segment of path.split(".")) {
		if (Array.isArray(current) && isArrayIndex(segment)) {
			const index = Number(segment);
			if (index < 0 || index >= current.length) {
				return { exists: false, value: undefined };
			}
			current = current[index];
			continue;
		}

		if (!isPlainObject(current)) {
			return { exists: false, value: undefined };
		}

		if (!Object.prototype.hasOwnProperty.call(current, segment)) {
			return { exists: false, value: undefined };
		}

		current = current[segment];
	}

	return { exists: true, value: current };
}
