/**
 * Admin Builder - Main Export
 */

import type { CollectionInfer } from "questpie";
import type { QuestpieApp, QuestpieClient } from "questpie/client";

export { Admin, type AppAdmin, type InferAdminCMS } from "./admin";
export { AdminBuilder } from "./admin-builder";
export type { AdminBuilderState } from "./admin-types";
// Action types and registry
export type { PageDefinition } from "./page/page";
export { qa } from "./qa";
// ============================================================================
// Common Types
// ============================================================================

export type { IconComponent } from "./types/common";

// ============================================================================
// Field Types
// ============================================================================

export type {
	ComponentRegistry,
	FieldComponentProps,
	FieldLayoutItem,
	FormSidebarConfig,
	FormViewConfig,
	SectionLayout,
	TabConfig,
	TabsLayout,
} from "./types/field-types";

// ============================================================================
// Validation
// ============================================================================

// ============================================================================
// Widget Types
// ============================================================================

export type {
	AnyWidgetConfig,
	WidgetAction,
	WidgetCardVariant,
	WidgetComponentProps,
	WidgetConfig,
} from "./types/widget-types";

// ============================================================================
// UI Config Types
// ============================================================================

export type {
	DashboardAction,
	DashboardConfig,
	DashboardLayoutItem,
	DashboardSection,
	DashboardTabConfig,
	DashboardTabs,
} from "./types/ui-config";

// ============================================================================
// I18n Types
// ============================================================================

// ============================================================================
// Module Augmentation Registry
// ============================================================================

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Extract collection names from a QuestpieApp config
 */
export type CollectionNames<TApp extends QuestpieApp> =
	keyof TApp["collections"] & string;
/**
 * Extract global names from a QuestpieApp config
 */
export type GlobalNames<TApp extends QuestpieApp> =
	keyof NonNullable<TApp["globals"]> & string;

/**
 * Extract collection item type
 */
export type CollectionItem<
	TApp extends QuestpieApp,
	TName extends CollectionNames<TApp>,
> = Awaited<
	ReturnType<QuestpieClient<any>["collections"][TName]["find"]>
> extends { docs: Array<infer TItem> }
	? TItem
	: never;

/**
 * Extract field keys from a backend collection
 *
 * @example
 * ```ts
 * type AppointmentFields = CollectionFieldKeys<AppConfig, "appointments">;
 * // = "customerId" | "barberId" | "serviceId" | "status" | ...
 * ```
 */
export type CollectionFieldKeys<
	TApp extends QuestpieApp,
	TCollectionName extends string,
> = TApp["collections"][TCollectionName] extends infer TCollection
	? CollectionInfer<TCollection> extends infer TInfer
		? TInfer extends { select: infer TSelect }
			? keyof TSelect
			: never
		: never
	: never;
