/**
 * Hooks for document locking (collaborative editing awareness)
 *
 * Provides realtime tracking of who is editing which documents.
 * Used in table view to show lock indicators and in form view to manage locks.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useCurrentUser } from "./use-current-user";
import { useQuestpieQueryOptions } from "./use-questpie-query-options";

// ============================================================================
// Constants
// ============================================================================

/**
 * Default lock duration in milliseconds (60 seconds)
 * Lock expires if not refreshed within this time.
 * Form should call refresh() on user activity (typing, clicking).
 */
export const LOCK_DURATION_MS = 60_000;

// ============================================================================
// Types
// ============================================================================

export interface LockUser {
	id: string;
	name?: string | null;
	email: string;
	image?: string | null;
}

export interface LockInfo {
	id: string;
	resourceType: "collection" | "global";
	resource: string;
	resourceId: string;
	user: LockUser | string;
	sessionId: string;
	expiresAt: Date | string;
	createdAt?: Date | string;
	updatedAt?: Date | string;
}

/** Helper to get user info from lock (handles both expanded and non-expanded) */
export function getLockUser(lock: LockInfo): LockUser | null {
	if (typeof lock.user === "string") return null;
	return lock.user;
}

/** Helper to get user ID from lock */
export function getLockUserId(lock: LockInfo): string {
	if (typeof lock.user === "string") return lock.user;
	return lock.user.id;
}

/**
 * Generate a unique session ID for this browser tab.
 * Persisted in sessionStorage so it survives page refreshes but not tab close.
 */
function getSessionId(): string {
	if (typeof window === "undefined") return "server";

	const key = "__questpie_lock_session_id__";
	let sessionId = sessionStorage.getItem(key);

	if (!sessionId) {
		sessionId = crypto.randomUUID();
		sessionStorage.setItem(key, sessionId);
	}

	return sessionId;
}

export interface UseLockOptions {
	/** Resource type: collection or global */
	resourceType: "collection" | "global";
	/** Resource name (collection slug or global slug) */
	resource: string;
	/** Document ID to lock */
	resourceId: string;
	/** Whether to auto-acquire lock on mount (default: true) */
	autoAcquire?: boolean;
	/** Callback when lock is acquired */
	onAcquired?: (lock: LockInfo) => void;
	/** Callback when lock acquisition fails (someone else has it) */
	onBlocked?: (lock: LockInfo) => void;
	/** Callback when lock is released */
	onReleased?: () => void;
}

export interface UseLockResult {
	/** Current lock info if we have the lock */
	lock: LockInfo | null;
	/** Lock info if someone else has the lock */
	blockedBy: LockInfo | null;
	/** Whether we currently hold the lock */
	isLocked: boolean;
	/** Whether someone else holds the lock */
	isBlocked: boolean;
	/** Whether same user has it open in another tab */
	isOpenElsewhere: boolean;
	/** Whether lock operations are in progress */
	isPending: boolean;
	/** Acquire the lock manually */
	acquire: () => Promise<LockInfo | null>;
	/** Release the lock manually */
	release: () => Promise<void>;
	/** Refresh the lock (extend expiration) */
	refresh: () => Promise<void>;
}

export interface UseLocksOptions {
	/** Resource type: collection or global */
	resourceType: "collection" | "global";
	/** Resource name (collection slug or global slug) */
	resource: string;
	/** Whether realtime updates are enabled */
	realtime?: boolean;
}

export interface UseLocksResult {
	/** Map of resourceId -> lock info */
	locks: Map<string, LockInfo>;
	/** Check if a specific resource is locked */
	isLocked: (resourceId: string) => boolean;
	/** Get lock info for a specific resource */
	getLock: (resourceId: string) => LockInfo | undefined;
	/** Check if current user owns the lock */
	isOwnLock: (resourceId: string) => boolean;
	/** Whether data is loading */
	isLoading: boolean;
}

// ============================================================================
// useLocks - Track all locks for a resource (for table view)
// ============================================================================

/**
 * Track all active locks for a collection/global.
 *
 * Used in table views to show who is editing which rows.
 *
 * @example
 * ```tsx
 * const { locks, isLocked, getLock } = useLocks({
 *   resourceType: "collection",
 *   resource: "posts",
 *   realtime: true,
 * });
 *
 * // In table row
 * {isLocked(row.id) && (
 *   <LockIndicator user={getLock(row.id)?.userName} />
 * )}
 * ```
 */
export function useLocks(options: UseLocksOptions): UseLocksResult {
	const { resourceType, resource, realtime = true } = options;
	const { queryOpts } = useQuestpieQueryOptions();
	const currentUser = useCurrentUser();

	// Query active locks for this resource (with user data expanded)
	const { data: rawData, isLoading } = useQuery({
		...(queryOpts as any).collections.adminLocks.find(
			{
				where: {
					resourceType,
					resource,
					// Only get non-expired locks
					expiresAt: { gt: new Date() },
				},
				with: { user: true },
			},
			{ realtime },
		),
	});

	const data = rawData as { docs?: LockInfo[] } | undefined;

	// Build lock map
	const locks = new Map<string, LockInfo>();
	if (data?.docs) {
		for (const lock of data.docs) {
			locks.set(lock.resourceId, lock);
		}
	}

	const isLocked = useCallback(
		(resourceId: string) => locks.has(resourceId),
		[locks],
	);

	const getLock = useCallback(
		(resourceId: string) => locks.get(resourceId),
		[locks],
	);

	const isOwnLock = useCallback(
		(resourceId: string) => {
			const lock = locks.get(resourceId);
			if (!lock) return false;
			return getLockUserId(lock) === currentUser?.id;
		},
		[locks, currentUser?.id],
	);

	return {
		locks,
		isLocked,
		getLock,
		isOwnLock,
		isLoading,
	};
}

// ============================================================================
// useLock - Manage a single document lock (for form view)
// ============================================================================

/**
 * Manage a document lock for editing.
 *
 * Automatically acquires lock on mount, sends heartbeats, and releases on unmount.
 *
 * @example
 * ```tsx
 * function EditForm({ collection, id }) {
 *   const { isLocked, isBlocked, blockedBy } = useLock({
 *     resourceType: "collection",
 *     resource: collection,
 *     resourceId: id,
 *   });
 *
 *   if (isBlocked) {
 *     return <LockedBanner user={blockedBy?.userName} />;
 *   }
 *
 *   return <Form disabled={!isLocked} />;
 * }
 * ```
 */
export function useLock(options: UseLockOptions): UseLockResult {
	const {
		resourceType,
		resource,
		resourceId,
		autoAcquire = true,
		onAcquired,
		onBlocked,
		onReleased,
	} = options;

	const { queryOpts } = useQuestpieQueryOptions();
	const queryClient = useQueryClient();
	const currentUser = useCurrentUser();

	const lockIdRef = useRef<string | null>(null);

	// Query existing lock for this resource (with user data expanded)
	const { data: rawExistingLockData, isLoading: isCheckingLock } = useQuery({
		...(queryOpts as any).collections.adminLocks.find({
			where: {
				resourceType,
				resource,
				resourceId,
				expiresAt: { gt: new Date() },
			},
			with: { user: true },
			limit: 1,
		}),
		enabled: !!resourceId,
	});

	const existingLockData = rawExistingLockData as
		| { docs?: LockInfo[] }
		| undefined;
	const existingLock = existingLockData?.docs?.[0] ?? null;

	// Lock is "own" only if it's from this exact browser tab (same sessionId)
	const sessionId = getSessionId();
	const isOwnSession = existingLock?.sessionId === sessionId;
	const isOwnUser = existingLock
		? getLockUserId(existingLock) === currentUser?.id
		: false;

	// For UI: show as blocked only if different user has the lock
	// Same user in different tab can see they have it open elsewhere
	const blockedBy = existingLock && !isOwnUser ? existingLock : null;
	const ownLockElsewhere = existingLock && isOwnUser && !isOwnSession;

	// Create lock mutation
	const createMutation = useMutation({
		mutationFn: async () => {
			if (!currentUser) throw new Error("Not authenticated");

			const expiresAt = new Date(Date.now() + LOCK_DURATION_MS);

			const result = await (queryOpts as any).collections.adminLocks.create({
				resourceType,
				resource,
				resourceId,
				user: currentUser.id,
				sessionId,
				expiresAt,
			});

			return result as LockInfo;
		},
		onSuccess: (lock) => {
			lockIdRef.current = lock.id;
			onAcquired?.(lock);

			// Invalidate locks query
			queryClient.invalidateQueries({
				queryKey: ["collections", "adminLocks"],
			});
		},
	});

	// Update lock mutation (for heartbeat)
	const updateMutation = useMutation({
		mutationFn: async () => {
			if (!lockIdRef.current) return;

			const expiresAt = new Date(Date.now() + LOCK_DURATION_MS);

			await (queryOpts as any).collections.adminLocks.update({
				id: lockIdRef.current,
				data: { expiresAt },
			});
		},
	});

	// Delete lock mutation
	const deleteMutation = useMutation({
		mutationFn: async () => {
			if (!lockIdRef.current) return;

			await (queryOpts as any).collections.adminLocks.delete({
				id: lockIdRef.current,
			});
		},
		onSuccess: () => {
			lockIdRef.current = null;
			onReleased?.();

			// Invalidate locks query
			queryClient.invalidateQueries({
				queryKey: ["collections", "adminLocks"],
			});
		},
	});

	// Acquire lock
	const acquire = useCallback(async () => {
		// Check if already locked by someone else (different user)
		if (existingLock && !isOwnUser) {
			onBlocked?.(existingLock);
			return null;
		}

		// If we already have the lock in this session, just use it
		if (isOwnSession && existingLock) {
			lockIdRef.current = existingLock.id;
			return existingLock;
		}

		// Same user but different tab - they can open, but need own lock
		// Or no existing lock - acquire new one
		try {
			const lock = await createMutation.mutateAsync();
			return lock;
		} catch (error) {
			console.error("Failed to acquire lock:", error);
			return null;
		}
	}, [existingLock, isOwnUser, isOwnSession, createMutation, onBlocked]);

	// Release lock
	const release = useCallback(async () => {
		if (lockIdRef.current) {
			try {
				await deleteMutation.mutateAsync();
			} catch (error) {
				console.error("Failed to release lock:", error);
			}
		}
	}, [deleteMutation]);

	// Refresh lock (extend expiration)
	const refresh = useCallback(async () => {
		if (lockIdRef.current) {
			try {
				await updateMutation.mutateAsync();
			} catch (error) {
				console.error("Failed to refresh lock:", error);
			}
		}
	}, [updateMutation]);

	// Auto-acquire on mount
	useEffect(() => {
		if (!autoAcquire || !resourceId || !currentUser || isCheckingLock) {
			return;
		}

		// Wait for existing lock check to complete
		if (existingLock !== undefined) {
			if (blockedBy) {
				onBlocked?.(blockedBy);
			} else {
				acquire();
			}
		}
	}, [
		autoAcquire,
		resourceId,
		currentUser,
		isCheckingLock,
		existingLock,
		blockedBy,
		acquire,
		onBlocked,
	]);

	// No automatic heartbeat - form will call refresh() on user activity

	// Release on unmount
	useEffect(() => {
		const mutate = deleteMutation.mutate;
		return () => {
			if (lockIdRef.current) {
				// Fire and forget - component is unmounting
				mutate();
			}
		};
	}, [deleteMutation.mutate]);

	return {
		// Lock info if we own it in this session
		lock: isOwnSession ? existingLock : null,
		// Who is blocking us (different user)
		blockedBy,
		// True if we have the lock in this session
		isLocked: isOwnSession && !!existingLock,
		// True if different user has the lock
		isBlocked: !!blockedBy,
		// True if same user has it open in another tab
		isOpenElsewhere: !!ownLockElsewhere,
		isPending:
			isCheckingLock ||
			createMutation.isPending ||
			updateMutation.isPending ||
			deleteMutation.isPending,
		acquire,
		release,
		refresh,
	};
}
