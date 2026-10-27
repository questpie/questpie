/**
 * "Seen recently" set for error objects: two rotating WeakSets, so an entry
 * expires after one to two windows and never keeps the error alive. A single
 * process-lifetime WeakSet would silently drop a long-lived error object that
 * is thrown again much later.
 */
export function createRecentSet(windowMs: number) {
	let recent = new WeakSet<object>();
	let previous = new WeakSet<object>();
	let rotatedAt = Date.now();
	return {
		/** True if `value` was already seen within the window; records it otherwise. */
		check(value: unknown): boolean {
			if (
				value === null ||
				(typeof value !== "object" && typeof value !== "function")
			) {
				return false;
			}
			const now = Date.now();
			const elapsed = now - rotatedAt;
			if (elapsed >= windowMs) {
				previous = elapsed >= windowMs * 2 ? new WeakSet() : recent;
				recent = new WeakSet();
				rotatedAt = now;
			}
			if (recent.has(value) || previous.has(value)) return true;
			recent.add(value);
			return false;
		},
	};
}
