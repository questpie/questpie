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
