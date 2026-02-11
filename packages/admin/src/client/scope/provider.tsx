/**
 * Scope Provider
 *
 * Provides scope context for multi-tenant applications.
 * Manages the selected scope ID and persists it to localStorage.
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import type { ScopeContextValue, ScopeProviderProps } from "./types";

/**
 * Fetch function type (browser-compatible, avoids Bun-specific types)
 */
type FetchFn = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

const ScopeContext = createContext<ScopeContextValue | null>(null);

/**
 * Provider component for scope selection.
 *
 * Wrap your admin app with this provider to enable scope-based filtering.
 *
 * @example
 * ```tsx
 * <ScopeProvider
 *   headerName="x-selected-property"
 *   storageKey="admin-property"
 * >
 *   <AdminProvider {...props}>
 *     {children}
 *   </AdminProvider>
 * </ScopeProvider>
 * ```
 */
export function ScopeProvider({
	children,
	headerName,
	storageKey,
	defaultScope = null,
}: ScopeProviderProps) {
	const [isLoading, setIsLoading] = useState(!!storageKey);
	const [scopeId, setScopeId] = useState<string | null>(() => {
		// Don't access localStorage during SSR
		if (typeof window === "undefined") {
			return defaultScope;
		}
		// Initial load from localStorage
		if (storageKey) {
			const stored = localStorage.getItem(storageKey);
			return stored ?? defaultScope;
		}
		return defaultScope;
	});

	// Handle hydration mismatch - only run once on mount
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only runs on mount
	useEffect(() => {
		if (storageKey && typeof window !== "undefined") {
			const stored = localStorage.getItem(storageKey);
			setScopeId(stored ?? defaultScope);
			setIsLoading(false);
		}
	}, [storageKey]);

	const setScope = useCallback(
		(id: string | null) => {
			setScopeId(id);
			if (storageKey && typeof window !== "undefined") {
				if (id) {
					localStorage.setItem(storageKey, id);
				} else {
					localStorage.removeItem(storageKey);
				}
			}
		},
		[storageKey],
	);

	const clearScope = useCallback(() => {
		setScope(null);
	}, [setScope]);

	const value: ScopeContextValue = {
		scopeId,
		setScope,
		clearScope,
		headerName,
		isLoading,
	};

	return (
		<ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
	);
}

/**
 * Hook to access the current scope context.
 *
 * @throws Error if used outside of ScopeProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { scopeId, setScope, clearScope } = useScope();
 *
 *   return (
 *     <div>
 *       Current scope: {scopeId ?? 'None'}
 *       <button onClick={() => setScope('org_123')}>
 *         Switch to Org 123
 *       </button>
 *       <button onClick={clearScope}>Clear</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useScope(): ScopeContextValue {
	const context = useContext(ScopeContext);
	if (!context) {
		throw new Error("useScope must be used within a ScopeProvider");
	}
	return context;
}

/**
 * Hook to check if we're inside a ScopeProvider.
 * Returns null if not inside a provider (doesn't throw).
 */
export function useScopeSafe(): ScopeContextValue | null {
	return useContext(ScopeContext);
}

/**
 * Hook to create a fetch wrapper that automatically injects the scope header.
 *
 * Use this when creating the QuestpieClient to ensure all API calls
 * include the selected scope.
 *
 * @example
 * ```tsx
 * function AdminWithScopedClient() {
 *   const scopedFetch = useScopedFetch();
 *
 *   const client = useMemo(() =>
 *     createClient<typeof cms>({
 *       baseURL: '/api',
 *       fetch: scopedFetch,
 *     }),
 *     [scopedFetch]
 *   );
 *
 *   return <AdminProvider client={client} {...rest} />;
 * }
 * ```
 */
export function useScopedFetch(): FetchFn {
	const { scopeId, headerName } = useScope();

	return useCallback(
		(input: RequestInfo | URL, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			if (scopeId) {
				headers.set(headerName, scopeId);
			}
			return fetch(input, { ...init, headers });
		},
		[scopeId, headerName],
	);
}

/**
 * Creates a fetch function that injects scope headers.
 * Use this outside of React components.
 *
 * @example
 * ```ts
 * let currentScopeId: string | null = null;
 *
 * const scopedFetch = createScopedFetch(
 *   'x-selected-property',
 *   () => currentScopeId
 * );
 *
 * const client = createClient({ fetch: scopedFetch, ... });
 * ```
 */
export function createScopedFetch(
	headerName: string,
	getScopeId: () => string | null,
): FetchFn {
	return (input: RequestInfo | URL, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		const scopeId = getScopeId();
		if (scopeId) {
			headers.set(headerName, scopeId);
		}
		return fetch(input, { ...init, headers });
	};
}
