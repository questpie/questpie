/**
 * Match Hash — O(1) Event Matching Optimization
 *
 * Generates a deterministic hash from event match criteria that can be
 * stored in a database column and indexed. This enables O(1) event
 * matching instead of iterating all waiting steps.
 *
 * The hash is a sorted, stringified representation of the match criteria
 * key-value pairs, hashed to a fixed-length string.
 *
 * When matchCriteria is null/undefined (match any), the hash is set to
 * a special wildcard value "*" — these are always checked during event
 * dispatch.
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Wildcard hash — used when a waiter or event has no match criteria
 * (i.e., matches anything). Steps with wildcard hashes must always
 * be checked during dispatch.
 */
export const WILDCARD_HASH = "*";

// ============================================================================
// Implementation
// ============================================================================

/**
 * Compute a deterministic match hash from criteria.
 *
 * Algorithm:
 * 1. If criteria is null/empty → return wildcard hash
 * 2. Sort keys alphabetically (deep for nested objects)
 * 3. JSON.stringify with sorted keys
 * 4. Compute a simple FNV-1a 32-bit hash
 * 5. Return as hex string prefixed with "mh:"
 *
 * @param criteria - The match criteria object (e.g., `{ orderId: "abc" }`)
 * @returns A deterministic hash string
 */
export function computeMatchHash(
	criteria: Record<string, unknown> | null | undefined,
): string {
	if (!criteria || Object.keys(criteria).length === 0) {
		return WILDCARD_HASH;
	}

	const normalized = stableStringify(criteria);
	const hash = fnv1a32(normalized);
	return `mh:${hash.toString(16)}`;
}

/**
 * Determine which hashes to query when dispatching an event.
 *
 * An event with match data `{ orderId: "abc" }` should match:
 * 1. Waiters with exact same hash (O(1) lookup)
 * 2. Waiters with wildcard hash (match any event)
 *
 * @param matchData - The event's match data
 * @returns Array of hashes to query
 */
export function getMatchHashesForDispatch(
	matchData: Record<string, unknown> | null | undefined,
): string[] {
	const hashes = [WILDCARD_HASH];

	if (matchData && Object.keys(matchData).length > 0) {
		hashes.push(computeMatchHash(matchData));
	}

	return hashes;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Stable JSON stringify with sorted keys (deep).
 * Ensures the same object always produces the same string.
 */
function stableStringify(obj: unknown): string {
	if (obj === null || obj === undefined) return "null";
	if (typeof obj !== "object") return JSON.stringify(obj);
	if (Array.isArray(obj)) {
		return `[${obj.map(stableStringify).join(",")}]`;
	}

	const keys = Object.keys(obj as Record<string, unknown>).sort();
	const parts = keys.map(
		(k) =>
			`${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`,
	);
	return `{${parts.join(",")}}`;
}

/**
 * FNV-1a 32-bit hash.
 *
 * Simple, fast, non-cryptographic hash with good distribution.
 * Used here because we only need collision resistance for indexing,
 * not security.
 */
function fnv1a32(input: string): number {
	let hash = 0x811c9dc5; // FNV offset basis

	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193); // FNV prime
	}

	return hash >>> 0; // Convert to unsigned 32-bit
}
