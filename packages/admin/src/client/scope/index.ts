/**
 * Scope Primitives
 *
 * React primitives for scope selection in multi-tenant applications.
 *
 * @example
 * ```tsx
 * import {
 *   ScopeProvider,
 *   useScope,
 *   useScopedFetch,
 *   ScopePicker,
 * } from '@questpie/admin/scope';
 *
 * // Wrap admin with ScopeProvider
 * function App() {
 *   return (
 *     <ScopeProvider
 *       headerName="x-selected-property"
 *       storageKey="admin-property"
 *     >
 *       <AdminProvider client={client} {...rest}>
 *         <AdminLayout
 *           sidebarHeader={<ScopePicker collection="properties" />}
 *         >
 *           ...
 *         </AdminLayout>
 *       </AdminProvider>
 *     </ScopeProvider>
 *   );
 * }
 *
 * // Access scope in any component
 * function MyComponent() {
 *   const { scopeId, setScope } = useScope();
 *   return <div>Current scope: {scopeId}</div>;
 * }
 *
 * // Create a scoped fetch for the client
 * function AdminWithScopedClient() {
 *   const scopedFetch = useScopedFetch();
 *   const client = useMemo(() =>
 *     createClient({ fetch: scopedFetch, baseURL: '/api' }),
 *     [scopedFetch]
 *   );
 *   return <AdminProvider client={client} {...rest} />;
 * }
 * ```
 */

// Components
export { ScopePicker } from "./picker";

// Provider & Hooks
export {
	createScopedFetch,
	ScopeProvider,
	useScope,
	useScopedFetch,
	useScopeSafe,
} from "./provider";
// Types
export type {
	ScopeContextValue,
	ScopeOption,
	ScopePickerProps,
	ScopeProviderProps,
} from "./types";
