/**
 * Hook to track realtime data changes and highlight affected rows
 *
 * Compares previous data with new data and returns IDs of changed/new items.
 * Used to show visual feedback (pulse animation) when data updates via SSE.
 */

import { useEffect, useRef, useState } from "react";

type DocWithId = {
	id: string;
	updatedAt?: string | Date;
	[key: string]: unknown;
};

type UseRealtimeHighlightOptions = {
	/** Duration in ms to keep highlight active (default: 1500) */
	highlightDuration?: number;
	/** Whether realtime is enabled */
	enabled?: boolean;
	/**
	 * Duration in ms after initialization to ignore changes (default: 500).
	 * This prevents false highlights on page refresh when SSE reconnects
	 * and triggers immediate refetches.
	 */
	initializationGracePeriod?: number;
};

type UseRealtimeHighlightResult<_T extends DocWithId> = {
	/** Set of row IDs that should be highlighted (updated/new) */
	highlightedIds: Set<string>;
	/** Check if a specific row should be highlighted as updated/new */
	isHighlighted: (id: string) => boolean;
};

/**
 * Track realtime changes and return IDs of changed/new rows
 *
 * @example
 * ```tsx
 * const { isHighlighted } = useRealtimeHighlight(data?.docs, { enabled: realtime });
 *
 * {items.map((row) => (
 *   <TableRow className={cn(
 *     isHighlighted(row.id) && "animate-realtime-pulse",
 *   )}>
 * ))}
 * ```
 */
export function useRealtimeHighlight<T extends DocWithId>(
	docs: T[] | undefined,
	options: UseRealtimeHighlightOptions = {},
): UseRealtimeHighlightResult<T> {
	const {
		highlightDuration = 1500,
		enabled = true,
		initializationGracePeriod = 500,
	} = options;

	const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());

	// Track previous docs by fingerprint
	const prevDocsRef = useRef<Map<string, string>>(new Map());
	// Track if we've seen any data yet (to skip initial highlight)
	const hasInitializedRef = useRef(false);
	// Track when initialization happened to implement grace period
	const initializedAtRef = useRef<number>(0);
	const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

	// Cleanup timers on unmount. The Set is captured here rather than read as
	// `timersRef.current` inside the cleanup: the ref holds one Set instance
	// for the component's lifetime (only ever `.add`/`.delete`, never
	// reassigned), so this is equivalent — and it is the form React's
	// ref-in-cleanup rule asks for.
	useEffect(() => {
		const timers = timersRef.current;
		return () => {
			for (const timer of timers) {
				clearTimeout(timer);
			}
		};
	}, []);

	useEffect(() => {
		if (!enabled || !docs) {
			return;
		}

		// Build current fingerprint map
		const currentMap = new Map<string, string>();
		for (const doc of docs) {
			currentMap.set(doc.id, getDocFingerprint(doc));
		}

		// Skip highlighting on first data load
		if (!hasInitializedRef.current) {
			hasInitializedRef.current = true;
			initializedAtRef.current = Date.now();
			prevDocsRef.current = currentMap;
			return;
		}

		// Skip highlighting during grace period after initialization
		// This prevents false highlights on page refresh when SSE reconnects
		// and triggers immediate refetches
		const timeSinceInit = Date.now() - initializedAtRef.current;
		if (timeSinceInit < initializationGracePeriod) {
			prevDocsRef.current = currentMap;
			return;
		}

		// Find new and updated docs
		const changedIds: string[] = [];
		for (const doc of docs) {
			const prevFingerprint = prevDocsRef.current.get(doc.id);
			const currentFingerprint = currentMap.get(doc.id)!;

			if (!prevFingerprint) {
				// New doc
				changedIds.push(doc.id);
			} else if (prevFingerprint !== currentFingerprint) {
				// Updated doc
				changedIds.push(doc.id);
			}
		}

		// Update prev docs map
		prevDocsRef.current = currentMap;

		// Handle updated/new rows
		if (changedIds.length > 0) {
			setHighlightedIds((prev) => {
				const next = new Set(prev);
				for (const id of changedIds) {
					next.add(id);
				}
				return next;
			});

			// Remove highlights after duration
			const timer = setTimeout(() => {
				setHighlightedIds((prev) => {
					const next = new Set(prev);
					for (const id of changedIds) {
						next.delete(id);
					}
					return next;
				});
				timersRef.current.delete(timer);
			}, highlightDuration);
			timersRef.current.add(timer);
		}
	}, [docs, enabled, highlightDuration, initializationGracePeriod]);

	return {
		highlightedIds,
		isHighlighted: (id: string) => highlightedIds.has(id),
	};
}

/**
 * Create a fingerprint for a doc to detect changes
 * Uses updatedAt if available, otherwise JSON stringify
 */
function getDocFingerprint(doc: DocWithId): string {
	if (doc.updatedAt) {
		return `${doc.id}:${String(doc.updatedAt)}`;
	}
	// Fallback to JSON - less efficient but works
	return JSON.stringify(doc);
}
