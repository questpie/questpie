/**
 * Preview patch utilities
 *
 * Pure helpers for applying {@link PreviewPatchOp}s to a JSON-like
 * snapshot. Used by the preview iframe to drive its local draft and
 * by the admin to predict patches before they're sent.
 *
 * Path syntax mirrors react-hook-form / lodash dot notation:
 *
 * ```
 *   title
 *   meta.seo.title
 *   content._values.abc.title
 *   items.2.label
 * ```
 *
 * Numeric segments index arrays. Missing intermediate segments are
 * created on `set` (objects, or arrays when the next segment is
 * numeric) so callers don't have to seed empty containers.
 */

import type { PreviewPatchOp } from "./types.js";

// ============================================================================
// Path parsing
// ============================================================================

const NUMERIC = /^\d+$/;

export type PathSegment = string | number;

/**
 * Split a dot-notation path into raw segments. Numeric-looking
 * segments are coerced to `number` so the applier knows whether
 * to walk an object key or an array index.
 *
 * Empty paths return an empty array.
 */
export function parsePath(path: string): PathSegment[] {
	if (!path) return [];
	return path.split(".").map((segment) =>
		NUMERIC.test(segment) ? Number(segment) : segment,
	);
}

// ============================================================================
// Applier
// ============================================================================

type AnyContainer = Record<string, unknown> | unknown[];

function isContainer(value: unknown): value is AnyContainer {
	return typeof value === "object" && value !== null;
}

function readChild(container: AnyContainer, key: PathSegment): unknown {
	if (Array.isArray(container)) {
		return typeof key === "number" ? container[key] : undefined;
	}
	return (container as Record<string, unknown>)[String(key)];
}

function writeChild(
	container: AnyContainer,
	key: PathSegment,
	value: unknown,
): void {
	if (Array.isArray(container)) {
		if (typeof key !== "number") return;
		container[key] = value;
		return;
	}
	(container as Record<string, unknown>)[String(key)] = value;
}

function deleteChild(container: AnyContainer, key: PathSegment): void {
	if (Array.isArray(container)) {
		if (typeof key !== "number") return;
		// Mirror lodash _.unset semantics: delete preserves length.
		delete container[key];
		return;
	}
	delete (container as Record<string, unknown>)[String(key)];
}

/**
 * Apply a single `set` op. Mutates the snapshot in place; returns
 * the same snapshot for chaining.
 */
export function applySet<T extends Record<string, unknown>>(
	snapshot: T,
	path: string,
	value: unknown,
): T {
	const segments = parsePath(path);
	if (segments.length === 0) return snapshot;

	let cursor: AnyContainer = snapshot;
	for (let i = 0; i < segments.length - 1; i += 1) {
		const segment = segments[i]!;
		const next = segments[i + 1]!;
		const existing = readChild(cursor, segment);
		if (!isContainer(existing)) {
			const fresh: AnyContainer =
				typeof next === "number" ? [] : ({} as Record<string, unknown>);
			writeChild(cursor, segment, fresh);
			cursor = fresh;
		} else {
			cursor = existing;
		}
	}

	writeChild(cursor, segments[segments.length - 1]!, value);
	return snapshot;
}

/**
 * Apply a single `remove` op. Mutates the snapshot in place; a
 * missing key is a no-op.
 */
export function applyRemove<T extends Record<string, unknown>>(
	snapshot: T,
	path: string,
): T {
	const segments = parsePath(path);
	if (segments.length === 0) return snapshot;

	let cursor: AnyContainer = snapshot;
	for (let i = 0; i < segments.length - 1; i += 1) {
		const child = readChild(cursor, segments[i]!);
		if (!isContainer(child)) return snapshot;
		cursor = child;
	}

	deleteChild(cursor, segments[segments.length - 1]!);
	return snapshot;
}

/**
 * Apply an ordered batch of {@link PreviewPatchOp}s in place. Stops
 * as soon as an op with an unsupported `op` is encountered so the
 * snapshot doesn't drift.
 */
export function applyPatchBatch<T extends Record<string, unknown>>(
	snapshot: T,
	ops: readonly PreviewPatchOp[],
): T {
	for (const op of ops) {
		if (op.op === "set") {
			applySet(snapshot, op.path, op.value);
		} else if (op.op === "remove") {
			applyRemove(snapshot, op.path);
		} else {
			break;
		}
	}
	return snapshot;
}

/**
 * Convenience: apply ops to a deep clone of the snapshot so the
 * caller can keep the original immutable. Uses `structuredClone`
 * which is available in modern browsers and the bun runtime used
 * for tests.
 */
export function applyPatchBatchImmutable<T extends Record<string, unknown>>(
	snapshot: T,
	ops: readonly PreviewPatchOp[],
): T {
	const clone = structuredClone(snapshot);
	return applyPatchBatch(clone, ops);
}
