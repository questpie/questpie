import type { PreviewPatchOp } from "./types.js";

export type { PreviewPatchOp } from "./types.js";

export function cloneSnapshot<T>(value: T): T {
	if (typeof globalThis.structuredClone === "function") {
		return globalThis.structuredClone(value);
	}

	if (value === undefined) {
		return value;
	}

	return JSON.parse(JSON.stringify(value)) as T;
}

export function shouldApplyPatchBatch(
	lastAppliedSeq: number | null | undefined,
	nextSeq: number,
): boolean {
	return lastAppliedSeq == null || nextSeq > lastAppliedSeq;
}

export function applyPatchBatchImmutable<TData>(
	data: TData,
	ops: PreviewPatchOp[],
): TData {
	return ops.reduce<TData>((current, op) => {
		if (op.op === "set") {
			return setAtPath(current, op.path, op.value) as TData;
		}

		if (op.op === "remove") {
			return removeAtPath(current, op.path) as TData;
		}

		throw new Error(
			`Unsupported preview patch operation: ${(op as { op?: unknown }).op}`,
		);
	}, data);
}

function splitPath(path: string): string[] {
	if (path === "") {
		return [];
	}

	return path.split(".");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isArrayIndex(segment: string): boolean {
	return /^(0|[1-9]\d*)$/.test(segment);
}

function createContainer(
	nextSegment: string | undefined,
): unknown[] | Record<string, unknown> {
	return nextSegment !== undefined && isArrayIndex(nextSegment) ? [] : {};
}

function cloneContainer(
	value: unknown,
	nextSegment: string | undefined,
): unknown[] | Record<string, unknown> {
	if (Array.isArray(value)) {
		return [...value];
	}

	if (isObjectRecord(value)) {
		return { ...value };
	}

	return createContainer(nextSegment);
}

function readChild(container: unknown, segment: string): unknown {
	if (Array.isArray(container) && isArrayIndex(segment)) {
		return container[Number(segment)];
	}

	if (isObjectRecord(container)) {
		return container[segment];
	}

	return undefined;
}

function writeChild(
	container: unknown[] | Record<string, unknown>,
	segment: string,
	value: unknown,
) {
	if (Array.isArray(container) && isArrayIndex(segment)) {
		container[Number(segment)] = value;
		return;
	}

	(container as Record<string, unknown>)[segment] = value;
}

function hasChild(container: unknown, segment: string): boolean {
	if (Array.isArray(container) && isArrayIndex(segment)) {
		const index = Number(segment);
		return index >= 0 && index < container.length;
	}

	if (isObjectRecord(container)) {
		return Object.prototype.hasOwnProperty.call(container, segment);
	}

	return false;
}

function deleteChild(
	container: unknown[] | Record<string, unknown>,
	segment: string,
) {
	if (Array.isArray(container) && isArrayIndex(segment)) {
		container.splice(Number(segment), 1);
		return;
	}

	delete (container as Record<string, unknown>)[segment];
}

function setAtPath(data: unknown, path: string, value: unknown): unknown {
	const segments = splitPath(path);

	if (segments.length === 0) {
		return cloneSnapshot(value);
	}

	const root = cloneContainer(data, segments[0]);
	let cursor: unknown[] | Record<string, unknown> = root;

	for (let index = 0; index < segments.length - 1; index += 1) {
		const segment = segments[index]!;
		const nextSegment = segments[index + 1];
		const existingChild = readChild(cursor, segment);
		const nextChild = cloneContainer(existingChild, nextSegment);

		writeChild(cursor, segment, nextChild);
		cursor = nextChild;
	}

	writeChild(cursor, segments[segments.length - 1]!, cloneSnapshot(value));

	return root;
}

function removeAtPath(data: unknown, path: string): unknown {
	const segments = splitPath(path);

	if (segments.length === 0) {
		return undefined;
	}

	if (!Array.isArray(data) && !isObjectRecord(data)) {
		return data;
	}

	const root = cloneContainer(data, segments[0]);
	let sourceCursor: unknown = data;
	let cursor: unknown[] | Record<string, unknown> = root;

	for (let index = 0; index < segments.length - 1; index += 1) {
		const segment = segments[index]!;

		if (!hasChild(sourceCursor, segment)) {
			return data;
		}

		const sourceChild = readChild(sourceCursor, segment);
		if (!Array.isArray(sourceChild) && !isObjectRecord(sourceChild)) {
			return data;
		}

		const nextChild = cloneContainer(sourceChild, segments[index + 1]);
		writeChild(cursor, segment, nextChild);
		sourceCursor = sourceChild;
		cursor = nextChild;
	}

	const finalSegment = segments[segments.length - 1]!;
	if (!hasChild(sourceCursor, finalSegment)) {
		return data;
	}

	deleteChild(cursor, finalSegment);

	return root;
}
