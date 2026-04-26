/**
 * Snapshot diff
 *
 * Pure helper that produces a minimal `PreviewPatchOp[]` describing
 * the change from a `before` snapshot to an `after` snapshot. Used
 * by the workspace patcher to drive `PATCH_BATCH` over the wire
 * without sending whole objects when only a leaf changed.
 *
 * Semantics
 * ---------
 *
 * - Plain-object values are diffed **recursively** so a change to
 *   `meta.seo.title` becomes a single `set meta.seo.title = "X"`
 *   rather than replacing the whole `meta` subtree.
 * - Arrays are treated as **atomic**. Recursive array diffing is a
 *   rabbit hole (especially for tree shapes like `BlockContent`),
 *   and `applyPatchBatch` already supports replacing the whole
 *   array with a single `set`. Block content moves through this
 *   path opaque-by-design.
 * - Primitives + mismatched types fall through to `set`.
 * - Keys present in `before` but not in `after` produce `remove`.
 * - Keys present in `after` but not in `before` produce `set`.
 * - `undefined` values are treated as "absent" — a key going from a
 *   value to `undefined` is a `remove`.
 *
 * Determinism: top-level keys are walked in the order they appear
 * in `before` first, then any new keys in `after` (insertion order
 * of the underlying records). Within a recursion the same rule
 * applies — useful for snapshotting the wire output in tests.
 */

import type { PreviewPatchOp } from "./types.js";

// ============================================================================
// Public API
// ============================================================================

/**
 * Diff two record snapshots into the minimal patch batch that
 * transforms `before` into `after`. Mutates nothing.
 *
 * `prefix` is an internal parameter used during recursion — pass
 * the empty string at top-level call sites.
 */
export function diffSnapshot(
	before: Record<string, unknown> | undefined,
	after: Record<string, unknown> | undefined,
	prefix = "",
): PreviewPatchOp[] {
	const ops: PreviewPatchOp[] = [];

	// `before` empty / nullable → every key in after is a fresh set.
	if (!before) {
		if (!after) return ops;
		for (const [key, value] of Object.entries(after)) {
			if (value === undefined) continue;
			ops.push({ op: "set", path: joinPath(prefix, key), value });
		}
		return ops;
	}

	// `after` empty / nullable → every key in before is a remove.
	if (!after) {
		for (const key of Object.keys(before)) {
			if (before[key] === undefined) continue;
			ops.push({ op: "remove", path: joinPath(prefix, key) });
		}
		return ops;
	}

	// Walk before-keys first to preserve insertion order in the
	// generated patch list — keeps tests easier to snapshot.
	const seen = new Set<string>();
	for (const key of Object.keys(before)) {
		seen.add(key);
		appendKeyDiff(ops, key, before[key], after[key], prefix);
	}
	for (const key of Object.keys(after)) {
		if (seen.has(key)) continue;
		appendKeyDiff(ops, key, undefined, after[key], prefix);
	}

	return ops;
}

// ============================================================================
// Internals
// ============================================================================

function appendKeyDiff(
	ops: PreviewPatchOp[],
	key: string,
	before: unknown,
	after: unknown,
	prefix: string,
): void {
	const path = joinPath(prefix, key);

	// Treat `undefined` as absent.
	const beforeAbsent = before === undefined;
	const afterAbsent = after === undefined;
	if (beforeAbsent && afterAbsent) return;
	if (beforeAbsent) {
		ops.push({ op: "set", path, value: after });
		return;
	}
	if (afterAbsent) {
		ops.push({ op: "remove", path });
		return;
	}

	if (Object.is(before, after)) return;

	// Recurse into plain objects only. Arrays + class instances are
	// opaque values — send a single `set` for the new value.
	if (isPlainObject(before) && isPlainObject(after)) {
		const nested = diffSnapshot(before, after, path);
		if (nested.length === 0 && !shallowDiffEmpty(before, after)) {
			// Object key set diverged but nested diff produced nothing:
			// shouldn't happen, but fall back to a full set so callers
			// don't silently drop the change.
			ops.push({ op: "set", path, value: after });
			return;
		}
		for (const op of nested) ops.push(op);
		return;
	}

	if (looksEqual(before, after)) return;

	ops.push({ op: "set", path, value: after });
}

function joinPath(prefix: string, key: string): string {
	return prefix ? `${prefix}.${key}` : key;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object") return false;
	if (Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === null || proto === Object.prototype;
}

function shallowDiffEmpty(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): boolean {
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	for (const key of ka) {
		if (!Object.is(a[key], b[key])) return false;
	}
	return true;
}

/**
 * Cheap structural equality for atomic values that aren't reference
 * equal. Keeps the diff free of spurious ops when arrays of
 * primitives are rebuilt with the same contents.
 */
function looksEqual(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i += 1) {
			if (!Object.is(a[i], b[i])) return false;
		}
		return true;
	}
	return false;
}
