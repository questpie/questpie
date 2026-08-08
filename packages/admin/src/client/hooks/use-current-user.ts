/**
 * Current User Hooks
 *
 * Convenience hooks for accessing the current user from Better Auth session.
 * These hooks use the authClient.useSession() internally.
 *
 * @example
 * ```tsx
 * function UserProfile() {
 *   const user = useCurrentUser();
 *   const isAdmin = useIsAdmin();
 *
 *   if (!user) return <LoginPrompt />;
 *
 *   return (
 *     <div>
 *       <h1>{user.name}</h1>
 *       {isAdmin && <AdminBadge />}
 *     </div>
 *   );
 * }
 * ```
 */

import { useAuthClientSafe } from "./use-auth";

// ============================================================================
// Types
// ============================================================================

/**
 * Basic user type from Better Auth session
 * Extended by the actual user schema
 */
interface BasicUser {
	id: string;
	email: string;
	name?: string | null;
	image?: string | null;
	role?: string | null;
	emailVerified?: boolean;
	banned?: boolean;
	banReason?: string | null;
}

/**
 * Session state returned by useSession hooks
 */
interface SessionState<TUser = BasicUser> {
	user: TUser | null;
	isPending: boolean;
	error: Error | null;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get the current authenticated user from session.
 *
 * Returns null if:
 * - No auth client is configured
 * - User is not authenticated
 * - Session is still loading (use useSessionState for loading state)
 *
 * @example
 * ```tsx
 * const user = useCurrentUser();
 * if (!user) return <LoginPage />;
 * return <div>Hello {user.name}</div>;
 * ```
 */
export function useCurrentUser<TUser = BasicUser>(): TUser | null {
	const authClient = useAuthClientSafe();

	if (!authClient) {
		return null;
	}

	const { data: session } = authClient.useSession();
	return (session?.user as TUser) ?? null;
}

/**
 * Get full session state including loading and error.
 *
 * @example
 * ```tsx
 * const { user, isPending, error } = useSessionState();
 *
 * if (isPending) return <Loading />;
 * if (error) return <Error message={error.message} />;
 * if (!user) return <LoginPage />;
 *
 * return <Dashboard user={user} />;
 * ```
 */
export function useSessionState<TUser = BasicUser>(): SessionState<TUser> {
	const authClient = useAuthClientSafe();

	if (!authClient) {
		return {
			user: null,
			isPending: false,
			error: null,
		};
	}

	const { data: session, isPending, error } = authClient.useSession();

	return {
		user: (session?.user as TUser) ?? null,
		isPending,
		error: error ?? null,
	};
}
