/**
 * Auth client utilities for admin package
 *
 * Better Auth handles all auth state management internally.
 * This module provides type-safe client creation helpers with
 * full type inference from your app auth configuration.
 *
 * @example
 * ```tsx
 * // In your app, create the auth client once:
 * import { createAdminAuthClient } from '@questpie/admin/hooks'
 * import type { app } from "./server/app"
 *
 * export const authClient = createAdminAuthClient<typeof app>({
 *   baseURL: 'http://localhost:3000'
 * })
 *
 * // Then use the built-in hooks:
 * function MyComponent() {
 *   const { data: session, isPending, error } = authClient.useSession()
 *
 *   if (isPending) return <div>Loading...</div>
 *   if (!session) return <LoginForm />
 *
 *   return <div>Welcome {session.user.name}</div>
 * }
 * ```
 */

import type { BetterAuthOptions } from "better-auth";
import { createAuthClient } from "better-auth/react";
import type { Questpie } from "questpie";

/**
 * Extract auth options type from Questpie instance
 */
type ExtractAuthOptions<T extends Questpie<any>> =
	T extends Questpie<infer TConfig>
		? TConfig["auth"] extends BetterAuthOptions
			? TConfig["auth"]
			: BetterAuthOptions
		: BetterAuthOptions;

/**
 * Options for creating admin auth client
 */
type AdminAuthClientOptions = {
	/**
	 * Base URL of the app API
	 * @example 'http://localhost:3000'
	 */
	baseURL: string;

	/**
	 * Base path for auth routes
	 * @default '/auth'
	 */
	basePath?: string;

	/**
	 * Custom fetch implementation
	 */
	fetchOptions?: {
		credentials?: RequestCredentials;
		headers?: Record<string, string>;
	};
};

/**
 * Internal client options type that includes $InferAuth
 */
type InternalClientOptions<T extends Questpie<any>> = {
	baseURL: string;
	fetchOptions?: {
		credentials?: RequestCredentials;
		headers?: Record<string, string>;
	};
	$InferAuth: ExtractAuthOptions<T>;
};

/**
 * Create a type-safe Better Auth client for the admin UI
 *
 * The returned client includes full type inference from your app auth configuration:
 * - `useSession()` - React hook for session state (typed based on your user/session schema)
 * - `signIn` methods (email, social providers configured in QuestPie)
 * - `signOut` - Sign out the current user
 * - `signUp` - Register new users
 * - Plugin-specific hooks (e.g., `useListAccounts` for admin plugin)
 *
 * @example
 * ```tsx
 * import { createAdminAuthClient } from '@questpie/admin/hooks'
 * import type { app } from "./server/app"
 *
 * // Create client with type inference from your app
 * export const authClient = createAdminAuthClient<typeof app>({
 *   baseURL: 'http://localhost:3000'
 * })
 *
 * // Session data is fully typed based on your app auth config
 * function App() {
 *   const { data: session, isPending } = authClient.useSession()
 *
 *   if (isPending) return <Loading />
 *   if (!session) return <LoginPage authClient={authClient} />
 *
 *   // session.user has all fields from your user schema
 *   return <AdminDashboard user={session.user} />
 * }
 * ```
 */
export function createAdminAuthClient<T extends Questpie<any>>(
	options: AdminAuthClientOptions,
): ReturnType<typeof createAuthClient<InternalClientOptions<T>>> {
	const basePath = options.basePath ?? "/auth";

	return createAuthClient<InternalClientOptions<T>>({
		baseURL: `${options.baseURL}${basePath}`,
		fetchOptions: {
			credentials: options.fetchOptions?.credentials ?? "include",
			headers: options.fetchOptions?.headers,
		},
	} as InternalClientOptions<T>);
}

/**
 * Type helper to extract auth client type from app instance
 *
 * @example
 * ```tsx
 * import type { AdminAuthClient } from '@questpie/admin/hooks'
 * import type { app } from "./server/app"
 *
 * type MyAuthClient = AdminAuthClient<typeof app>
 * ```
 */
type AdminAuthClient<T extends Questpie<any>> = ReturnType<
	typeof createAdminAuthClient<T>
>;

/**
 * Type helper to extract session type from auth client
 *
 * @example
 * ```tsx
 * import type { AdminSession } from '@questpie/admin/hooks'
 * import type { app } from "./server/app"
 *
 * type MySession = AdminSession<typeof app>
 * // Includes: { user: { id, email, name, role, ... }, session: { ... } }
 * ```
 */
type AdminSession<T extends Questpie<any>> =
	AdminAuthClient<T>["$Infer"]["Session"];

/**
 * Type helper to extract user type from app auth configuration
 *
 * @example
 * ```tsx
 * import type { AdminUser } from '@questpie/admin/hooks'
 * import type { app } from "./server/app"
 *
 * type MyUser = AdminUser<typeof app>
 * ```
 */
type AdminUser<T extends Questpie<any>> = AdminSession<T>["user"];

// ============================================================================
// Hooks
// ============================================================================

import { selectAuthClient, useAdminStore } from "../runtime/provider";

/**
 * Hook to access the auth client from AdminProvider context.
 *
 * @example
 * ```tsx
 * import { useAuthClient } from '@questpie/admin/hooks'
 *
 * function LoginPage() {
 *   const authClient = useAuthClient()
 *
 *   const handleLogin = async (email: string, password: string) => {
 *     await authClient.signIn.email({ email, password })
 *   }
 *
 *   return <LoginForm onSubmit={handleLogin} />
 * }
 * ```
 */
export function useAuthClient<T = any>(): T {
	const authClient = useAdminStore(selectAuthClient);
	if (!authClient) {
		throw new Error(
			"useAuthClient: authClient is not provided. " +
				"Make sure to pass authClient to AdminProvider.",
		);
	}
	return authClient as T;
}

/**
 * Hook to access the auth client from AdminProvider context.
 * Returns null if authClient is not provided (safe version).
 *
 * @example
 * ```tsx
 * const authClient = useAuthClientSafe()
 * if (!authClient) {
 *   return <div>Auth not configured</div>
 * }
 * ```
 */
export function useAuthClientSafe<T = any>(): T | null {
	return useAdminStore(selectAuthClient) as T | null;
}
