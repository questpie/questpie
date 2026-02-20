/**
 * React hooks for admin package
 *
 * Re-exports from runtime for backward compatibility.
 * New code should import directly from "@questpie/admin/runtime".
 */

// Provider and store - import from "@questpie/admin/runtime" directly
// Typed hooks factory (recommended for new projects)
// Action hooks
// Admin config hook
// Admin preferences hooks
// Route hooks
// Auth client (Better Auth integration)
// TanStack Query hooks for collections
// Collection fields hook (schema -> field definitions)
// Collection meta hook
// Collection schema hook (full introspection)
// Collection validation hooks
export { useCollectionValidation } from "./use-collection-validation";
// Current user hooks
// Field hooks (onChange, effects, loadOptions)
// Global hooks
export {
	useGlobal,
	useGlobalRevertVersion,
	useGlobalUpdate,
	useGlobalVersions,
} from "./use-global";
// Lock hooks (collaborative editing)
// Prefill params hook
// Saved views hooks
// Search hooks
export { useSearchParamToggle } from "./use-search-param-toggle";
// Server actions hook
// Server validation hooks (AJV-based, uses server JSON Schema)
export { usePreferServerValidation } from "./use-server-validation";
// Setup status hook
export { useSidebarSearchParam } from "./use-sidebar-search-param";
// Workflow transition hook
// Upload hook
// Validation error map hook
// View state hook