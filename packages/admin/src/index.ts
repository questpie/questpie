/**
 * @questpie/admin - Main Entry Point
 *
 * This module provides the main exports and module augmentation interface.
 */

// ============================================================================
// Module Augmentation Registry
// ============================================================================

export type {
	AdminTypeRegistry,
	IsRegistered,
	RegisteredAdmin,
	RegisteredCMS,
	RegisteredCollectionNames,
	RegisteredGlobalNames,
} from "./client/builder/registry.js";

// ============================================================================
// Re-exports from builder
// ============================================================================

export type {
	AdminBuilderState,
	AppAdmin,
	CollectionFieldKeys,
	CollectionItem,
	CollectionNames,
	GlobalNames,
	InferAdminCMS,
} from "./client/builder/index.js";
export { Admin, AdminBuilder, qa } from "./client/builder/index.js";

// ============================================================================
// Re-exports from runtime
// ============================================================================

export type {
	AdminProviderProps,
	AdminState,
	AdminStore,
} from "./client/runtime/index.js";
export {
	AdminProvider,
	// Selectors
	selectAdmin,
	selectAuthClient,
	selectBasePath,
	selectBrandName,
	selectClient,
	selectContentLocale,
	selectNavigate,
	selectNavigation,
	selectSetContentLocale,
	useAdminStore,
	// Utilities
	useShallow,
} from "./client/runtime/index.js";
