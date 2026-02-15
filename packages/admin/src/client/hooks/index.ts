/**
 * React hooks for admin package
 *
 * Re-exports from runtime for backward compatibility.
 * New code should import directly from "@questpie/admin/runtime".
 */

export type {
	FilterOperator,
	FilterRule,
	SortConfig,
	ViewConfiguration,
} from "../components/filter-builder/types";
// Provider and store (re-exported from runtime for backward compatibility)
export {
	AdminProvider,
	type AdminProviderProps,
	type AdminState,
	type AdminStore,
	// Selectors
	selectAdmin,
	selectAuthClient,
	selectBasePath,
	selectBrandName,
	selectClient,
	selectContentLocale,
	selectNavigate,
	selectNavigation,
	selectRealtime,
	selectSetContentLocale,
	useAdminStore,
	// Utilities
	useShallow,
} from "../runtime";
// Typed hooks factory (recommended for new projects)
export { createTypedHooks, type TypedHooks } from "./typed-hooks";
// Action hooks
export {
	type UseActionExecutionOptions,
	type UseActionHelpersOptions,
	type UseActionHelpersReturn,
	type UseActionsOptions,
	type UseActionsReturn,
	useActionExecution,
	useActionHelpers,
	useActions,
} from "./use-action";
// Admin config hook
export { useAdminConfig } from "./use-admin-config";
// Admin preferences hooks
export {
	type AdminPreference,
	useAdminPreference,
	useDeleteAdminPreference,
	useSetAdminPreference,
} from "./use-admin-preferences";
// Route hooks
export {
	type AdminLinkProps,
	getAdminLinkHref,
	type UseAdminRoutesOptions,
	type UseAdminRoutesResult,
	useAdminRoutes,
	useAdminRoutesStandalone,
} from "./use-admin-routes";
// Auth client (Better Auth integration)
export type {
	AdminAuthClient,
	AdminAuthClientOptions,
	AdminSession,
	AdminUser,
} from "./use-auth";
export {
	createAdminAuthClient,
	useAuthClient,
	useAuthClientSafe,
} from "./use-auth";
// TanStack Query hooks for collections
export {
	useCollectionCount,
	useCollectionCreate,
	useCollectionDelete,
	useCollectionItem,
	useCollectionList,
	useCollectionUpdate,
} from "./use-collection";
// Collection fields hook (schema -> field definitions)
export { useCollectionFields } from "./use-collection-fields";
// Collection meta hook
export {
	getCollectionMetaQueryKey,
	useCollectionMeta,
} from "./use-collection-meta";
// Collection schema hook (full introspection)
export {
	getCollectionSchemaQueryKey,
	useCollectionSchema,
} from "./use-collection-schema";
// Collection validation hooks
export {
	type CollectionValidationResult,
	useCollectionValidation,
} from "./use-collection-validation";
// Current user hooks
export type { BasicUser, SessionState } from "./use-current-user";
export {
	useCurrentUser,
	useHasAnyRole,
	useHasRole,
	useIsAdmin,
	useIsAuthenticated,
	useSessionState,
} from "./use-current-user";
// Field hooks (onChange, effects, loadOptions)
export {
	type UseFieldHooksOptions,
	type UseFieldHooksResult,
	useFieldHooks,
} from "./use-field-hooks";
// Global hooks
export { useGlobal, useGlobalUpdate } from "./use-global";
export { useGlobalFields } from "./use-global-fields";
export {
	getGlobalMetaQueryKey,
	useGlobalMeta,
	useSuspenseGlobalMeta,
} from "./use-global-meta";
export { getGlobalSchemaQueryKey, useGlobalSchema } from "./use-global-schema";
// Lock hooks (collaborative editing)
export {
	getLockUser,
	getLockUserId,
	LOCK_DURATION_MS,
	type LockInfo,
	type LockUser,
	type UseLockOptions,
	type UseLockResult,
	type UseLocksOptions,
	type UseLocksResult,
	useLock,
	useLocks,
} from "./use-locks";
// Prefill params hook
export {
	buildPrefillUrl,
	parsePrefillParams,
	parsePrefillParamsFromUrl,
	usePrefillParams,
} from "./use-prefill-params";
// Saved views hooks
export {
	useDeleteSavedView,
	useSavedViews,
	useSaveView,
	useUpdateSavedView,
} from "./use-saved-views";
// Search hooks
export {
	type PopulatedSearchResult,
	type SearchFacetDefinition,
	type SearchFacetResult,
	type SearchFacetValue,
	type SearchMeta,
	type SearchResponse,
	type UseGlobalSearchOptions,
	type UseSearchOptions,
	useDebouncedValue,
	useGlobalSearch,
	useReindex,
	useSearch,
} from "./use-search";
// Server actions hook
export {
	mergeServerActions,
	type UseServerActionsOptions,
	type UseServerActionsReturn,
	useServerActions,
} from "./use-server-actions";
// Server validation hooks (AJV-based, uses server JSON Schema)
export {
	type ServerValidationResult,
	type UseServerValidationOptions,
	useGlobalServerValidation,
	usePreferServerValidation,
	useServerValidation,
	type ValidationMode,
} from "./use-server-validation";
// Setup status hook
export { type SetupStatus, useSetupStatus } from "./use-setup-status";
// Upload hook
export {
	type Asset,
	UploadError,
	type UploadManyOptions,
	type UploadOptions,
	type UseUploadReturn,
	useUpload,
} from "./use-upload";
export {
	resolveUploadCollection,
	type UploadCollectionResolution,
	useUploadCollection,
} from "./use-upload-collection";
// Validation error map hook
export {
	createAdminZodErrorMap,
	useValidationErrorMap,
} from "./use-validation-error-map";
// View state hook
export { useViewState } from "./use-view-state";
