/**
 * Admin Type Registry
 *
 * Module augmentation interface for type-safe admin access.
 * Users extend this interface to register their app and admin types.
 *
 * @deprecated Prefer using `createTypedHooks<App>()` instead of module augmentation.
 * The new factory pattern provides the same type safety without global augmentation.
 *
 * @example New recommended pattern:
 * ```ts
 * // In your admin hooks file:
 * import type { App } from "./server/app";
 * import { createTypedHooks } from '@questpie/admin/client';
 *
 * export const {
 *   useCollectionList,
 *   useCollectionItem,
 *   useCollectionCreate,
 *   useGlobal,
 * } = createTypedHooks<App>();
 * ```
 */

import type { Questpie } from "questpie";
import type { AdminBuilder } from "./admin-builder";

// ============================================================================
// Module Augmentation Interface (Legacy)
// ============================================================================

/**
 * Admin Type Registry for module augmentation.
 *
 * @deprecated Use `createTypedHooks<App>()` instead for new projects.
 * Module augmentation is still supported for backwards compatibility.
 *
 * Legacy usage (still works but not recommended):
 * @example
 * ```ts
 * // In your admin.ts after creating the admin config:
 * export const admin = qa()
 *   .use(coreAdminModule)
 *   .collections({ barbers, services })
 *
 * declare module "@questpie/admin" {
 *   interface AdminTypeRegistry {
 *     app: App
 *     admin: typeof admin
 *   }
 * }
 * ```
 *
 * New recommended pattern:
 * @example
 * ```ts
 * import type { App } from "./server/app";
 * import { createTypedHooks } from '@questpie/admin/client';
 *
 * export const {
 *   useCollectionList,
 *   useCollectionItem,
 *   useGlobal,
 * } = createTypedHooks<App>();
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: Augmentation target for user's types
export interface AdminTypeRegistry {
	// NOTE: Module augmentation is deprecated.
	// Use createTypedHooks<App>() from '@questpie/admin/client' instead.
	//
	// Legacy pattern (still works):
	// declare module "@questpie/admin" {
	//   interface AdminTypeRegistry {
	// app: App
	//     admin: typeof admin
	//   }
	// }
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Extract the app type from AdminTypeRegistry if augmented, otherwise unknown.
 */
export type RegisteredCMS = AdminTypeRegistry extends { app: infer T }
	? T extends Questpie<any>
		? T
		: unknown
	: unknown;

/**
 * Extract the Admin config type from AdminTypeRegistry if augmented, otherwise unknown.
 */
export type RegisteredAdmin = AdminTypeRegistry extends { admin: infer T }
	? T extends AdminBuilder<any>
		? T
		: unknown
	: unknown;

/**
 * Extract collection names from registered app.
 * Falls back to string if app is not registered.
 */
export type RegisteredCollectionNames =
	RegisteredCMS extends Questpie<infer TConfig>
		? keyof TConfig["collections"] & string
		: string;

/**
 * Extract global names from registered app.
 * Falls back to string if app is not registered.
 */
export type RegisteredGlobalNames =
	RegisteredCMS extends Questpie<infer TConfig>
		? keyof TConfig["globals"] & string
		: string;

/**
 * Check if the registry has been augmented with a app type.
 */
export type IsRegistered = RegisteredCMS extends unknown
	? RegisteredCMS extends Questpie<any>
		? true
		: false
	: false;
